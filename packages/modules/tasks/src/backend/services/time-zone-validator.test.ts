import { describe, expect, it } from 'vitest';
import { createTaskTimeZoneValidator, isKnownTimeZone, TASK_TIME_ZONE_SETTING } from './time-zone-validator.js';

describe('the tasks.time_zone validator', () => {
  it('knows IANA zones and UTC', () => {
    for (const zone of ['Europe/Warsaw', 'America/New_York', 'Asia/Tokyo', 'UTC']) {
      expect(isKnownTimeZone(zone), zone).toBe(true);
    }
  });

  it('refuses anything else', () => {
    for (const value of ['', 'Mars/Olympus_Mons', 'europe/warsaw ', 'GMT+25', 42, null]) {
      expect(isKnownTimeZone(value), String(value)).toBe(false);
    }
  });

  it('answers for its one setting and refuses an unknown zone with 422', async () => {
    const validator = createTaskTimeZoneValidator();
    expect(TASK_TIME_ZONE_SETTING).toBe('tasks.time_zone');
    expect(validator).toMatchObject({ contributorModuleId: 'tasks', codes: ['tasks.time_zone'] });
    const input = (proposedValue: unknown) => ({
      code: 'tasks.time_zone',
      ownerModuleId: 'tasks',
      proposedValue,
      projection: [],
      targetedChannelIds: [],
    });
    await expect(validator.validate(input('Europe/Warsaw'))).resolves.toBeUndefined();
    await expect(validator.validate(input('Mars/Olympus_Mons'))).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
    });
  });
});
