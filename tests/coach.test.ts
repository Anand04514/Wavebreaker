import { describe, expect, it } from 'vitest';
import { COACH } from '../src/config';
import { coachTipDue } from '../src/systems/SpawnLogic';

const timing = { firstDelayMs: 3000, staggerMs: 7000 };

describe('coachTipDue', () => {
  it('holds the first tip until its delay has passed', () => {
    expect(coachTipDue(['bomb', 'dash'], 0, 2999, timing)).toBeNull();
    expect(coachTipDue(['bomb', 'dash'], 0, 3000, timing)).toBe('bomb');
  });

  it('staggeres the next tip from the one before it', () => {
    expect(coachTipDue(['dash'], 1, 9999, timing)).toBeNull();
    expect(coachTipDue(['dash'], 1, 10000, timing)).toBe('dash');
  });

  it('asks for nothing once every tip has been shown', () => {
    expect(coachTipDue([], 2, 60000, timing)).toBeNull();
  });

  it('still offers a pending tip after a long run', () => {
    expect(coachTipDue(['bomb'], 0, 45000, timing)).toBe('bomb');
  });

  it('keeps the shipped timing ordered: the second tip waits for the first', () => {
    expect(coachTipDue(['bomb', 'dash'], 0, COACH.firstDelayMs, COACH)).toBe('bomb');
    expect(coachTipDue(['dash'], 1, COACH.firstDelayMs + COACH.staggerMs - 1, COACH)).toBeNull();
    expect(coachTipDue(['dash'], 1, COACH.firstDelayMs + COACH.staggerMs, COACH)).toBe('dash');
  });
});
