/**
 * A Task's due moment — pure domain (`specs/165-task-management/` research
 * R-17, data-model §5).
 *
 * A Task is due either **at a moment** (`dueAt`, an instant) or **on a day**
 * (`dueOn` alone, a calendar date). Days are counted in `tasks.time_zone`
 * (default `Europe/Warsaw`): a moment's due date is its day there, and a
 * date-only Task becomes overdue when that day is over there. Only an open
 * Task can be overdue.
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

/** The due date a due moment stores beside it: its day in `timeZone`. */
export function dueOnFor(dueAt: Date, timeZone: string): string {
  return todayIn(timeZone, dueAt);
}

export interface DueState {
  /** Category `done` or `cancelled`. */
  closed: boolean;
  dueOn: string | null;
  dueAt: Date | null;
}

/** Open and past its due moment — at the moment itself, or once its day is over in `timeZone`. */
export function isOverdue(task: DueState, now: Date, timeZone: string): boolean {
  if (task.closed) return false;
  if (task.dueAt) return now.getTime() > task.dueAt.getTime();
  if (task.dueOn === null) return false;
  return todayIn(timeZone, now) > task.dueOn;
}

/** How far `timeZone` is ahead of UTC at `at`, in minutes. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant a date-only due moment counts as for a relative reminder:
 * `hour`:00 on that day in `timeZone` (09:00 by default, data-model §5).
 */
export function dateOnlyMoment(dueOn: string, timeZone: string, hour = 9): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  if (!match) throw new RangeError(`"${dueOn}" is not a calendar date (YYYY-MM-DD).`);
  const wallClock = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour);
  // The offset at the wall-clock time read as UTC is the right one except across
  // a change between the two; asking again at the first answer settles it.
  const first = wallClock - offsetMinutes(timeZone, new Date(wallClock)) * 60_000;
  return new Date(wallClock - offsetMinutes(timeZone, new Date(first)) * 60_000);
}
