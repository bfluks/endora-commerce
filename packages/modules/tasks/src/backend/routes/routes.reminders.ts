import type { FastifyInstance } from 'fastify';
import { CreateTaskReminderBodySchema, SetTaskDigestBodySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskDigestService } from '../services/digest-service.js';
import type { TaskReminderService } from '../services/reminder-service.js';

export interface TaskReminderRoutesDeps {
  reminderService: Pick<TaskReminderService, 'list' | 'add' | 'remove'>;
  digestService: Pick<TaskDigestService, 'mine' | 'subscribe' | 'unsubscribe'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * Reminders and the daily digest (`specs/165-task-management/contracts/admin-api.md`
 * §2, §5; User Story 7).
 *
 * A Task's reminders are read on `tasks:read` — each reader is shown only
 * their own and those that name them — and added on `tasks:write`. Removing
 * one is the reminder's creator's **or** a writer's, which a route gate cannot
 * say: the route asks `tasks:read` and the service decides (403 otherwise).
 *
 * The digest is the caller's own, on `tasks:read`; the static `me` segment
 * outranks `tasks/:id`.
 */
export async function registerTaskReminderRoutes(app: FastifyInstance, deps: TaskReminderRoutesDeps): Promise<void> {
  const { requireAdmin, reminderService: reminders, digestService: digest } = deps;

  app.get<{ Params: { id: string } }>(
    `${API}/:id/reminders`,
    { preHandler: requireAdmin('tasks:read') },
    async (request) => ({ data: await reminders.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/reminders`,
    { preHandler: requireAdmin('tasks:write'), schema: { body: CreateTaskReminderBodySchema } },
    async (request, reply) => {
      const reminder = await reminders.add(request.params.id, CreateTaskReminderBodySchema.parse(request.body));
      reply.code(201);
      return { data: reminder };
    },
  );

  app.delete<{ Params: { id: string; reminderId: string } }>(
    `${API}/:id/reminders/:reminderId`,
    { preHandler: requireAdmin('tasks:read') },
    async (request, reply) => {
      await reminders.remove(request.params.id, request.params.reminderId);
      reply.code(204);
    },
  );

  app.get(`${API}/me/digest`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await digest.mine(),
  }));

  app.put(
    `${API}/me/digest`,
    { preHandler: requireAdmin('tasks:read'), schema: { body: SetTaskDigestBodySchema } },
    async (request) => ({ data: await digest.subscribe(SetTaskDigestBodySchema.parse(request.body).hour) }),
  );

  app.delete(`${API}/me/digest`, { preHandler: requireAdmin('tasks:read') }, async (_request, reply) => {
    await digest.unsubscribe();
    reply.code(204);
  });
}
