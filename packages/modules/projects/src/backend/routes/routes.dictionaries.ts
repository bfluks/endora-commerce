import type { FastifyInstance } from 'fastify';
import {
  CreateProjectLossReasonBodySchema,
  CreateProjectRoleBodySchema,
  UpdateProjectLossReasonBodySchema,
  UpdateProjectRoleBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { DictionaryService } from '../services/dictionary-service.js';

export interface DictionaryRoutesDeps {
  roleService: DictionaryService;
  lossReasonService: DictionaryService;
  requireAdmin: RequireAdminFactory;
}

const ROLES = '/api/v1/admin/projects/roles';
const LOSS_REASONS = '/api/v1/admin/projects/loss-reasons';

/**
 * Writing Project Roles and loss reasons
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.5, User Story 4):
 * add, rename, archive, restore and delete, every one `projects:configure`.
 * The reads — `GET /projects/roles`, `GET /projects/loss-reasons` — are
 * `projects:read` and live with the Project routes whose forms offer them.
 *
 * An unknown id answers 404 `PROJECT_DICTIONARY_ENTRY_NOT_FOUND`; deleting a
 * seeded row 409 `PROJECT_DICTIONARY_ENTRY_SYSTEM`, a row a Project or a
 * Template uses 409 `PROJECT_DICTIONARY_ENTRY_IN_USE`; a default name another
 * row has 409 `PROJECT_DICTIONARY_NAME_TAKEN`.
 */
export async function registerDictionaryRoutes(app: FastifyInstance, deps: DictionaryRoutesDeps): Promise<void> {
  registerDictionary(app, ROLES, {
    service: deps.roleService,
    requireAdmin: deps.requireAdmin,
    create: CreateProjectRoleBodySchema,
    update: UpdateProjectRoleBodySchema,
  });
  registerDictionary(app, LOSS_REASONS, {
    service: deps.lossReasonService,
    requireAdmin: deps.requireAdmin,
    create: CreateProjectLossReasonBodySchema,
    update: UpdateProjectLossReasonBodySchema,
  });
}

interface DictionaryRouteSet {
  service: DictionaryService;
  requireAdmin: RequireAdminFactory;
  create: typeof CreateProjectRoleBodySchema | typeof CreateProjectLossReasonBodySchema;
  update: typeof UpdateProjectRoleBodySchema | typeof UpdateProjectLossReasonBodySchema;
}

/** The five writes of one dictionary under `base`. */
function registerDictionary(app: FastifyInstance, base: string, routes: DictionaryRouteSet): void {
  const { service, requireAdmin, create, update } = routes;

  app.post(base, { preHandler: requireAdmin('projects:configure'), schema: { body: create } }, async (request, reply) => {
    const created = await service.create(create.parse(request.body), await request.responseLanguage());
    reply.code(201);
    return { data: created };
  });

  app.patch<{ Params: { id: string } }>(
    `${base}/:id`,
    { preHandler: requireAdmin('projects:configure'), schema: { body: update } },
    async (request) => ({
      data: await service.update(request.params.id, update.parse(request.body), await request.responseLanguage()),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${base}/:id/archive`,
    { preHandler: requireAdmin('projects:configure') },
    async (request) => ({ data: await service.archive(request.params.id, await request.responseLanguage()) }),
  );

  app.post<{ Params: { id: string } }>(
    `${base}/:id/restore`,
    { preHandler: requireAdmin('projects:configure') },
    async (request) => ({ data: await service.restore(request.params.id, await request.responseLanguage()) }),
  );

  app.delete<{ Params: { id: string } }>(
    `${base}/:id`,
    { preHandler: requireAdmin('projects:configure') },
    async (request, reply) => {
      await service.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
