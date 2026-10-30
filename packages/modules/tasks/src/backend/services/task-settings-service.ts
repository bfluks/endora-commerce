import { TaskTimeZoneSchema, type SettingsAdminPort, type TaskTimeZone } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { actingAdminUserId } from './task-access.js';
import { TASK_TIME_ZONE_SETTING } from './time-zone-validator.js';

export interface TaskSettingsServiceDeps {
  /** Ports of other modules — lazy, resolved per call, never captured. */
  settings: SettingsReadPort;
  settingsAdmin: SettingsAdminPort;
}

/**
 * `tasks.time_zone` (`specs/165-task-management/` research R-17, data-model
 * §4) — the calendar of Tasks. Written through `settings`' own audited write
 * (the board card fields' precedent), so it has the cache, the audit entry and
 * the validator every other setting has; `time-zone-validator.ts` is what
 * refuses a zone that is not one.
 */
export class TaskSettingsService {
  constructor(private readonly deps: TaskSettingsServiceDeps) {}

  /** `GET /tasks/settings/time-zone`. */
  async timeZone(): Promise<TaskTimeZone> {
    return {
      timeZone: await this.deps.settings.get(TASK_TIME_ZONE_SETTING, null, TaskTimeZoneSchema.shape.timeZone),
    };
  }

  /** `PUT /tasks/settings/time-zone` — 422 for a zone the runtime does not know. */
  async setTimeZone(timeZone: string): Promise<TaskTimeZone> {
    await this.deps.settingsAdmin.setValueForAllChannels(TASK_TIME_ZONE_SETTING, timeZone, null, {
      actorAdminUserId: actingAdminUserId(),
    });
    return this.timeZone();
  }
}
