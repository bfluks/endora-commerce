import { ApiError } from '@endora-commerce/admin-kit/lib';

/** What a cell shows when there is nothing to show. */
export const NO_VALUE = '—';

/**
 * The sentence to show for a failed call.
 *
 * The backend already resolved `error.message` in the reader's language, so it
 * is shown as it arrived. `fallback` is for a failure that never produced an
 * envelope.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/*
 * Dates on the Tasks screens are written one way, in the admin UI language
 * (165 T095): a calendar date as the language's medium date (*Oct 30, 2026*
 * in English), a moment as that date and the short time — never seconds,
 * never the browser's own locale.
 */
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(language: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${language}|${withTime ? 'moment' : 'date'}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(language, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
    dateFormats.set(key, format);
  }
  return format;
}

/** A `YYYY-MM-DD` calendar date in the reader's language, without a time-zone shift. */
export function calendarDateLabel(date: string | null | undefined, language: string): string {
  if (!date) return NO_VALUE;
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return date;
  return dateFormat(language, false).format(new Date(year, month - 1, day));
}

/** A moment (an ISO instant) in the reader's language: its date and its time, without seconds. */
export function momentLabel(iso: string | null | undefined, language: string): string {
  if (!iso) return NO_VALUE;
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? iso : dateFormat(language, true).format(moment);
}

/** The day of a moment, written as a calendar date is; `null` for what is not a moment. */
export function instantDateLabel(iso: string, language: string): string | null {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? null : dateFormat(language, false).format(moment);
}

const SIZE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const;

/**
 * A file size as a person reads it — *193 bytes*, *2.5 MB* — in the language on
 * screen (Projects' helper). Under a kilobyte the unit is spelled out, which
 * gives it the language's plural forms; the short form of `byte` is
 * *byte* in English, which the walk found as *193 byte* (165 T095).
 */
export function fileSizeLabel(bytes: number, language: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: SIZE_UNITS[unit] as string,
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
}

/** A workflow status's name in the reader's language: the name, the default name, the code. */
export function workflowStatusName(
  status: { code: string; name: Record<string, string>; defaultName?: string | null },
  language: string,
): string {
  return status.name[language] || status.defaultName || status.code;
}
