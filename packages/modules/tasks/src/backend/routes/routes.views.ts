import type { FastifyInstance } from 'fastify';
import { createTaskSavedViewRequestSchema, updateTaskSavedViewRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { savedViewActor } from '../saved-view-actor.js';
import type { TaskListViewService } from '../services/saved-view-service.js';

export interface TaskViewRoutesDeps {
  listViewService: TaskListViewService;
  requireAdmin: RequireAdminFactory;
}

const VIEWS = '/api/v1/admin/tasks/list-views';

/**
 * The saved views of the Tasks list and board
 * (`specs/165-task-management/contracts/admin-api.md` §5, research R-13):
 * feature 147's four routes, every one `tasks:read` — a view is the caller's
 * own preset, so reading Tasks is all it takes to keep one. The static
 * `list-views` segment outranks `tasks/:id` in Fastify's router. The actor
 * comes from the tenant context (`saved-view-actor.ts`).
 */
export async function registerTaskViewRoutes(app: FastifyInstance, deps: TaskViewRoutesDeps): Promise<void> {
  const { listViewService, requireAdmin } = deps;
  const guard = requireAdmin('tasks:read');

  app.get(VIEWS, { preHandler: guard }, async () => ({ data: await listViewService.listFor(savedViewActor()) }));

  app.post(
    VIEWS,
    { preHandler: guard, schema: { body: createTaskSavedViewRequestSchema } },
    async (request, reply) => {
      const view = await listViewService.create(
        savedViewActor(),
        createTaskSavedViewRequestSchema.parse(request.body),
      );
      reply.code(201);
      return { data: view };
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${VIEWS}/:id`,
    { preHandler: guard, schema: { body: updateTaskSavedViewRequestSchema } },
    async (request) => ({
      data: await listViewService.update(
        request.params.id,
        savedViewActor(),
        updateTaskSavedViewRequestSchema.parse(request.body),
      ),
    }),
  );

  app.delete<{ Params: { id: string } }>(`${VIEWS}/:id`, { preHandler: guard }, async (request) => {
    await listViewService.remove(request.params.id, savedViewActor());
    return { data: { deleted: request.params.id } };
  });
}
