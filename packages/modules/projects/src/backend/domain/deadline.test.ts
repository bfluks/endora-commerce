import { describe, expect, it } from 'vitest';
import { addDays, computeDeadline, enterStage, recomputeDeadline, todayIn } from './deadline.js';

/**
 * A Stage's start date and deadline (FR-013, research R-5): counted in whole
 * calendar days, in the time zone of `projects.alerts_time_zone`.
 */

describe('todayIn', () => {
  it('is the calendar day in the zone, not in UTC', () => {
    // 23:30 UTC on 31 December is already 1 January in Warsaw (UTC+1 in winter).
    const instant = new Date('2026-12-31T23:30:00Z');
    expect(todayIn('Europe/Warsaw', instant)).toBe('2027-01-01');
    expect(todayIn('UTC', instant)).toBe('2026-12-31');
    expect(todayIn('America/New_York', instant)).toBe('2026-12-31');
  });

  it('crosses the October DST change on the right day', () => {
    // 25 Oct 2026, 22:30 UTC = 23:30 CET (the clocks went back that morning).
    expect(todayIn('Europe/Warsaw', new Date('2026-10-25T22:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/Warsaw', new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
  });

  it('refuses a zone that is not one', () => {
    expect(() => todayIn('Mars/Olympus_Mons', new Date())).toThrow(RangeError);
  });
});

describe('addDays and computeDeadline', () => {
  it('deadline = start + planned duration, across a month, a year and a leap day', () => {
    expect(computeDeadline('2026-10-26', 10)).toBe('2026-11-05');
    expect(computeDeadline('2026-12-25', 10)).toBe('2027-01-04');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('a zero duration puts the deadline on the day of entry', () => {
    expect(computeDeadline('2026-10-26', 0)).toBe('2026-10-26');
  });
});

describe('enterStage', () => {
  const fresh = { startedOn: null, deadlineOn: null, deadlineManual: false, plannedDurationDays: 5 };

  it('records the start and computes the deadline', () => {
    expect(enterStage(fresh, '2026-10-26')).toEqual({ startedOn: '2026-10-26', deadlineOn: '2026-10-31' });
  });

  it('keeps a deadline set by hand', () => {
    expect(
      enterStage({ ...fresh, deadlineOn: '2026-12-01', deadlineManual: true }, '2026-10-26'),
    ).toEqual({ startedOn: '2026-10-26', deadlineOn: '2026-12-01' });
  });

  it('re-entering restarts the start and recomputes a computed deadline', () => {
    const left = { ...fresh, startedOn: '2026-09-01', deadlineOn: '2026-09-06' };
    expect(enterStage(left, '2026-10-26')).toEqual({ startedOn: '2026-10-26', deadlineOn: '2026-10-31' });
  });
});

describe('recomputeDeadline', () => {
  it('a manual deadline is kept whatever the duration says', () => {
    expect(
      recomputeDeadline({ startedOn: '2026-10-01', deadlineOn: '2026-12-24', deadlineManual: true, plannedDurationDays: 3 }),
    ).toBe('2026-12-24');
  });

  it('an entered Stage’s computed deadline follows its duration', () => {
    expect(
      recomputeDeadline({ startedOn: '2026-10-01', deadlineOn: '2026-10-04', deadlineManual: false, plannedDurationDays: 9 }),
    ).toBe('2026-10-10');
  });

  it('a Stage never entered has no computed deadline', () => {
    expect(
      recomputeDeadline({ startedOn: null, deadlineOn: null, deadlineManual: false, plannedDurationDays: 9 }),
    ).toBeNull();
  });
});
