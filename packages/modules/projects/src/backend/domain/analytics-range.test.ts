import { describe, expect, it } from 'vitest';
import { analyticsRange, completionRate, secondsToDays, shareOf } from './analytics-range.js';

/**
 * The range and the ratios of Project analytics (research R-15, FR-037,
 * FR-038) — pure, so the SQL only counts and sums.
 */

describe('analyticsRange', () => {
  it('runs from the first day at midnight UTC to the midnight after the last, the last day included', () => {
    const { start, end } = analyticsRange({ from: '2026-01-01', to: '2026-01-31' }, 'UTC');
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('is one whole day when both ends are the same day', () => {
    const { start, end } = analyticsRange({ from: '2026-10-25', to: '2026-10-25' }, 'UTC');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });

  it('crosses a year and a leap day', () => {
    expect(analyticsRange({ from: '2028-02-28', to: '2028-02-29' }, 'UTC').end.toISOString()).toBe('2028-03-01T00:00:00.000Z');
    expect(analyticsRange({ from: '2026-12-31', to: '2026-12-31' }, 'UTC').end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('refuses a range that ends before it starts, or a day that is not one', () => {
    expect(() => analyticsRange({ from: '2026-02-01', to: '2026-01-31' }, 'UTC')).toThrow(RangeError);
    expect(() => analyticsRange({ from: 'yesterday', to: '2026-01-31' }, 'UTC')).toThrow(RangeError);
  });

  describe('in the reporting time zone (T146, #465)', () => {
    const iso = (range: { start: Date; end: Date }) => [range.start.toISOString(), range.end.toISOString()];

    it('starts and ends at midnight in the zone, not in UTC', () => {
      // Warsaw is UTC+1 in January: its 1 January begins at 23:00 UTC on 31 December.
      expect(iso(analyticsRange({ from: '2026-01-01', to: '2026-01-31' }, 'Europe/Warsaw'))).toEqual([
        '2025-12-31T23:00:00.000Z',
        '2026-01-31T23:00:00.000Z',
      ]);
      // West of Greenwich the day begins later: New York is UTC−5 in January.
      expect(iso(analyticsRange({ from: '2026-01-01', to: '2026-01-01' }, 'America/New_York'))).toEqual([
        '2026-01-01T05:00:00.000Z',
        '2026-01-02T05:00:00.000Z',
      ]);
    });

    it('counts an instant just after midnight in the zone in that day, and one just before in the day before', () => {
      const { start, end } = analyticsRange({ from: '2026-01-01', to: '2026-01-01' }, 'Europe/Warsaw');
      const at = (instant: string) => new Date(instant);
      const inside = (instant: string) => at(instant) >= start && at(instant) < end;
      // 00:30 on 1 January in Warsaw is 23:30 UTC the day before — inside; UTC would leave it out.
      expect(inside('2025-12-31T23:30:00.000Z')).toBe(true);
      // 23:30 on 1 January in Warsaw is 22:30 UTC — inside; 00:30 on 2 January is not.
      expect(inside('2026-01-01T22:30:00.000Z')).toBe(true);
      expect(inside('2026-01-01T23:30:00.000Z')).toBe(false);
    });

    it('takes a month across a change of offset at its own midnights', () => {
      // October 2026 in Warsaw: summer time (UTC+2) at its start, winter time (UTC+1) at its end.
      expect(iso(analyticsRange({ from: '2026-10-01', to: '2026-10-31' }, 'Europe/Warsaw'))).toEqual([
        '2026-09-30T22:00:00.000Z',
        '2026-10-31T23:00:00.000Z',
      ]);
      // The day the clocks go forward is 23 hours long.
      const spring = analyticsRange({ from: '2026-03-29', to: '2026-03-29' }, 'Europe/Warsaw');
      expect(spring.end.getTime() - spring.start.getTime()).toBe(23 * 3_600_000);
    });

    it('in UTC answers exactly what the range answered before the setting existed', () => {
      for (const range of [
        { from: '2026-01-01', to: '2026-01-31' },
        { from: '2028-02-28', to: '2028-02-29' },
        { from: '2026-10-01', to: '2026-10-31' },
      ]) {
        const { start, end } = analyticsRange(range, 'UTC');
        expect(start.toISOString()).toBe(`${range.from}T00:00:00.000Z`);
        expect(end.getTime()).toBe(new Date(`${range.to}T00:00:00.000Z`).getTime() + 86_400_000);
      }
    });
  });
});

describe('the ratios', () => {
  it('completion rate is completed over closed, and nothing when nothing closed', () => {
    expect(completionRate(14, 15)).toBeCloseTo(14 / 29, 12);
    expect(completionRate(3, 0)).toBe(1);
    expect(completionRate(0, 0)).toBeNull();
  });

  it('a share is a part of its whole, and zero of nothing', () => {
    expect(shareOf(7, 15)).toBeCloseTo(7 / 15, 12);
    expect(shareOf(0, 0)).toBe(0);
  });

  it('seconds read as days, and an average over nothing is nothing', () => {
    expect(secondsToDays(86_400 * 1.5)).toBe(1.5);
    expect(secondsToDays(null)).toBeNull();
  });
});
