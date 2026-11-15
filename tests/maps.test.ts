import { describe, expect, it } from 'vitest';
import { ARENA, DASH, MAPS, NAV, OBSTACLES, RUNNER } from '../src/config';
import { cycleMap, getMap } from '../src/systems/MapLogic';
import {
  avoidObstacles,
  circleHitsObstacle,
  clipMuzzleToCover,
  dashVector,
  deflectAroundCover,
  directionBlocked,
  nudgeClearPoint,
  pointBlocked,
  segmentObstacleHit,
  slipAlongCover,
  teleportPoint,
  type Rng,
  type Vec,
} from '../src/systems/SpawnLogic';
import { advanceCharges } from '../src/systems/WeaponSystem';

/** Small deterministic rng so nudge tests never flake. */
const seeded = (seed: number): Rng => {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
};

const block = { x: 100, y: 100, width: 100, height: 100 };

describe('map table', () => {
  it('falls back to the default layout for unknown ids', () => {
    expect(getMap('nope').id).toBe(MAPS.defaultMap);
    expect(getMap('').id).toBe(MAPS.defaultMap);
    expect(getMap('pillars').id).toBe('pillars');
  });

  it('cycles through every layout and wraps both ways', () => {
    const first = MAPS.maps[0].id;
    const second = MAPS.maps[1].id;
    expect(cycleMap(first, 1).id).toBe(second);
    expect(cycleMap(second, 1).id).toBe(MAPS.maps[2].id);
    expect(cycleMap(MAPS.maps[MAPS.maps.length - 1].id, 1).id).toBe(first);
    expect(cycleMap(first, -1).id).toBe(MAPS.maps[MAPS.maps.length - 1].id);
  });

  it('leaves the arena centre clear, so the player always spawns in the open', () => {
    for (const map of MAPS.maps) {
      expect(pointBlocked(ARENA.width / 2, ARENA.height / 2, 40, map.obstacles)).toBe(false);
    }
  });

  it('keeps every block inside the arena', () => {
    for (const map of MAPS.maps) {
      for (const obstacle of map.obstacles) {
        expect(obstacle.x).toBeGreaterThanOrEqual(0);
        expect(obstacle.y).toBeGreaterThanOrEqual(0);
        expect(obstacle.x + obstacle.width).toBeLessThanOrEqual(ARENA.width);
        expect(obstacle.y + obstacle.height).toBeLessThanOrEqual(ARENA.height);
      }
    }
  });
});

describe('obstacle geometry', () => {
  it('counts a circle that overlaps the rectangle, including its edges', () => {
    expect(circleHitsObstacle(150, 150, 5, block)).toBe(true);
    expect(circleHitsObstacle(99, 150, 5, block)).toBe(true);
    expect(circleHitsObstacle(94, 150, 5, block)).toBe(false);
    expect(circleHitsObstacle(150, 40, 59, block)).toBe(false);
    expect(circleHitsObstacle(150, 40, 61, block)).toBe(true);
  });

  it('leaves a clear point exactly where it is', () => {
    const point = { x: 400, y: 400 };
    expect(nudgeClearPoint(point, 12, [block], seeded(1))).toEqual(point);
  });

  it('pushes a blocked point out with the configured clearance', () => {
    const point = nudgeClearPoint({ x: 150, y: 150 }, 12, [block], seeded(7));
    expect(pointBlocked(point.x, point.y, 12 + OBSTACLES.clearance, [block])).toBe(false);
  });

  it('keeps a nudged point inside the arena', () => {
    const cornerBlock = { x: 0, y: 0, width: 300, height: 300 };
    const point = nudgeClearPoint({ x: 40, y: 40 }, 10, [cornerBlock], seeded(3));
    expect(pointBlocked(point.x, point.y, 10 + OBSTACLES.clearance, [cornerBlock])).toBe(false);
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(ARENA.width);
    expect(point.y).toBeGreaterThanOrEqual(0);
    expect(point.y).toBeLessThanOrEqual(ARENA.height);
  });

  it('does nothing at all on the open floor', () => {
    const point = { x: 10, y: 10 };
    expect(nudgeClearPoint(point, 10, [], seeded(1))).toEqual(point);
  });
});

describe('swept bullets against cover', () => {
  const arm = { x: 880, y: 700, width: 300, height: 40 };
  const radius = 4;

  it('catches a shot that jumps clean over a thin wall in one step', () => {
    // 220 px in a single frame, straight through a 40 px arm.
    const hit = segmentObstacleHit({ x: 800, y: 720 }, { x: 1020, y: 720 }, radius, arm);
    expect(hit).not.toBeNull();
    expect(hit).toBeCloseTo((880 - radius - 800) / 220, 5);
  });

  it('ignores a shot that passes over the block', () => {
    expect(segmentObstacleHit({ x: 900, y: 600 }, { x: 1100, y: 600 }, radius, arm)).toBeNull();
  });

  it('ignores a shot that stops short', () => {
    expect(segmentObstacleHit({ x: 700, y: 720 }, { x: 860, y: 720 }, radius, arm)).toBeNull();
  });

  it('reports the near face for a shot fired from inside the block', () => {
    // The muzzle of a player hugging the wall lands inside it: the shot must stop at the face.
    const hit = segmentObstacleHit({ x: 890, y: 720 }, { x: 940, y: 720 }, radius, arm);
    expect(hit).toBe(0);
  });

  it('catches shallow angles into the face', () => {
    const hit = segmentObstacleHit({ x: 860, y: 780 }, { x: 1100, y: 700 }, radius, arm);
    expect(hit).not.toBeNull();
  });
});

describe('muzzle clearance against cover', () => {
  const wall = { x: 400, y: 300, width: 300, height: 40 };
  const radius = 4;
  const reach = 20;

  it('leaves the muzzle alone in the open', () => {
    const muzzle = clipMuzzleToCover({ x: 100, y: 900 }, 0, reach, [wall], radius);
    expect(muzzle.x).toBeCloseTo(120, 6);
    expect(muzzle.y).toBeCloseTo(900, 6);
  });

  it('pulls a muzzle that would sit inside the wall back to its face', () => {
    // Player pressed against the wall, aiming into it: 20 px ahead is inside the block.
    const muzzle = clipMuzzleToCover({ x: 386, y: 320 }, 0, reach, [wall], radius);
    expect(muzzle.x).toBeLessThan(400);
    expect(muzzle.x).toBeGreaterThan(390);
    expect(pointBlocked(muzzle.x, muzzle.y, radius, [wall])).toBe(false);
  });

  it('keeps a shot that grazes the wall at the face', () => {
    const angle = 0.35;
    const muzzle = clipMuzzleToCover({ x: 386, y: 320 }, angle, reach, [wall], radius);
    expect(pointBlocked(muzzle.x, muzzle.y, radius, [wall])).toBe(false);
  });

  it('leaves a shot fired along the wall at full reach', () => {
    const muzzle = clipMuzzleToCover({ x: 386, y: 320 }, Math.PI, reach, [wall], radius);
    expect(muzzle.x).toBeCloseTo(366, 6);
  });
});

describe('kiting enemies and cover', () => {
  const wall = { x: 400, y: 300, width: 300, height: 40 };
  const radius = 13;

  it('knows when the way ahead is walled off', () => {
    expect(directionBlocked({ x: 550, y: 380 }, { x: 0, y: -1 }, [wall], radius)).toBe(true);
    expect(directionBlocked({ x: 550, y: 500 }, { x: 0, y: -1 }, [wall], radius)).toBe(false);
    expect(directionBlocked({ x: 550, y: 380 }, { x: 0, y: -1 }, [], radius)).toBe(false);
  });

  it('leaves a clear direction alone', () => {
    const direction = deflectAroundCover({ x: 550, y: 500 }, { x: 1, y: 0 }, [wall], radius);
    expect(direction.x).toBeCloseTo(1, 6);
    expect(direction.y).toBeCloseTo(0, 6);
  });

  it('swings a retreating enemy along the wall instead of into it', () => {
    // Backing away from a player below, straight into the wall.
    const direction = deflectAroundCover({ x: 550, y: 280 }, { x: 0, y: 1 }, [wall], radius);
    expect(directionBlocked({ x: 550, y: 280 }, direction, [wall], radius)).toBe(false);
    expect(Math.abs(direction.x)).toBeGreaterThan(0.5);
  });

  it('always returns a unit vector, even when boxed in', () => {
    const box = [
      { x: 380, y: 200, width: 200, height: 40 },
      { x: 380, y: 420, width: 200, height: 40 },
      { x: 340, y: 200, width: 40, height: 260 },
      { x: 580, y: 200, width: 40, height: 260 },
    ];
    const direction = deflectAroundCover({ x: 480, y: 330 }, { x: 0, y: -1 }, box, radius);
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
  });
});

describe('walking around cover', () => {
  const wall = { x: 400, y: 300, width: 300, height: 40 };
  const radius = 14;

  /** Walk a stand-in enemy: follow the steering, refuse to enter a block like the collider does. */
  const walkTo = (start: Vec, target: Vec, obstacles = [wall]) => {
    const position = { ...start };
    const step = 4;
    let closest = Infinity;

    for (let i = 0; i < 5000; i += 1) {
      const direction = avoidObstacles(position, target, obstacles, radius);
      const moves = [
        { x: position.x + direction.x * step, y: position.y + direction.y * step },
        { x: position.x + direction.x * step, y: position.y },
        { x: position.x, y: position.y + direction.y * step },
      ];
      // Arcade slides a body along a surface instead of stopping it dead, so try the diagonal
      // step first and fall back to the single-axis ones.
      const next = moves.find((move) => !pointBlocked(move.x, move.y, radius, obstacles));
      if (next) {
        position.x = next.x;
        position.y = next.y;
      }
      const distance = Math.hypot(target.x - position.x, target.y - position.y);
      closest = Math.min(closest, distance);
      if (distance < 10) break;
    }

    return { position, closest };
  };

  it('keeps the wanted direction when the path is clear', () => {
    const direction = avoidObstacles({ x: 100, y: 900 }, { x: 100, y: 0 }, [wall], radius);
    expect(direction.x).toBeCloseTo(0, 6);
    expect(direction.y).toBeCloseTo(-1, 6);
  });

  it('returns no movement when already at the target', () => {
    expect(avoidObstacles({ x: 100, y: 900 }, { x: 100, y: 900 }, [wall], radius)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('steers off the straight line when a block sits on it', () => {
    // Straight up into the wall, player on the far side: the answer must not be a head-on push.
    const direction = avoidObstacles({ x: 550, y: 380 }, { x: 550, y: 100 }, [wall], radius);
    expect(direction.y).toBeLessThan(0);
    expect(Math.abs(direction.x)).toBeGreaterThan(0.3);
  });

  it('aims for the corner nearest the player', () => {
    expect(avoidObstacles({ x: 550, y: 380 }, { x: 400, y: 100 }, [wall], radius).x).toBeLessThan(0);
    expect(avoidObstacles({ x: 550, y: 380 }, { x: 700, y: 100 }, [wall], radius).x).toBeGreaterThan(0);
  });

  it('is always a unit vector', () => {
    for (let i = 0; i < 24; i += 1) {
      const angle = (i / 24) * Math.PI * 2;
      const direction = avoidObstacles(
        { x: 550, y: 360 },
        { x: 550 + Math.cos(angle) * 300, y: 360 + Math.sin(angle) * 300 },
        [wall],
        radius,
      );
      expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
    }
  });

  it('walks around the end of a wall to the player behind it', () => {
    const target = { x: 550, y: 100 };
    const { closest } = walkTo({ x: 550, y: 500 }, target);
    expect(closest).toBeLessThan(10);
  });

  it('reaches a player standing in a corner behind a pillar', () => {
    const pillar = { x: 1000, y: 700, width: 150, height: 150 };
    const target = { x: 1075, y: 600 };
    const { closest } = walkTo({ x: 1075, y: 1100 }, target, [pillar]);
    expect(closest).toBeLessThan(10);
  });
});

describe('teleport landings with cover', () => {
  it('never drops a teleporter inside a block', () => {
    const player = { x: 1000, y: 720 };
    // A wall exactly where the untouched landing would be (150-240 px to the right).
    const wall = { x: 1150, y: 560, width: 90, height: 320 };
    const landing = teleportPoint(player, seeded(11), undefined, undefined, [wall]);

    expect(pointBlocked(landing.x, landing.y, 11, [wall])).toBe(false);
    const gap = Math.hypot(landing.x - player.x, landing.y - player.y);
    expect(gap).toBeGreaterThan(0);
  });

  it('still lands 150-240 px from the player on the open floor', () => {
    const player = { x: ARENA.width / 2, y: ARENA.height / 2 };
    const rng = seeded(23);
    for (let i = 0; i < 20; i += 1) {
      const landing = teleportPoint(player, rng);
      const gap = Math.hypot(landing.x - player.x, landing.y - player.y);
      expect(gap).toBeGreaterThanOrEqual(150);
      expect(gap).toBeLessThanOrEqual(242);
    }
  });
});

describe('dash vector', () => {
  it('dashes along the aim, never the walk keys', () => {
    const right = dashVector(0);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.y).toBeCloseTo(0, 6);

    const up = dashVector(-Math.PI / 2);
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(-1, 6);

    const diagonal = dashVector(Math.PI / 4);
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 6);
    expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('is always a unit vector', () => {
    for (let i = 0; i < 16; i += 1) {
      const vector = dashVector((i / 16) * Math.PI * 2);
      expect(Math.hypot(vector.x, vector.y)).toBeCloseTo(1, 6);
    }
  });
});

describe('dash charges', () => {
  it('holds a full rack without starting the clock', () => {
    const next = advanceCharges(DASH.maxCharges, 5000, 1000, DASH.chargeMs, DASH.maxCharges);
    expect(next.charges).toBe(DASH.maxCharges);
    expect(next.elapsedMs).toBe(0);
  });

  it('refills one charge per 15 s and never overshoots the cap', () => {
    const spent = DASH.maxCharges - 1;
    expect(advanceCharges(spent, 0, DASH.chargeMs - 1, DASH.chargeMs, DASH.maxCharges).charges).toBe(spent);

    const oneBack = advanceCharges(spent, 0, DASH.chargeMs, DASH.chargeMs, DASH.maxCharges);
    expect(oneBack.charges).toBe(spent + 1);
    expect(oneBack.elapsedMs).toBe(0);

    // A long frame catches up on more than one charge but still stops at the cap.
    expect(advanceCharges(0, 0, DASH.chargeMs * 10, DASH.chargeMs, DASH.maxCharges).charges).toBe(
      DASH.maxCharges,
    );
  });

  it('keeps the partial progress toward the next charge', () => {
    const half = advanceCharges(1, 0, DASH.chargeMs / 2, DASH.chargeMs, DASH.maxCharges);
    expect(half.charges).toBe(1);
    expect(half.elapsedMs).toBe(DASH.chargeMs / 2);

    const done = advanceCharges(half.charges, half.elapsedMs, DASH.chargeMs / 2, DASH.chargeMs, DASH.maxCharges);
    expect(done.charges).toBe(2);
  });
});

describe('stall recovery', () => {
  // The long slab from the Pillars layout, which is where a runner was seen wedged in play.
  const slab = { x: 1180, y: 240, width: 200, height: 90 };
  const bodyRadius = 8;

  /** Mirrors Runner.behave + Enemy.steerToward: weave in the open, commit along a face when stuck. */
  const walkRunner = (start: Vec, target: Vec, steps = 4000) => {
    const position = { ...start };
    const step = 4;
    const dt = 16;
    let time = 0;
    let progressAt = 0;
    let progressX = 0;
    let progressY = 0;
    let slideUntil = 0;
    let side: 1 | -1 = 1;
    let slideDirection: Vec = { x: 0, y: 0 };
    let stallCount = 0;
    let slides = 0;

    for (let i = 0; i < steps; i += 1) {
      time += dt;
      const angle = Math.atan2(target.y - position.y, target.x - position.x);
      const distance = Math.hypot(target.x - position.x, target.y - position.y);
      const blocked = directionBlocked(
        position,
        { x: Math.cos(angle), y: Math.sin(angle) },
        [slab],
        bodyRadius,
      );
      const wobble = blocked ? 0 : Math.sin(time / RUNNER.wobbleRateMs) * RUNNER.wobbleRadians;
      const offset = distance * Math.sin(wobble);
      const aim = {
        x: target.x - Math.sin(angle) * offset,
        y: target.y + Math.cos(angle) * offset,
      };

      const steered = avoidObstacles(position, aim, [slab], bodyRadius);

      let direction: Vec = steered;
      if (time < slideUntil) {
        slides += 1;
        direction = slideDirection;
      } else {
        const moved = Math.hypot(position.x - progressX, position.y - progressY);
        if (progressAt === 0 || moved >= NAV.stallTravel) {
          progressAt = time;
          progressX = position.x;
          progressY = position.y;
          stallCount = 0;
        } else if (time - progressAt >= NAV.stallWindowMs) {
          progressAt = time;
          progressX = position.x;
          progressY = position.y;
          stallCount += 1;
          if (stallCount >= 2) side = side === 1 ? -1 : 1;
          slideDirection =
            stallCount >= 2
              ? slipAlongCover(position, steered, [slab], bodyRadius, side)
              : steered;
          slideUntil = time + NAV.slideMs;
          direction = slideDirection;
          slides += 1;
        }
      }

      const moves = [
        { x: position.x + direction.x * step, y: position.y + direction.y * step },
        { x: position.x + direction.x * step, y: position.y },
        { x: position.x, y: position.y + direction.y * step },
      ];
      const next = moves.find((move) => !pointBlocked(move.x, move.y, bodyRadius, [slab]));
      if (next) {
        position.x = next.x;
        position.y = next.y;
      }

      if (Math.hypot(target.x - position.x, target.y - position.y) < 10) {
        return { reached: true, slides, position };
      }
    }
    return { reached: false, slides, position };
  };

  it('walks a runner around the slab it used to stall against', () => {
    // The player stands below the slab, the runner is pinned on its top face.
    const result = walkRunner({ x: 1277, y: 228 }, { x: 1280, y: 521 });
    expect(result.reached).toBe(true);
  });

  it('still arrives when the block sits directly between runner and player', () => {
    const result = walkRunner({ x: 1280, y: 180 }, { x: 1280, y: 620 });
    expect(result.reached, `ended at ${JSON.stringify(result.position)} slides=${result.slides}`).toBe(true);
  });

  it('slides along the face on the side it was told to', () => {
    const from = { x: 1280, y: 380 };
    const wanted = { x: 0, y: -1 };
    const east = slipAlongCover(from, wanted, [slab], bodyRadius, 1);
    const west = slipAlongCover(from, wanted, [slab], bodyRadius, -1);

    expect(Math.hypot(east.x, east.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(west.x, west.y)).toBeCloseTo(1, 6);
    expect(east.x).toBeGreaterThan(0.9);
    expect(west.x).toBeLessThan(-0.9);
  });
});
