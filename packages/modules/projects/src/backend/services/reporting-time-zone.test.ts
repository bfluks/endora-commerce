import { describe, expect, it, vi } from 'vitest';
import { reportingTimeZoneOf } from './reporting-time-zone.js';

/**
 * Which calendar Projects analytics count days in (T146): the `analytics`
 * module's `analytics.reporting_time_zone` while that module is present, and
 * `UTC` while it is not — decided before the gated port is touched, so an
 * absent owner degrades the figures and never fails them.
 */
describe('the reporting time zone Projects counts in', () => {
  it('is the analytics setting while analytics is present', async () => {
    const port = { timeZone: vi.fn(async () => 'Europe/Warsaw') };
    await expect(reportingTimeZoneOf({ present: () => true, port })()).resolves.toBe('Europe/Warsaw');
  });

  it('is UTC while analytics is absent, without touching its port', async () => {
    const port = { timeZone: vi.fn(async () => { throw new Error('MODULE_DISABLED'); }) };
    await expect(reportingTimeZoneOf({ present: () => false, port })()).resolves.toBe('UTC');
    expect(port.timeZone).not.toHaveBeenCalled();
  });
});
