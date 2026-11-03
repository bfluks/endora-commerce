/**
 * A Stage's start date and deadline — pure domain (FR-013, research R-5).
 *
 * Dates are calendar days (`YYYY-MM-DD`), never instants: a Stage starts on
 * the day it is entered, counted in the module's time zone
 * (`projects.alerts_time_zone`, the calendar every "today" of the module is
 * counted in), and its deadline is that day plus its planned duration —
 * unless somebody set the deadline by hand, which then stays put.
 */

/** The calendar day `now` falls on in `timeZone`. Throws `RangeError` for a zone that is not one. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** `date` plus `days` calendar days. Counted in UTC, where a day is always 24 hours. */
export function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`"${date}" is not a calendar date (YYYY-MM-DD).`);
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/** The computed deadline: the start plus the planned duration — the start itself for zero days. */
export function computeDeadline(startedOn: string, plannedDurationDays: number): string {
  return addDays(startedOn, plannedDurationDays);
}

/** What the dates of a Stage depend on. */
export interface StageDates {
  startedOn: string | null;
  deadlineOn: string | null;
  deadlineManual: boolean;
  plannedDurationDays: number;
}

/**
 * Entering (or re-entering) a Stage on `today`: the start restarts, and a
 * computed deadline is recomputed from it; a manual one is kept.
 */
export function enterStage(stage: StageDates, today: string): { startedOn: string; deadlineOn: string | null } {
  return {
    startedOn: today,
    deadlineOn: stage.deadlineManual ? stage.deadlineOn : computeDeadline(today, stage.plannedDurationDays),
  };
}

/**
 * The deadline after the Stage changed (its duration, or the manual deadline
 * dropped): a manual deadline is kept; a Stage entered gets start + duration;
 * a Stage never entered has none.
 */
export function recomputeDeadline(stage: StageDates): string | null {
  if (stage.deadlineManual) return stage.deadlineOn;
  return stage.startedOn === null ? null : computeDeadline(stage.startedOn, stage.plannedDurationDays);
}
