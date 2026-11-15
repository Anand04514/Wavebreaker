import { describe, expect, it } from 'vitest';
import { UPGRADES, WEAPONS, type WeaponId } from '../src/config';
import {
  advanceBombCharges,
  cycleIndex,
  fireIntervalMs,
  ordnanceDamageScale,
  shotsFor,
  WeaponSystem,
} from '../src/systems/WeaponSystem';
import type { Rng } from '../src/systems/SpawnLogic';

const fixed = (value: number): Rng => () => value;

describe('shotsFor', () => {
  it('fires a single accurate shot for the pistol', () => {
    const shots = shotsFor(WEAPONS.pistol, 1.2);
    expect(shots).toHaveLength(1);
    expect(shots[0].angle).toBeCloseTo(1.2, 6);
    expect(shots[0].damage).toBe(WEAPONS.pistol.damage);
    expect(shots[0].speed).toBe(WEAPONS.pistol.bulletSpeed);
  });

  it('fans the shotgun pellets evenly across the spread', () => {
    const shots = shotsFor(WEAPONS.shotgun, 0);
    const spread = WEAPONS.shotgun.spreadRadians;
    expect(shots).toHaveLength(WEAPONS.shotgun.pellets);
    expect(shots[0].angle).toBeCloseTo(-spread / 2, 6);
    expect(shots[shots.length - 1].angle).toBeCloseTo(spread / 2, 6);
    for (let i = 1; i < shots.length; i += 1) {
      expect(shots[i].angle).toBeGreaterThan(shots[i - 1].angle);
    }
  });

  it('keeps single-pellet spread inside the weapon jitter window', () => {
    const spread = WEAPONS.smg.spreadRadians;
    const low = shotsFor(WEAPONS.smg, 0, fixed(0))[0];
    const high = shotsFor(WEAPONS.smg, 0, fixed(0.999999))[0];
    expect(low.angle).toBeGreaterThanOrEqual(-spread / 2);
    expect(high.angle).toBeLessThanOrEqual(spread / 2);
  });

  it('derives fire intervals from shots per second', () => {
    expect(fireIntervalMs(WEAPONS.pistol)).toBeCloseTo(250, 6);
    expect(fireIntervalMs(WEAPONS.smg)).toBeCloseTo(100, 6);
    expect(fireIntervalMs(WEAPONS.shotgun)).toBeGreaterThan(fireIntervalMs(WEAPONS.pistol));
  });
});

describe('WeaponSystem', () => {
  it('starts with only the starting weapon', () => {
    const weapons = new WeaponSystem();
    expect(weapons.current).toBe('pistol');
    expect(weapons.ownedWeapons).toEqual(['pistol']);
    expect(weapons.nextLockedWeapon()).toBe('shotgun');
  });

  it('reuses its owned list between polls and refreshes it when a weapon is granted', () => {
    const weapons = new WeaponSystem();
    const first = weapons.ownedWeapons;
    expect(weapons.ownedWeapons).toBe(first);

    weapons.grant('smg');
    expect(weapons.ownedWeapons).not.toBe(first);
    expect(weapons.ownedWeapons).toEqual(['pistol', 'smg']);
  });

  it('enforces the fire-rate limit', () => {
    const weapons = new WeaponSystem();
    expect(weapons.canFire(1000)).toBe(true);
    expect(weapons.fire(1000, 0)).toHaveLength(1);

    expect(weapons.canFire(1100)).toBe(false);
    expect(weapons.fire(1100, 0)).toHaveLength(0);
    expect(weapons.timeUntilReady(1100)).toBeCloseTo(150, 6);

    expect(weapons.canFire(1250)).toBe(true);
    expect(weapons.fire(1250, 0)).toHaveLength(1);
  });

  it('grants, equips and switches weapons', () => {
    const weapons = new WeaponSystem();
    expect(weapons.select(1)).toBe(false);

    weapons.grant('smg');
    expect(weapons.current).toBe('smg');
    expect(weapons.owns('smg')).toBe(true);
    expect(weapons.nextLockedWeapon()).toBe('shotgun');

    expect(weapons.select(0)).toBe(true);
    expect(weapons.current).toBe('pistol');
    expect(weapons.ownedWeapons).toEqual(['pistol', 'smg']);

    expect(weapons.select(0)).toBe(false);
    expect(weapons.select(9)).toBe(false);
  });

  it('reports no locked weapon once everything is unlocked', () => {
    const weapons = new WeaponSystem();
    weapons.grant('shotgun');
    weapons.grant('smg');
    expect(weapons.nextLockedWeapon()).toBeNull();
  });

  it('fires the pellet count of the equipped weapon', () => {
    const weapons = new WeaponSystem();
    weapons.grant('shotgun');
    expect(weapons.fire(0, 0)).toHaveLength(WEAPONS.shotgun.pellets);
  });
});

describe('cycleIndex', () => {
  const order: WeaponId[] = ['pistol', 'smg', 'shotgun'];

  it('steps to the next unlocked slot and wraps around', () => {
    expect(cycleIndex(order, ['pistol', 'smg'], 'pistol', 1)).toBe(1);
    expect(cycleIndex(order, ['pistol', 'smg'], 'smg', 1)).toBe(0);
    expect(cycleIndex(order, order, 'shotgun', 1)).toBe(0);
  });

  it('steps backwards and wraps the other way', () => {
    expect(cycleIndex(order, ['pistol', 'smg'], 'pistol', -1)).toBe(1);
    expect(cycleIndex(order, order, 'pistol', -1)).toBe(2);
  });

  it('skips weapons the player has not unlocked', () => {
    expect(cycleIndex(order, ['pistol', 'shotgun'], 'pistol', 1)).toBe(2);
    expect(cycleIndex(order, ['pistol', 'shotgun'], 'shotgun', 1)).toBe(0);
  });

  it('stays put when nothing else is owned', () => {
    expect(cycleIndex(order, ['pistol'], 'pistol', 1)).toBe(0);
    expect(cycleIndex(order, ['pistol'], 'pistol', -1)).toBe(0);
    expect(cycleIndex([], ['pistol'], 'pistol', 1)).toBe(-1);
  });
});

describe('advanceBombCharges', () => {
  const chargeMs = 20000;
  const max = 3;

  it('adds a charge only once the timer elapses', () => {
    expect(advanceBombCharges(1, 0, 5000, chargeMs, max)).toEqual({ charges: 1, elapsedMs: 5000 });
    expect(advanceBombCharges(1, 15000, 5000, chargeMs, max)).toEqual({ charges: 2, elapsedMs: 0 });
  });

  it('stops at the cap and idles the timer while full', () => {
    expect(advanceBombCharges(3, 0, 5000, chargeMs, max)).toEqual({ charges: 3, elapsedMs: 0 });
  });

  it('carries surplus time into the next charge', () => {
    const first = advanceBombCharges(1, 19000, 3000, chargeMs, max);
    expect(first).toEqual({ charges: 2, elapsedMs: 2000 });
    expect(advanceBombCharges(first.charges, first.elapsedMs, 1000, chargeMs, max)).toEqual({
      charges: 2,
      elapsedMs: 3000,
    });
  });

  it('ignores a stalled or negative frame', () => {
    expect(advanceBombCharges(1, 4000, 0, chargeMs, max)).toEqual({ charges: 1, elapsedMs: 4000 });
    expect(advanceBombCharges(1, 4000, -100, chargeMs, max)).toEqual({ charges: 1, elapsedMs: 4000 });
  });
});

describe('WeaponSystem.cycle', () => {
  it('turns every weapon pickup after the last gun into a damage rank', () => {
    const weapons = new WeaponSystem();
    expect(weapons.ordnanceRank).toBe(0);
    expect(weapons.damageScale).toBe(1);
    expect(weapons.damageScale * WEAPONS.pistol.damage).toBe(WEAPONS.pistol.damage);

    weapons.addOrdnanceRank();
    expect(weapons.ordnanceRank).toBe(1);
    expect(weapons.damageScale).toBeCloseTo(1 + UPGRADES.ordnance.damagePerRank, 6);
    // Every weapon shares the scale, not just the equipped one.
    expect(weapons.damageScale * WEAPONS.shotgun.damage).toBeGreaterThan(WEAPONS.shotgun.damage);

  });

  it('keeps buying damage past the old eight-rank ceiling', () => {
    const weapons = new WeaponSystem();
    for (let i = 0; i < 50; i += 1) weapons.addOrdnanceRank();
    expect(weapons.ordnanceRank).toBe(50);
    // Uncapped: 50 ranks is 1 + 50 x 0.15 = 8.5x, well past the old 2.2x limit.
    expect(weapons.damageScale).toBeCloseTo(1 + 50 * UPGRADES.ordnance.damagePerRank, 6);
    expect(weapons.damageScale).toBeGreaterThan(2.2);
    // The scale keeps rising with every further rank instead of flattening out.
    expect(ordnanceDamageScale(999)).toBeGreaterThan(ordnanceDamageScale(20));
  });

  it('never scales weapon damage below its base value', () => {
    expect(ordnanceDamageScale(0)).toBe(1);
    expect(ordnanceDamageScale(-3)).toBe(1);
    expect(ordnanceDamageScale(2)).toBeCloseTo(1 + 2 * UPGRADES.ordnance.damagePerRank, 6);
  });

  it('walks the unlocked weapons with the wheel', () => {
    const weapons = new WeaponSystem();
    expect(weapons.cycle(1)).toBe(false);

    weapons.grant('smg');
    weapons.grant('shotgun');
    expect(weapons.ownedWeapons).toEqual(['pistol', 'shotgun', 'smg']);
    weapons.select(0);
    expect(weapons.current).toBe('pistol');

    expect(weapons.cycle(1)).toBe(true);
    expect(weapons.current).toBe('shotgun');
    expect(weapons.cycle(1)).toBe(true);
    expect(weapons.current).toBe('smg');
    expect(weapons.cycle(1)).toBe(true);
    expect(weapons.current).toBe('pistol');
    expect(weapons.cycle(-1)).toBe(true);
    expect(weapons.current).toBe('smg');
  });
});
