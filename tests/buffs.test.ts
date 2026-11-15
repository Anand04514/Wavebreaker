import { describe, expect, it } from 'vitest';
import {
  activateBuff,
  buffedValue,
  buffRemainingMs,
  formatBuffSeconds,
  isBuffActive,
} from '../src/systems/Buffs';

describe('activateBuff', () => {
  it('sets the expiry a full duration after now', () => {
    expect(activateBuff(1000, 18000)).toBe(19000);
  });

  it('treats a non-positive duration as already expired', () => {
    expect(activateBuff(1000, 0)).toBe(1000);
    expect(activateBuff(1000, -500)).toBe(1000);
  });

  it('adds the full duration on top of the time already left', () => {
    const first = activateBuff(1000, 10000); // expires at 11 000
    // Collected again at 4 000 with 7 000 left: 7 + 10 = 17 s from now.
    const second = activateBuff(4000, 10000, first);
    expect(second).toBe(21000);
    expect(buffRemainingMs(second, 4000)).toBe(17000);
  });

  it('stacks without reviving an expired timer', () => {
    const expired = activateBuff(1000, 10000); // expires at 11 000
    expect(activateBuff(20000, 10000, expired)).toBe(30000);
  });

  it('behaves like a fresh pickup when no timer is passed', () => {
    expect(activateBuff(4000, 10000)).toBe(14000);
  });
});

describe('isBuffActive', () => {
  it('is true before the expiry and false from the expiry onwards', () => {
    expect(isBuffActive(5000, 0)).toBe(true);
    expect(isBuffActive(5000, 4999)).toBe(true);
    expect(isBuffActive(5000, 5000)).toBe(false);
    expect(isBuffActive(5000, 5001)).toBe(false);
  });

  it('is false for an never-activated buff', () => {
    expect(isBuffActive(0, 0)).toBe(false);
    expect(isBuffActive(0, 12345)).toBe(false);
  });
});

describe('buffRemainingMs', () => {
  it('counts down and never goes negative', () => {
    expect(buffRemainingMs(5000, 1000)).toBe(4000);
    expect(buffRemainingMs(5000, 5000)).toBe(0);
    expect(buffRemainingMs(5000, 9000)).toBe(0);
  });
});

describe('buffedValue', () => {
  it('multiplies the base value only while the buff is up', () => {
    expect(buffedValue(0.75, 2, true)).toBe(1.5);
    expect(buffedValue(0.75, 2, false)).toBe(0.75);
  });

  it('leaves the value untouched for a 1x factor', () => {
    expect(buffedValue(10, 1, true)).toBe(10);
  });
});

describe('formatBuffSeconds', () => {
  it('renders one decimal place', () => {
    expect(formatBuffSeconds(18000)).toBe('18.0s');
    expect(formatBuffSeconds(9500)).toBe('9.5s');
    expect(formatBuffSeconds(0)).toBe('0.0s');
    expect(formatBuffSeconds(-200)).toBe('0.0s');
  });
});
