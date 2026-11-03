import { describe, expect, it } from 'vitest';
import { dateOnlyMoment, dueOnFor, isOverdue, todayIn } from './due-moment.js';

const WARSAW = 'Europe/Warsaw';

describe('due-moment — overdue at a time and at a date only (research R-17)', () => {
  it('derives the due date of a due moment in the Tasks time zone', () => {
    // 23:30 UTC on the 27th is 00:30 on the 28th in Warsaw (CET, +1).
    expect(dueOnFor(new Date('2026-11-27T23:30:00Z'), WARSAW)).toBe('2026-11-28');
    expect(dueOnFor(new Date('2026-11-27T22:30:00Z'), WARSAW)).toBe('2026-11-27');
    expect(dueOnFor(new Date('2026-11-27T23:30:00Z'), 'UTC')).toBe('2026-11-27');
  });

  it('a Task with a due moment is overdue once that moment has passed', () => {
    const task = { closed: false, dueOn: '2026-11-27', dueAt: new Date('2026-11-27T09:00:00Z') };
    expect(isOverdue(task, new Date('2026-11-27T09:00:00Z'), WARSAW)).toBe(false);
    expect(isOverdue(task, new Date('2026-11-27T09:00:01Z'), WARSAW)).toBe(true);
  });

  it('a Task with a date only is overdue once that date is over in the Tasks time zone — across the DST end', () => {
    // CEST (+2) until 2026-10-25 03:00, CET (+1) after.
    const before = { closed: false, dueOn: '2026-10-24', dueAt: null };
    expect(isOverdue(before, new Date('2026-10-24T21:59:59Z'), WARSAW)).toBe(false);
    expect(isOverdue(before, new Date('2026-10-24T22:00:00Z'), WARSAW)).toBe(true);
    const on = { closed: false, dueOn: '2026-10-25', dueAt: null };
    expect(isOverdue(on, new Date('2026-10-25T22:59:59Z'), WARSAW)).toBe(false);
    expect(isOverdue(on, new Date('2026-10-25T23:00:00Z'), WARSAW)).toBe(true);
  });

  it('a Task with a date only, across the DST start', () => {
    // CET (+1) until 2026-03-29 02:00, CEST (+2) after.
    const task = { closed: false, dueOn: '2026-03-29', dueAt: null };
    expect(isOverdue(task, new Date('2026-03-29T21:59:59Z'), WARSAW)).toBe(false);
    expect(isOverdue(task, new Date('2026-03-29T22:00:00Z'), WARSAW)).toBe(true);
  });

  it('a closed Task, or one without a due date, is never overdue', () => {
    const late = new Date('2030-01-01T00:00:00Z');
    expect(isOverdue({ closed: true, dueOn: '2026-01-01', dueAt: null }, late, WARSAW)).toBe(false);
    expect(isOverdue({ closed: true, dueOn: '2026-01-01', dueAt: new Date('2026-01-01T00:00:00Z') }, late, WARSAW)).toBe(
      false,
    );
    expect(isOverdue({ closed: false, dueOn: null, dueAt: null }, late, WARSAW)).toBe(false);
  });

  it('counts a date-only due moment as 09:00 in the Tasks time zone, whichever side of a DST change', () => {
    expect(dateOnlyMoment('2026-03-28', WARSAW).toISOString()).toBe('2026-03-28T08:00:00.000Z');
    expect(dateOnlyMoment('2026-03-29', WARSAW).toISOString()).toBe('2026-03-29T07:00:00.000Z');
    expect(dateOnlyMoment('2026-10-25', WARSAW).toISOString()).toBe('2026-10-25T08:00:00.000Z');
    expect(dateOnlyMoment('2026-10-24', WARSAW).toISOString()).toBe('2026-10-24T07:00:00.000Z');
  });

  it('todayIn: the calendar day of a moment in a zone', () => {
    expect(todayIn(WARSAW, new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('UTC', new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-24');
  });
});
