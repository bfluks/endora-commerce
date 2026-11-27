import type { FastifyInstance } from 'fastify';
import { SetTaskTimeZoneBodySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskSettingsService } from '../services/task-settings-service.js';

export interface TaskSettingsRoutesDeps {
  settingsService: Pick<TaskSettingsService, 'timeZone' | 'setTimeZone'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks/settings';

/**
 * The general Task settings (`specs/165-task-management/contracts/admin-api.md`
 * §4): the time zone date-only due dates, relative reminders and the digest
 * hour are counted in. Read on `tasks:read` — the screens need it — and
 * written on `tasks:configure`, through `settings`' own audited write, whose
 * validator registry refuses a zone the runtime does not know (422).
 */
export async function registerTaskSettingsRoutes(app: FastifyInstance, deps: TaskSettingsRoutesDeps): Promise<void> {
  const { requireAdmin, settingsService } = deps;

  app.get(`${API}/time-zone`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await settingsService.timeZone(),
  }));

  app.put(
    `${API}/time-zone`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: SetTaskTimeZoneBodySchema } },
    async (request) => ({
      data: await settingsService.setTimeZone(SetTaskTimeZoneBodySchema.parse(request.body).timeZone),
    }),
  );
}
