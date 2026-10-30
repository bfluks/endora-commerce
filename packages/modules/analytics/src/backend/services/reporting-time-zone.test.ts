import { ANALYTICS_REPORTING_TIME_ZONE_SETTING, type SettingWriteValidationInput } from '@endora-commerce/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createReportingTimeZonePort, createReportingTimeZoneValidator } from './reporting-time-zone.js';

/**
 * `analytics.reporting_time_zone` — the calendar reports count days in (owner
 * decisions 2026-10-27, issue #465). Owned by `analytics`; Projects reads it
 * through `reportingTimeZonePort`, CRM may later (#474).
 */
describe('the reporting time zone', () => {
  const validator = createReportingTimeZoneValidator();
  const input = (proposedValue: unknown): SettingWriteValidationInput => ({
    code: ANALYTICS_REPORTING_TIME_ZONE_SETTING,
    ownerModuleId: 'analytics',
    proposedValue,
    projection: [],
    targetedChannelIds: [],
  });

  it('is analytics.reporting_time_zone, answered for by analytics', () => {
    expect(ANALYTICS_REPORTING_TIME_ZONE_SETTING).toBe('analytics.reporting_time_zone');
    expect(validator).toMatchObject({ contributorModuleId: 'analytics', codes: ['analytics.reporting_time_zone'] });
  });

  it('accepts UTC and IANA zones', async () => {
    for (const zone of ['UTC', 'Europe/Warsaw', 'America/New_York']) {
      await expect(validator.validate(input(zone))).resolves.toBeUndefined();
    }
  });

  it('refuses anything else with 422 VALIDATION_FAILED', async () => {
    for (const value of ['Mars/Olympus_Mons', '', 'europe/warsaw ', 42, null]) {
      await expect(validator.validate(input(value))).rejects.toMatchObject({
        statusCode: 422,
        code: 'VALIDATION_FAILED',
      });
    }
  });

  it('the port reads the setting platform-wide', async () => {
    const get = vi.fn(async () => 'Europe/Warsaw');
    const port = createReportingTimeZonePort({ get } as never);
    await expect(port.timeZone()).resolves.toBe('Europe/Warsaw');
    expect(get).toHaveBeenCalledWith('analytics.reporting_time_zone', null, expect.anything());
  });
});
