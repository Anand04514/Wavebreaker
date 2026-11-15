/**
 * Timed pick-up buffs (damage overdrive, invulnerability shield).
 *
 * Buffs are stored as an "until" timestamp and compared against the scene clock, so pausing
 * freezes them for free. The maths is pure and unit-tested in tests/buffs.test.ts.
 */

/** Timestamp (ms, scene clock) at which a buff stops applying. */
export type BuffTimer = number;

/**
 * Picking a buff up starts its timer, and stacks when one is already running: the full duration is
 * added on top of whatever time was left, so two Damage drops in a row are worth 50 s, not 25 s.
 * Pass the buff's current expiry as `current` (the default treats it as unset).
 */
export function activateBuff(
  now: number,
  durationMs: number,
  current: BuffTimer = now,
): BuffTimer {
  return now + buffRemainingMs(current, now) + Math.max(0, durationMs);
}

export function isBuffActive(until: BuffTimer, now: number): boolean {
  return now < until;
}

export function buffRemainingMs(until: BuffTimer, now: number): number {
  return Math.max(0, until - now);
}

/** Base value with the buff factor applied only while the buff is up. */
export function buffedValue(base: number, factor: number, active: boolean): number {
  return active ? base * factor : base;
}

/** "18.0s" style label used by the HUD timers. */
export function formatBuffSeconds(remainingMs: number): string {
  return `${(Math.max(0, remainingMs) / 1000).toFixed(1)}s`;
}
