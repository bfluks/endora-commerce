import type { FastifyInstance } from 'fastify';
import { CreateTaskTagBodySchema, UpdateTaskTagBodySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskTagService } from '../services/tag-service.js';

export interface TaskTagRoutesDeps {
  tagService: Pick<TaskTagService, 'list' | 'create' | 'update' | 'delete'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks';

/**
 * The tag list (`specs/165-task-management/contracts/admin-api.md` §4): read
 * by every holder of `tasks:read`, who may put an existing tag on a Task they
 * edit; creating, renaming, recolouring and deleting a tag is configuration,
 * `tasks:configure` (US9 scenario 4, FR-041).
 */
export async function registerTaskTagRoutes(app: FastifyInstance, deps: TaskTagRoutesDeps): Promise<void> {
  const { requireAdmin, tagService } = deps;

  app.get(`${API}/tags`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await tagService.list(),
  }));

  app.post(
    `${API}/tags`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: CreateTaskTagBodySchema } },
    async (request, reply) => {
      const created = await tagService.create(CreateTaskTagBodySchema.parse(request.body));
      reply.code(201);
      return { data: created };
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${API}/tags/:id`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: UpdateTaskTagBodySchema } },
    async (request) => ({
      data: await tagService.update(request.params.id, UpdateTaskTagBodySchema.parse(request.body)),
    }),
  );

  app.delete<{ Params: { id: string } }>(
    `${API}/tags/:id`,
    { preHandler: requireAdmin('tasks:configure') },
    async (request, reply) => {
      await tagService.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
