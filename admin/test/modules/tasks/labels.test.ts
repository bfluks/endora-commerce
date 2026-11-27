import { describe, expect, it } from 'vitest';
import {
  calendarDateLabel,
  fileSizeLabel,
  instantDateLabel,
  momentLabel,
} from '../../../../packages/modules/tasks/src/admin/lib/labels';

/**
 * One date formatter for the Tasks screens, keyed to the admin UI language
 * (165 T095): the walk found `10/30/2026` on the list, `30.10.2026, 10:00:00`
 * on the detail and `Oct 30, 2026, 9:00 AM` on a reminder. A calendar date is
 * the medium date; a moment is the medium date and the short time — never
 * seconds, never the browser's own locale.
 */
describe('tasks — date labels', () => {
  const medium = (language: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium' });
  const moment = (language: string) => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });

  it('writes a calendar date as the language’s medium date, with no time-zone shift', () => {
    expect(calendarDateLabel('2026-10-30', 'en')).toBe('Oct 30, 2026');
    expect(calendarDateLabel('2026-10-30', 'pl')).toBe(medium('pl').format(new Date(2026, 9, 30)));
    expect(calendarDateLabel(null, 'en')).toBe('—');
  });

  it('writes a moment as the medium date and the short time, without seconds', () => {
    const iso = '2026-10-30T09:00:27.000Z';
    for (const language of ['en', 'pl']) {
      expect(momentLabel(iso, language)).toBe(moment(language).format(new Date(iso)));
      expect(momentLabel(iso, language)).not.toMatch(/:27/);
    }
    expect(momentLabel(null, 'en')).toBe('—');
  });

  it('writes the day of a moment as a calendar date is written', () => {
    const iso = '2026-10-30T09:00:00.000Z';
    expect(instantDateLabel(iso, 'en')).toBe(medium('en').format(new Date(iso)));
    expect(instantDateLabel('not a date', 'en')).toBeNull();
  });

  it('writes a file size with its plural under a kilobyte and the unit symbol above (T095: "193 byte")', () => {
    expect(fileSizeLabel(1, 'en')).toBe('1 byte');
    expect(fileSizeLabel(193, 'en')).toBe('193 bytes');
    expect(fileSizeLabel(193, 'pl')).toBe('193 bajty');
    expect(fileSizeLabel(5, 'pl')).toBe('5 bajtów');
    expect(fileSizeLabel(2560, 'en')).toBe('2.5 kB');
    expect(fileSizeLabel(5 * 1024 * 1024, 'pl')).toBe('5 MB');
  });
});
