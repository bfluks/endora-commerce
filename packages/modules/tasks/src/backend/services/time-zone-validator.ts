import { ERROR_CODES, isIanaTimeZone, type SettingWriteValidator } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/** The calendar of Tasks: date-only due dates, relative reminders and the digest hour (research R-17). */
export const TASK_TIME_ZONE_SETTING = 'tasks.time_zone';

/**
 * `tasks.time_zone` must be a time zone the runtime knows (`isIanaTimeZone`,
 * the statement the reporting time zone uses too): a date-only due date, a
 * relative reminder's moment and the digest's hour are each counted in it,
 * and an unknown zone would make each of them fail (`todayIn` throws a
 * `RangeError`). Projects' `alerts-time-zone-validator.ts`, copied — a
 * module's internals are not another module's to import, and the helper is too
 * small to widen the platform's published surface for.
 */
export function isKnownTimeZone(value: unknown): boolean {
  return isIanaTimeZone(value);
}

export function createTaskTimeZoneValidator(): SettingWriteValidator {
  return {
    contributorModuleId: 'tasks',
    codes: [TASK_TIME_ZONE_SETTING],
    validate: async (input) => {
      if (!isKnownTimeZone(input.proposedValue)) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'The time zone must be an IANA time zone name, such as Europe/Warsaw.',
        );
      }
    },
  };
}
