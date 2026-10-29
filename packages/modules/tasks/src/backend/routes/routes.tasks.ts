import type { FastifyInstance } from 'fastify';
import {
  CreateTaskBodySchema,
  RecordHistoryQuerySchema,
  TaskAssigneeLookupQuerySchema,
  TaskListQuerySchema,
  UpdateTaskBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskHistoryService } from '../services/task-history-service.js';
import type { TaskService } from '../services/task-service.js';

export interface TaskRoutesDeps {
  taskService: TaskService;
  historyService: TaskHistoryService;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * Tasks (`specs/163-projects-and-tasks/contracts/admin-api.md` §1). Reading is
 * `tasks:read`; creating, editing, deleting and the assignee picker are
 * `tasks:write`. A Task whose context the caller may not see answers 404
 * `TASK_NOT_FOUND`, the same as a missing one, and is absent from every list.
 *
 * The static paths (`/mine`, `/lookups/assignees`) are registered before
 * `/:id`, so neither is ever read as an id.
 */
export async function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutesDeps): Promise<void> {
  const { requireAdmin, taskService: tasks, historyService: history } = deps;

  app.get(API, { preHandler: requireAdmin('tasks:read') }, async (request) =>
    tasks.list(TaskListQuerySchema.parse(request.query ?? {}), await request.responseLanguage()),
  );

  app.get(`${API}/mine`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await tasks.mine(await request.responseLanguage()),
  }));

  app.get(`${API}/lookups/assignees`, { preHandler: requireAdmin('tasks:write') }, async (request) => ({
    data: await tasks.assignees(TaskAssigneeLookupQuerySchema.parse(request.query ?? {}).q),
  }));

  app.post(
    API,
    { preHandler: requireAdmin('tasks:write'), schema: { body: CreateTaskBodySchema } },
    async (request, reply) => {
      const created = await tasks.create(CreateTaskBodySchema.parse(request.body), await request.responseLanguage());
      reply.code(201);
      return { data: created };
    },
  );

  app.get<{ Params: { id: string } }>(`${API}/:id`, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await tasks.get(request.params.id, await request.responseLanguage()),
  }));

  app.patch<{ Params: { id: string } }>(
    `${API}/:id`,
    { preHandler: requireAdmin('tasks:write'), schema: { body: UpdateTaskBodySchema } },
    async (request) => ({
      data: await tasks.update(
        request.params.id,
        UpdateTaskBodySchema.parse(request.body),
        await request.responseLanguage(),
      ),
    }),
  );

  app.delete<{ Params: { id: string } }>(
    `${API}/:id`,
    { preHandler: requireAdmin('tasks:write') },
    async (request, reply) => {
      await tasks.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API}/:id/history`,
    { preHandler: requireAdmin('tasks:read') },
    async (request) => history.list(request.params.id, RecordHistoryQuerySchema.parse(request.query ?? {})),
  );
}
