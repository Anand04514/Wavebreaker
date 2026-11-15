import { describe, expect, it } from 'vitest';
import {
  ARENA,
  BOMB,
  CLONER,
  ENEMY_SPECS,
  PICKUPS,
  SHOCK,
  SHOOTER,
  SPAWN,
  TELEPORTER,
  VIEWPORT,
} from '../src/config';
import {
  activeBand,
  applyDamage,
  applyHeal,
  applyMaxHealthGain,
  knowYourEnemyEntries,
  blastDamageAt,
  clonePoints,
  cloneScore,
  bombDamageAgainst,
  bossHealth,
  computeScore,
  distance,
  enemyCount,
  fuseProgress,
  healthMultiplier,
  randomTeleportDelay,
  teleportPoint,
  weaponUpgradeDue,
  isBossWave,
  normalizeMovement,
  pickCloneKind,
  pickWeighted,
  pickupExpiryWave,
  randomIndex,
  rollComposition,
  scaledHealth,
  shouldDropPickup,
  avoidObstacles,
  deflectAroundCover,
  spawnPoint,
  spawnPointAroundView,
  waveClearBonus,
  type Rng,
} from '../src/systems/SpawnLogic';

/** Deterministic LCG so spawn and composition tests are repeatable. */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('cloner', () => {
  it('never copies itself, a copy, or a boss', () => {
    expect(pickCloneKind([], () => 0.5)).toBeNull();
    expect(pickCloneKind([{ kind: 'cloner', clone: false, boss: false }], () => 0.5)).toBeNull();
    expect(pickCloneKind([{ kind: 'chaser', clone: true, boss: false }], () => 0.5)).toBeNull();
    // A boss is a role of the tank: it is not a source, so no copy of one is ever made.
    expect(pickCloneKind([{ kind: 'tank', clone: false, boss: true }], () => 0.5)).toBeNull();
  });

  it('copies a real enemy when there is one', () => {
    expect(pickCloneKind([{ kind: 'chaser', clone: false, boss: false }], () => 0.99)).toBe('chaser');
  });

  it('weights by how many of each are actually around', () => {
    const field = [
      { kind: 'chaser' as const, clone: false, boss: false },
      { kind: 'chaser' as const, clone: false, boss: false },
      { kind: 'runner' as const, clone: false, boss: false },
    ];
    expect(pickCloneKind(field, () => 0.1)).toBe('chaser');
    expect(pickCloneKind(field, () => 0.9)).toBe('runner');
  });

  it('ignores copies even when they outnumber the real enemies', () => {
    const field = [
      { kind: 'runner' as const, clone: true, boss: false },
      { kind: 'tank' as const, clone: true, boss: false },
      { kind: 'bomber' as const, clone: true, boss: false },
      { kind: 'chaser' as const, clone: false, boss: false },
    ];
    for (let seed = 1; seed <= 40; seed += 1) {
      expect(pickCloneKind(field, seeded(seed))).toBe('chaser');
    }
  });

  it('places one copy per slot inside its radius', () => {
    const points = clonePoints(
      { x: 700, y: 700 },
      CLONER.clonesPerPulse,
      CLONER.cloneRadius,
      seeded(7),
    );
    expect(points).toHaveLength(CLONER.clonesPerPulse);
    for (const point of points) {
      expect(distance(point, { x: 700, y: 700 })).toBeLessThanOrEqual(CLONER.cloneRadius);
    }
  });

  it('keeps copies inside the arena walls', () => {
    const points = clonePoints({ x: 8, y: 8 }, 4, CLONER.cloneRadius, seeded(5));
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.y).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
    }
  });

  it('pays a share of the real enemy for a copy', () => {
    expect(cloneScore(100)).toBe(50);
    expect(cloneScore(ENEMY_SPECS.chaser.score)).toBe(5);
    expect(cloneScore(3)).toBe(2);
  });
});

describe('normalizeMovement', () => {
  it('normalises diagonals so they are not faster than straight movement', () => {
    const straight = normalizeMovement(1, 0);
    const diagonal = normalizeMovement(1, 1);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(Math.hypot(straight.x, straight.y), 6);
  });

  it('returns a zero vector when there is no input', () => {
    expect(normalizeMovement(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('keeps opposite inputs opposing', () => {
    const left = normalizeMovement(-1, 0);
    const right = normalizeMovement(1, 0);
    expect(left.x + right.x).toBeCloseTo(0, 6);
  });
});

describe('wave scaling', () => {
  it('starts at base health on wave 1 and grows 5% per wave', () => {
    expect(healthMultiplier(1)).toBe(1);
    expect(healthMultiplier(3)).toBeCloseTo(1.1, 6);
    expect(healthMultiplier(5)).toBeCloseTo(1.2, 6);
  });

  it('scales enemy health up in whole numbers', () => {
    const chaser = ENEMY_SPECS.chaser.health;
    expect(scaledHealth(chaser, 1)).toBe(chaser);
    expect(scaledHealth(chaser, 3)).toBe(Math.ceil(chaser * 1.1));
    expect(scaledHealth(1, 2)).toBeGreaterThanOrEqual(1);
  });

  it('spawns enemies per wave with the documented formula', () => {
    expect(enemyCount(1)).toBe(7);
    expect(enemyCount(2)).toBe(9);
    expect(enemyCount(5)).toBeGreaterThan(enemyCount(4));
  });

  it('introduces stronger types as waves progress', () => {
    expect(activeBand(1).fromWave).toBe(1);
    expect(activeBand(3).fromWave).toBe(2);
    expect(activeBand(6).fromWave).toBe(6);
    expect(activeBand(7).fromWave).toBe(7);
    expect(activeBand(1).types.map((t) => t.type)).toEqual(['chaser']);
  });

  it('brings bombers in at wave 5 and healers at wave 7', () => {
    const kinds = (wave: number): Set<string> => new Set(activeBand(wave).types.map((t) => t.type));
    expect(kinds(4).has('bomber')).toBe(false);
    expect(kinds(5).has('bomber')).toBe(true);
    expect(kinds(6).has('healer')).toBe(false);
    expect(kinds(7).has('healer')).toBe(true);
    expect(kinds(14)).toEqual(kinds(9));
  });

  it('keeps shockers out until after wave 5, then rolls them every wave', () => {
    const kinds = (wave: number): Set<string> => new Set(activeBand(wave).types.map((t) => t.type));
    for (const wave of [1, 2, 4, 5]) expect(kinds(wave).has('shocker')).toBe(false);
    for (const wave of [6, 7, 8, 9, 15]) expect(kinds(wave).has('shocker')).toBe(true);
  });


  it('only rolls types allowed by the active band', () => {
    for (const wave of [1, 2, 4, 6, 9, 14]) {
      const composition = rollComposition(wave, undefined, seeded(wave));
      const allowed = new Set(activeBand(wave).types.map((t) => t.type));
      expect(composition).toHaveLength(enemyCount(wave));
      for (const kind of composition) expect(allowed.has(kind)).toBe(true);
    }
  });

  it('is deterministic for a given rng', () => {
    const a = rollComposition(6, undefined, seeded(42));
    const b = rollComposition(6, undefined, seeded(42));
    expect(a).toEqual(b);
  });

  it('flags every fifth wave as a boss wave', () => {
    expect(isBossWave(5)).toBe(true);
    expect(isBossWave(10)).toBe(true);
    expect(isBossWave(4)).toBe(false);
  });

  it('scales boss health with the wave number', () => {
    expect(bossHealth(5)).toBe(Math.ceil(70 * (1 + 0.12 * 4)));
    expect(bossHealth(10)).toBeGreaterThan(bossHealth(5));
  });
});

describe('spawnPoint', () => {
  it('spawns inside the arena but outside the safe radius, every time', () => {
    const player = { x: ARENA.width / 2, y: ARENA.height / 2 };
    for (let i = 0; i < 300; i += 1) {
      const point = spawnPoint(player, seeded(i + 1));
      expect(point.x).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.x).toBeLessThanOrEqual(ARENA.width - SPAWN.edgeMargin);
      expect(point.y).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.y).toBeLessThanOrEqual(ARENA.height - SPAWN.edgeMargin);
      expect(distance(point, player)).toBeGreaterThanOrEqual(SPAWN.safeRadius);
    }
  });

  it('keeps the safe radius even when the player hugs a wall', () => {
    const player = { x: SPAWN.edgeMargin, y: SPAWN.edgeMargin };
    for (let i = 0; i < 200; i += 1) {
      const point = spawnPoint(player, seeded(i + 500));
      expect(point.x).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.y).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
    }
  });

  it('honours custom arena sizes and safe radii', () => {
    const arena = { width: 400, height: 400 };
    const point = spawnPoint({ x: 200, y: 200 }, seeded(3), {
      arena,
      margin: 20,
      safeRadius: 50,
    });
    expect(point.x).toBeGreaterThanOrEqual(20);
    expect(point.x).toBeLessThanOrEqual(380);
    expect(point.y).toBeGreaterThanOrEqual(20);
    expect(point.y).toBeLessThanOrEqual(380);
  });
});

describe('spawnPointAroundView', () => {
  const view = { x: 640, y: 360, width: VIEWPORT.width, height: VIEWPORT.height };
  const player = { x: view.x + view.width / 2, y: view.y + view.height / 2 };

  it('spawns off-screen and outside the safe radius', () => {
    for (let i = 0; i < 300; i += 1) {
      const point = spawnPointAroundView(player, view, seeded(i + 1));
      const onScreen =
        point.x > view.x &&
        point.x < view.x + view.width &&
        point.y > view.y &&
        point.y < view.y + view.height;
      expect(onScreen).toBe(false);
      expect(distance(point, player)).toBeGreaterThanOrEqual(SPAWN.safeRadius);
    }
  });

  it('stays inside the arena on every spawn', () => {
    for (let i = 0; i < 300; i += 1) {
      const point = spawnPointAroundView(player, view, seeded(i + 400));
      expect(point.x).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.x).toBeLessThanOrEqual(ARENA.width - SPAWN.edgeMargin);
      expect(point.y).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.y).toBeLessThanOrEqual(ARENA.height - SPAWN.edgeMargin);
    }
  });

  it('keeps spawns legal when the camera is clamped to an arena corner', () => {
    const cornerView = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
    const cornerPlayer = { x: 320, y: 320 };
    for (let i = 0; i < 300; i += 1) {
      const point = spawnPointAroundView(cornerPlayer, cornerView, seeded(i + 900));
      expect(point.x).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.x).toBeLessThanOrEqual(ARENA.width - SPAWN.edgeMargin);
      expect(point.y).toBeGreaterThanOrEqual(SPAWN.edgeMargin);
      expect(point.y).toBeLessThanOrEqual(ARENA.height - SPAWN.edgeMargin);
      expect(distance(point, cornerPlayer)).toBeGreaterThanOrEqual(SPAWN.safeRadius);
    }
  });
});

describe('damage and score math', () => {
  it('clamps health at zero and ignores negative damage', () => {
    expect(applyDamage(10, 4)).toBe(6);
    expect(applyDamage(3, 10)).toBe(0);
    expect(applyDamage(3, -5)).toBe(3);
  });

  it('heals without overhealing or subtracting health', () => {
    expect(applyHeal(4, 8, 2)).toBe(6);
    expect(applyHeal(7, 8, 5)).toBe(8);
    expect(applyHeal(8, 8, 2)).toBe(8);
    expect(applyHeal(4, 8, -3)).toBe(4);
  });

  it('raises the max health cap without healing current health', () => {
    expect(applyMaxHealthGain(100, 100, 10)).toEqual({ health: 100, maxHealth: 110 });
    expect(applyMaxHealthGain(40, 100, 10)).toEqual({ health: 40, maxHealth: 110 });
    expect(applyMaxHealthGain(100, 100, 0)).toEqual({ health: 100, maxHealth: 100 });
    expect(applyMaxHealthGain(90, 100, -5)).toEqual({ health: 90, maxHealth: 100 });
    expect(applyMaxHealthGain(105, 110, 10)).toEqual({ health: 105, maxHealth: 120 });
  });

  it('only deals blast damage inside the radius', () => {
    expect(blastDamageAt(0, 130, 42)).toBe(42);
    expect(blastDamageAt(130, 130, 42)).toBe(42);
    expect(blastDamageAt(131, 130, 42)).toBe(0);
    expect(blastDamageAt(400, 130, 42)).toBe(0);
    expect(blastDamageAt(10, 0, 42)).toBe(0);
  });

  it('lets a tank survive a full bomb, while every other enemy dies to one', () => {
    const tankHealth = scaledHealth(ENEMY_SPECS.tank.health, 1);
    const tankDamage = bombDamageAgainst('tank', BOMB.damage);

    expect(tankDamage).toBeLessThan(tankHealth);
    expect(applyDamage(tankHealth, tankDamage)).toBeGreaterThan(0);

    for (const kind of [
      'chaser',
      'runner',
      'shooter',
      'bomber',
      'healer',
      'shocker',
      'teleporter',
      'cloner',
    ] as const) {
      expect(bombDamageAgainst(kind, BOMB.damage)).toBe(BOMB.damage);
      expect(applyDamage(scaledHealth(ENEMY_SPECS[kind].health, 1), BOMB.damage)).toBe(0);
    }
  });

  it('never returns negative bomb damage', () => {
    expect(bombDamageAgainst('tank', -10)).toBe(0);
    expect(bombDamageAgainst('chaser', 0)).toBe(0);
  });

  it('applies the score multiplier and rounds to whole points', () => {
    expect(computeScore(10, 1)).toBe(10);
    expect(computeScore(10, 2)).toBe(20);
    expect(computeScore(15, 1.5)).toBe(23);
  });

  it('never blinks a teleporter sooner than the minimum delay', () => {
    expect(randomTeleportDelay(() => 0)).toBe(TELEPORTER.minIntervalMs);
    expect(randomTeleportDelay(() => 1)).toBe(TELEPORTER.maxIntervalMs);
    expect(randomTeleportDelay(() => 0.5)).toBe((TELEPORTER.minIntervalMs + TELEPORTER.maxIntervalMs) / 2);
    expect(TELEPORTER.minIntervalMs).toBeGreaterThanOrEqual(3000);
    // An out-of-range rng still lands inside the window.
    expect(randomTeleportDelay(() => 4)).toBe(TELEPORTER.maxIntervalMs);
  });

  it('lands a teleporter close to the player, inside the arena', () => {
    const player = { x: ARENA.width / 2, y: ARENA.height / 2 };
    let seed = 0.11;
    const rng = (): number => {
      seed = (seed * 9377 + 0.37) % 1;
      return seed;
    };

    for (let i = 0; i < 40; i += 1) {
      const point = teleportPoint(player, rng);
      const gap = Math.hypot(point.x - player.x, point.y - player.y);
      expect(gap).toBeGreaterThanOrEqual(TELEPORTER.arriveMin);
      expect(gap).toBeLessThanOrEqual(TELEPORTER.arriveMax);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(ARENA.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(ARENA.height);
    }
  });

  it('keeps a wall-hugging teleporter landing inside the arena', () => {
    const corner = { x: 4, y: 4 };
    const point = teleportPoint(corner, () => 0.25);
    expect(point.x).toBeGreaterThanOrEqual(TELEPORTER.landingMargin);
    expect(point.y).toBeGreaterThanOrEqual(TELEPORTER.landingMargin);
    expect(point.x).toBeLessThanOrEqual(ARENA.width - TELEPORTER.landingMargin);
    expect(point.y).toBeLessThanOrEqual(ARENA.height - TELEPORTER.landingMargin);
  });

  it('guarantees a weapon upgrade at least every five waves', () => {
    expect(weaponUpgradeDue(0)).toBe(false);
    expect(weaponUpgradeDue(4)).toBe(false);
    expect(weaponUpgradeDue(5)).toBe(true);
    expect(weaponUpgradeDue(9)).toBe(true);
    // A disabled interval never forces a drop.
    expect(weaponUpgradeDue(99, 0)).toBe(false);
  });

  it('burns the bomber fuse from 0 to 1 and clamps outside it', () => {
    expect(fuseProgress(0, 640)).toBe(0);
    expect(fuseProgress(320, 640)).toBe(0.5);
    expect(fuseProgress(640, 640)).toBe(1);
    expect(fuseProgress(900, 640)).toBe(1);
    expect(fuseProgress(-50, 640)).toBe(0);
    // A zero-length fuse is already spent, never a division by zero.
    expect(fuseProgress(100, 0)).toBe(1);
  });

  it('pays a growing bonus for clearing a wave', () => {
    expect(waveClearBonus(1)).toBe(60);
    expect(waveClearBonus(2)).toBeGreaterThan(waveClearBonus(1));
  });
});

describe('pickup weights', () => {
  it('rolls the permanent max-health drop inside the same band as the others', () => {
    // It used to be a deliberately rare trickle; it now has to show up as often as its peers.
    const { vitality, ...others } = PICKUPS.weights;
    const weights = Object.values(others);
    expect(vitality).toBeGreaterThan(0);
    expect(vitality).toBeGreaterThanOrEqual(Math.min(...weights));
    expect(vitality).toBeLessThanOrEqual(Math.max(...weights));
  });

  it('always drops for a boss but leaves other kills to the drop chance', () => {
    // A roll that would never drop still has to pay out for a boss.
    expect(shouldDropPickup(true, () => 0.999999)).toBe(true);
    expect(shouldDropPickup(false, () => 0.999999)).toBe(false);
    expect(shouldDropPickup(false, () => 0)).toBe(true);
  });
});

describe('random helpers', () => {
  it('never returns an out-of-range index', () => {
    expect(randomIndex(() => 0, 5)).toBe(0);
    expect(randomIndex(() => 0.999999, 5)).toBe(4);
    expect(randomIndex(() => 1, 5)).toBe(4);
  });

  it('picks only weighted-in items', () => {
    const items = ['a', 'b', 'c'];
    for (let seed = 1; seed < 50; seed += 1) {
      const picked = pickWeighted(items, [0, 5, 0], seeded(seed));
      expect(picked).toBe('b');
    }
  });
});

describe('pickup lifetime', () => {
  it('keeps a drop on the floor for four waves', () => {
    expect(PICKUPS.lifetimeWaves).toBe(4);
    expect(pickupExpiryWave(3)).toBe(7);
    expect(pickupExpiryWave(1)).toBe(5);
  });

  it('outlives the wave it fell in by three more waves', () => {
    const dropWave = 6;
    const expires = pickupExpiryWave(dropWave);
    for (const wave of [6, 7, 8, 9]) expect(wave < expires).toBe(true);
    expect(10 >= expires).toBe(true);
  });
});

describe('shocker', () => {
  it('lands a jolt on the promised numbers', () => {
    expect(ENEMY_SPECS.shocker.health).toBe(6);
    expect(ENEMY_SPECS.shocker.contactDamage).toBe(10);
    expect(SHOCK.bulletDamage).toBe(20);
    expect(SHOCK.fireIntervalMs).toBe(5000);
    expect(SHOCK.disarmMs).toBe(3000);
  });

  it('carries a bolt far enough to reach its fire range', () => {
    const reach = SHOOTER.bulletSpeed * (SHOOTER.bulletLifetimeMs / 1000);
    expect(reach).toBeGreaterThanOrEqual(SHOOTER.fireRange);
    expect(reach).toBeGreaterThanOrEqual(SHOOTER.preferredRange);
  });

  it('carries a jolt far enough to reach its fire range', () => {
    const reach = SHOCK.bulletSpeed * (SHOCK.bulletLifetimeMs / 1000);
    expect(reach).toBeGreaterThanOrEqual(SHOCK.fireRange);
    expect(reach).toBeGreaterThanOrEqual(SHOCK.preferredRange);
  });

  it('gives the teleporter enough health to take a stray shot', () => {
    expect(ENEMY_SPECS.teleporter.health).toBe(4);
  });
});

describe('know-your-enemy health column', () => {
  it('matches the base stats at wave 1', () => {
    for (const entry of knowYourEnemyEntries(1)) {
      expect(entry.health).toBe(ENEMY_SPECS[entry.kind].health);
      expect(entry.speed).toBe(ENEMY_SPECS[entry.kind].speed);
      expect(entry.contactDamage).toBe(ENEMY_SPECS[entry.kind].contactDamage);
      expect(entry.score).toBe(ENEMY_SPECS[entry.kind].score);
    }
  });

  it('scales with the wave it is opened on, the same way a spawn does', () => {
    for (const wave of [1, 5, 7, 12]) {
      for (const entry of knowYourEnemyEntries(wave)) {
        expect(entry.health).toBe(scaledHealth(ENEMY_SPECS[entry.kind].health, wave));
      }
    }
  });

  it('toughens every enemy by wave 9', () => {
    const base = new Map(knowYourEnemyEntries(1).map((entry) => [entry.kind, entry.health]));
    for (const entry of knowYourEnemyEntries(9)) {
      expect(entry.health).toBeGreaterThanOrEqual(base.get(entry.kind) as number);
    }
    // 2 HP chaser: ceil(2 * 1.4) = 3 by wave 9.
    expect(knowYourEnemyEntries(9).find((entry) => entry.kind === 'chaser')?.health).toBe(3);
  });

  it('lists every enemy exactly once', () => {
    const entries = knowYourEnemyEntries(6);
    expect(entries).toHaveLength(Object.keys(ENEMY_SPECS).length);
    expect(new Set(entries.map((entry) => entry.kind)).size).toBe(entries.length);
  });
});

describe('steering buffers', () => {
  const block = { x: 100, y: 100, width: 80, height: 80 };
  const from = { x: 80, y: 140 };
  const target = { x: 300, y: 140 };
  const unitLength = (x: number, y: number): number => Math.hypot(x, y);

  it('fills the buffer it is given instead of allocating a new direction', () => {
    const out = { x: 0, y: 0 };

    const clear = avoidObstacles({ x: 0, y: 0 }, target, [], 10, undefined, out);
    expect(clear).toBe(out);
    expect(unitLength(out.x, out.y)).toBeCloseTo(1);

    const routed = avoidObstacles(from, target, [block], 10, undefined, out);
    expect(routed).toBe(out);
    expect(unitLength(out.x, out.y)).toBeCloseTo(1);
  });

  it('fills the buffer when it has to deflect, and still returns a unit vector', () => {
    const out = { x: 0, y: 0 };
    const deflected = deflectAroundCover(from, { x: 1, y: 0 }, [block], 10, undefined, out);

    expect(deflected).toBe(out);
    expect(unitLength(out.x, out.y)).toBeCloseTo(1);
    // Deflection only ever swings the heading, never reverses it outright.
    expect(Math.abs(out.x)).toBeGreaterThan(0);
  });

  it('still makes a fresh vector when no buffer is passed', () => {
    const first = avoidObstacles(from, target, [block], 10);
    const second = avoidObstacles(from, target, [block], 10);

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
