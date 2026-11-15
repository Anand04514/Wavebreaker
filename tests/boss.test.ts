import { describe, expect, it } from 'vitest';
import { BOSS, WAVE_CONFIG } from '../src/config';
import { chargePhase, shouldWarpIn, spiralAngles, teleportPoint } from '../src/systems/SpawnLogic';

/** Small deterministic rng so chance-based rules can be tested without mocking Math.random. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('spiralAngles', () => {
  it('spreads the arms evenly around the circle from the offset', () => {
    const angles = spiralAngles(2, 0.3);
    expect(angles).toHaveLength(2);
    expect(angles[0]).toBeCloseTo(0.3, 6);
    expect(angles[1]).toBeCloseTo(0.3 + Math.PI, 6);
  });

  it('keeps four arms a quarter turn apart', () => {
    const angles = spiralAngles(4, 0);
    const step = Math.PI / 2;
    angles.forEach((angle, index) => expect(angle).toBeCloseTo(step * index, 6));
  });

  it('treats a single arm as one stream along the offset', () => {
    expect(spiralAngles(1, -1.2)).toEqual([-1.2]);
  });

  it('floors a fractional arm count instead of firing a partial stream', () => {
    expect(spiralAngles(2.9, 0)).toHaveLength(2);
  });

  it('fires nothing when the arm count is zero or negative', () => {
    expect(spiralAngles(0, 1)).toEqual([]);
    expect(spiralAngles(-3, 1)).toEqual([]);
  });
});

describe('chargePhase', () => {
  const windup = BOSS.charge.windupMs;
  const lunge = BOSS.charge.lungeMs;
  const recover = BOSS.charge.recoverMs;

  it('runs windup, lunge, recover, then done', () => {
    expect(chargePhase(0, windup, lunge, recover)).toBe('windup');
    expect(chargePhase(windup - 1, windup, lunge, recover)).toBe('windup');
    expect(chargePhase(windup, windup, lunge, recover)).toBe('lunge');
    expect(chargePhase(windup + lunge - 1, windup, lunge, recover)).toBe('lunge');
    expect(chargePhase(windup + lunge, windup, lunge, recover)).toBe('recover');
    expect(chargePhase(windup + lunge + recover - 1, windup, lunge, recover)).toBe('recover');
    expect(chargePhase(windup + lunge + recover, windup, lunge, recover)).toBe('done');
  });

  it('clamps a negative elapsed time to the windup', () => {
    expect(chargePhase(-500, windup, lunge, recover)).toBe('windup');
  });

  it('treats zero-length stages as skippable', () => {
    expect(chargePhase(0, 0, 0, 0)).toBe('done');
    expect(chargePhase(0, 0, 100, 0)).toBe('lunge');
  });
});

describe('boss pattern table', () => {
  it('cycles through every pattern kind', () => {
    const kinds = BOSS.patterns.map((pattern) => pattern.kind);
    expect(kinds).toEqual(['burst', 'spiral', 'charge', 'warp']);
    expect(new Set(kinds).size).toBe(BOSS.patterns.length);
  });

  it('gives every pattern a body of time to play out', () => {
    for (const pattern of BOSS.patterns) {
      expect(pattern.durationMs).toBeGreaterThan(0);
    }
    // Two radial volleys, as the original boss did between gear changes.
    expect(BOSS.patterns[0].durationMs).toBe(WAVE_CONFIG.boss.burstEveryMs * 2);
  });

  it('gives the charge pattern exactly its three stages', () => {
    const charge = BOSS.patterns.find((pattern) => pattern.kind === 'charge');
    expect(charge).toBeDefined();
    const stages = BOSS.charge.windupMs + BOSS.charge.lungeMs + BOSS.charge.recoverMs;
    expect(charge?.durationMs).toBe(stages);
  });

  it('lets the spiral fire more than once per pass', () => {
    const spiral = BOSS.patterns.find((pattern) => pattern.kind === 'spiral');
    expect(spiral).toBeDefined();
    expect(spiral!.durationMs / BOSS.spiral.stepMs).toBeGreaterThanOrEqual(2);
  });

  it('keeps the charge lunge faster than the walk, and the tell long enough to react to', () => {
    expect(BOSS.charge.speed).toBeGreaterThan(WAVE_CONFIG.boss.speed);
    expect(BOSS.charge.windupMs).toBeGreaterThanOrEqual(400);
  });
});

describe('boss warp', () => {
  it('only rolls for a jump when the player is far away', () => {
    const alwaysJump = sequence([0]);
    expect(shouldWarpIn(BOSS.warp.farRange - 1, alwaysJump)).toBe(false);
    expect(shouldWarpIn(BOSS.warp.farRange, alwaysJump)).toBe(true);
  });

  it('skips the jump when the roll misses the chance', () => {
    const miss = sequence([0.999]);
    expect(BOSS.warp.chance).toBeLessThan(1);
    expect(shouldWarpIn(BOSS.warp.farRange + 400, miss)).toBe(false);
  });

  it('lands inside the arrival band around the player', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const point = teleportPoint(
        { x: 1280, y: 720 },
        sequence([(seed * 0.137) % 1, (seed * 0.619) % 1]),
        BOSS.warp,
        { width: 2560, height: 1440 },
        [],
        BOSS.radius,
      );
      const distance = Math.hypot(point.x - 1280, point.y - 720);
      expect(distance).toBeGreaterThanOrEqual(BOSS.warp.arriveMin - 1);
      expect(distance).toBeLessThanOrEqual(BOSS.warp.arriveMax + 1);
    }
  });

  it('never lands inside a block', () => {
    const block = [{ x: 1200, y: 640, width: 160, height: 160 }];
    for (let seed = 0; seed < 40; seed += 1) {
      const point = teleportPoint(
        { x: 1280, y: 720 },
        sequence([(seed * 0.211) % 1, (seed * 0.733) % 1]),
        BOSS.warp,
        { width: 2560, height: 1440 },
        block,
        BOSS.radius,
      );
      const inside =
        point.x > block[0].x - BOSS.radius &&
        point.x < block[0].x + block[0].width + BOSS.radius &&
        point.y > block[0].y - BOSS.radius &&
        point.y < block[0].y + block[0].height + BOSS.radius;
      expect(inside).toBe(false);
    }
  });
});

describe('boss phase badges', () => {
  it('names every pattern the cycle can run', () => {
    for (const pattern of BOSS.patterns) {
      const badge = BOSS.phaseLabels[pattern.kind];
      expect(badge, pattern.kind).toBeDefined();
      expect(badge.text).toBe(badge.text.toUpperCase());
      expect(badge.text.length).toBeGreaterThan(0);
    }
  });

  it('gives each pattern its own colour so the bar reads at a glance', () => {
    const colors = BOSS.patterns.map((pattern) => BOSS.phaseLabels[pattern.kind].color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
