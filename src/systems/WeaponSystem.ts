/**
 * Weapon ownership, switching and fire-rate gating.
 * `shotsFor` is pure so spread and pellet counts can be unit-tested.
 */
import {
  UPGRADES,
  WEAPONS,
  WEAPONS_DATA,
  type WeaponId,
  type WeaponSpec,
  type WeaponsData,
} from '../config';
import type { Rng } from './SpawnLogic';

export interface Shot {
  angle: number;
  damage: number;
  speed: number;
}

/** Spread +/- jitter for single-pellet weapons, an even fan for multi-pellet ones. */
export function shotsFor(
  spec: WeaponSpec,
  aimAngle: number,
  rng: Rng = Math.random,
): Shot[] {
  if (spec.pellets <= 1) {
    const jitter = spec.spreadRadians > 0 ? (rng() - 0.5) * spec.spreadRadians : 0;
    return [{ angle: aimAngle + jitter, damage: spec.damage, speed: spec.bulletSpeed }];
  }

  const shots: Shot[] = [];
  const spread = spec.spreadRadians;
  const start = aimAngle - spread / 2;
  const step = spec.pellets > 1 ? spread / (spec.pellets - 1) : 0;
  for (let i = 0; i < spec.pellets; i += 1) {
    shots.push({
      angle: start + step * i,
      damage: spec.damage,
      speed: spec.bulletSpeed,
    });
  }
  return shots;
}

export function fireIntervalMs(spec: WeaponSpec): number {
  return 1000 / Math.max(0.01, spec.shotsPerSecond);
}

/**
 * Permanent damage scale bought with Ordnance ranks: +`damagePerRank` per pickup, applied to every
 * weapon. Deliberately uncapped — enemy health climbs with every wave, so the arsenal has to be
 * able to climb with it instead of flattening out at a fixed multiple.
 */
export function ordnanceDamageScale(
  rank: number,
  perRank: number = UPGRADES.ordnance.damagePerRank,
): number {
  return 1 + Math.max(0, rank) * perRank;
}

/**
 * Slot index `direction` steps away from the current weapon, wrapping and skipping anything the
 * player has not unlocked. Returns the current index when there is nothing else to switch to.
 */
export function cycleIndex(
  order: readonly WeaponId[],
  owned: readonly WeaponId[],
  current: WeaponId,
  direction: 1 | -1,
): number {
  const count = order.length;
  if (count === 0) return -1;

  const start = Math.max(0, order.indexOf(current));
  for (let step = 1; step <= count; step += 1) {
    const index = (((start + direction * step) % count) + count) % count;
    if (owned.includes(order[index])) return index;
  }
  return start;
}

/**
 * Charge recharge, driven by delta time: one charge per `chargeMs`, stopping at the cap. A full
 * rack pauses the clock so a charge only starts building once one has been spent. Shared by the
 * bomb sidearm and the dash, which use the same rule with different numbers.
 */
export function advanceCharges(
  charges: number,
  elapsedMs: number,
  deltaMs: number,
  chargeMs: number,
  maxCharges: number,
): { charges: number; elapsedMs: number } {
  if (charges >= maxCharges) return { charges: maxCharges, elapsedMs: 0 };

  let nextCharges = Math.max(0, charges);
  let nextElapsed = Math.max(0, elapsedMs) + Math.max(0, deltaMs);
  while (nextCharges < maxCharges && nextElapsed >= chargeMs) {
    nextCharges += 1;
    nextElapsed -= chargeMs;
  }
  return { charges: nextCharges, elapsedMs: nextCharges >= maxCharges ? 0 : nextElapsed };
}

/** Kept as an alias so the bomb call sites read naturally. */
export const advanceBombCharges = advanceCharges;

export class WeaponSystem {
  current: WeaponId;
  private owned: Set<WeaponId>;
  private readyAt = 0;
  private ordnanceRankValue = 0;
  private ownedCache: WeaponId[] | null = null;

  constructor(private readonly data: WeaponsData = WEAPONS_DATA) {
    this.current = data.startingWeapon;
    this.owned = new Set<WeaponId>([data.startingWeapon]);
  }

  get spec(): WeaponSpec {
    return WEAPONS[this.current];
  }

  /**
   * The same array until ownership changes; the HUD reads it every frame, so filtering per call would
   * allocate sixty arrays a second. Treat it as read-only.
   */
  get ownedWeapons(): WeaponId[] {
    this.ownedCache ??= this.data.order.filter((id) => this.owned.has(id));
    return this.ownedCache;
  }

  owns(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  /** Picking a weapon up both unlocks and equips it. */
  grant(id: WeaponId): void {
    this.owned.add(id);
    this.ownedCache = null;
    this.current = id;
  }

  /** Keys 1-3: switch to a weapon slot if it has been unlocked. */
  select(index: number): boolean {
    const id = this.data.order[index];
    if (!id || !this.owned.has(id) || id === this.current) return false;
    this.current = id;
    return true;
  }

  /** Mouse wheel: step to the next unlocked weapon in slot order, wrapping around. */
  cycle(direction: 1 | -1): boolean {
    const index = cycleIndex(this.data.order, this.ownedWeapons, this.current, direction);
    const id = this.data.order[index];
    if (!id || id === this.current) return false;
    this.current = id;
    return true;
  }

  /** Unlock the next weapon the player does not own (used by weapon pickups). */
  nextLockedWeapon(): WeaponId | null {
    return this.data.order.find((id) => !this.owned.has(id)) ?? null;
  }

  /** Ordnance ranks collected since the run started. */
  get ordnanceRank(): number {
    return this.ordnanceRankValue;
  }

  /** Damage multiplier the whole arsenal shares. */
  get damageScale(): number {
    return ordnanceDamageScale(this.ordnanceRankValue);
  }

  /** Spend a weapon pickup on damage once every gun is owned. Returns the new rank. */
  addOrdnanceRank(): number {
    this.ordnanceRankValue += 1;
    return this.ordnanceRankValue;
  }

  canFire(now: number): boolean {
    return now >= this.readyAt;
  }

  timeUntilReady(now: number): number {
    return Math.max(0, this.readyAt - now);
  }

  fire(now: number, aimAngle: number, rng: Rng = Math.random): Shot[] {
    if (!this.canFire(now)) return [];
    this.readyAt = now + fireIntervalMs(this.spec);
    return shotsFor(this.spec, aimAngle, rng);
  }
}
