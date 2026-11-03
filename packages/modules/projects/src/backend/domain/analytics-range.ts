/**
 * The range and the ratios of Project analytics — pure domain
 * (`specs/163-projects-and-tasks/research.md` R-15; spec FR-037, FR-038).
 *
 * A range is two calendar days, both included, counted in the **reporting
 * time zone** — the `analytics` module's setting `analytics.reporting_time_zone`,
 * `UTC` unless an operator chose another, and `UTC` while `analytics` is off
 * (owner decisions 2026-10-27, issue #465) — and is
 * answered as a half-open interval of instants an index on a `timestamptz`
 * column can use: `[from 00:00, the day after to 00:00)`, both midnights in
 * that zone. In `UTC` that is exactly the range the module counted before the
 * setting existed. The SQL counts and sums; what a count means as a share, a
 * rate or a number of days is said here, once.
 */

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SECONDS_PER_DAY = 86_400;
const MS_PER_DAY = SECONDS_PER_DAY * 1000;

function calendarDay(day: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DAY.exec(day);
  if (!match) throw new RangeError(`"${day}" is not a calendar date (YYYY-MM-DD).`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws a `RangeError` for a zone the runtime does not know.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of `instant` in `timeZone`, read back as if it were UTC. */
function wallClock(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/**
 * The first instant of a calendar day in `timeZone`: its midnight, or — where
 * a change of offset skips midnight — the first moment the day has. The
 * offset is read twice, because the offset at UTC midnight may not be the one
 * at the zone's midnight.
 */
function startOfDay(day: { year: number; month: number; day: number }, timeZone: string): Date {
  const asUtc = Date.UTC(day.year, day.month - 1, day.day);
  if (timeZone === 'UTC') return new Date(asUtc);
  const offsetAt = (instant: number) => wallClock(instant, timeZone) - instant;
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  const ofTheDay = (instant: number) => Math.floor(wallClock(instant, timeZone) / MS_PER_DAY) === asUtc / MS_PER_DAY;
  const candidates = [first, second].filter(ofTheDay);
  return new Date(candidates.length > 0 ? Math.min(...candidates) : Math.max(first, second));
}

/**
 * The instants a range of days covers in `timeZone`: `start` included, `end`
 * excluded. Throws `RangeError` for a range that ends before it starts — the
 * query schema refuses one first, so this is the domain's own guard — and for
 * a zone the runtime does not know (the setting's validator refuses one first).
 */
export function analyticsRange(range: { from: string; to: string }, timeZone: string): { start: Date; end: Date } {
  const first = calendarDay(range.from);
  const last = calendarDay(range.to);
  if (range.to < range.from) throw new RangeError('The range ends before it starts.');
  const after = new Date(Date.UTC(last.year, last.month - 1, last.day) + MS_PER_DAY);
  return {
    start: startOfDay(first, timeZone),
    end: startOfDay({ year: after.getUTCFullYear(), month: after.getUTCMonth() + 1, day: after.getUTCDate() }, timeZone),
  };
}

/** Completed over closed (completed + lost); `null` when nothing closed. */
export function completionRate(completed: number, lost: number): number | null {
  const closed = completed + lost;
  return closed > 0 ? completed / closed : null;
}

/** A part of its whole; `0` of nothing. */
export function shareOf(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/** An average in seconds as days; `null` stays `null` (an average over nothing). */
export function secondsToDays(seconds: number | null): number | null {
  return seconds === null ? null : seconds / SECONDS_PER_DAY;
}
