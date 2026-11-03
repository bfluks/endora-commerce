import type { FastifyInstance } from 'fastify';
import { SetTaskBoardCardFieldsBodySchema, TaskBoardQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TaskBoardCardFieldService } from '../services/board-card-field-service.js';
import type { TaskBoardService } from '../services/board-service.js';
import { refuseUnofferedCustomField } from './routes.tasks.js';

export interface TaskBoardRoutesDeps {
  boardService: Pick<TaskBoardService, 'get'>;
  boardCardFieldService: Pick<TaskBoardCardFieldService, 'config' | 'set'>;
  requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/tasks/board';

/**
 * The Task board (`specs/165-task-management/contracts/admin-api.md` §1, §4;
 * research R-11).
 *
 * `GET /tasks/board` is `tasks:read`, like the list it is another view of; a
 * card moves through `POST /tasks/:id/status`, the one door of every status
 * change. What a card shows is read on `tasks:read` — the board needs it to
 * render — and written on `tasks:configure`, answering the configuration as it
 * stands afterwards. The static `board` segment outranks `tasks/:id`.
 */
export async function registerTaskBoardRoutes(app: FastifyInstance, deps: TaskBoardRoutesDeps): Promise<void> {
  const { requireAdmin, boardService, boardCardFieldService } = deps;

  app.get(API, { preHandler: requireAdmin('tasks:read') }, async (request) => ({
    data: await boardService
      .get(TaskBoardQuerySchema.parse(request.query ?? {}), await request.responseLanguage())
      .catch(refuseUnofferedCustomField),
  }));

  app.get(`${API}/card-fields`, { preHandler: requireAdmin('tasks:read') }, async () => ({
    data: await boardCardFieldService.config(),
  }));

  app.put(
    `${API}/card-fields`,
    { preHandler: requireAdmin('tasks:configure'), schema: { body: SetTaskBoardCardFieldsBodySchema } },
    async (request) => ({
      data: await boardCardFieldService.set(SetTaskBoardCardFieldsBodySchema.parse(request.body).fields),
    }),
  );
}
