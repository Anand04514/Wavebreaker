import { describe, expect, it } from 'vitest';
import { buddyPlan } from '../src/systems/SpawnLogic';

/** The tuned ranges, spelled out so a config change cannot quietly rewrite these expectations. */
const RANGE = {
  preferredRange: 260,
  slack: 60,
  fireRange: 520,
  followRange: 90,
  followSlack: 40,
};

describe('buddyPlan', () => {
  it('walks toward an enemy that is outside the kiting band', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 }, RANGE);
    expect(plan.walkTo).toEqual({ x: 1000, y: 0 });
    expect(plan.inRange).toBe(false);
    expect(plan.aimAngle).toBeCloseTo(0);
  });

  it('backs off to its preferred range when an enemy is too close', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, RANGE);
    // 260 px away from the enemy, on the side the buddy is already standing.
    expect(plan.walkTo).toEqual({ x: -160, y: 0 });
    expect(plan.inRange).toBe(true);
  });

  it('stands and shoots once inside the band', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 260, y: 0 }, RANGE);
    expect(plan.walkTo).toBeNull();
    expect(plan.inRange).toBe(true);
  });

  it('aims at the enemy, not at the player', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 500 }, { x: 0, y: 100 }, RANGE);
    expect(plan.aimAngle).toBeCloseTo(Math.PI / 2);
  });

  it('only fires inside pistol range', () => {
    const edge = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: RANGE.fireRange, y: 0 }, RANGE);
    const past = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: RANGE.fireRange + 1, y: 0 }, RANGE);
    expect(edge.inRange).toBe(true);
    expect(past.inRange).toBe(false);
  });

  it('follows the player when the field is clear', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 600, y: 0 }, null, RANGE);
    expect(plan.walkTo).toEqual({ x: 600, y: 0 });
    expect(plan.inRange).toBe(false);
  });

  it('holds near the player and does not fire at nothing', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 100, y: 0 }, null, RANGE);
    expect(plan.walkTo).toBeNull();
    expect(plan.inRange).toBe(false);
  });

  it('steps off the player when standing on top of them', () => {
    const plan = buddyPlan({ x: 0, y: 0 }, { x: 0, y: 0 }, null, RANGE);
    expect(plan.walkTo).toEqual({ x: RANGE.followRange, y: 0 });
  });
});
