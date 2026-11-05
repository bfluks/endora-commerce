import type { FastifyInstance } from 'fastify';
import { ProjectDictionaryListQuerySchema, ProjectTemplateBodySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { TemplateService } from '../services/template-service.js';

export interface TemplateRoutesDeps {
  templateService: TemplateService;
  requireAdmin: RequireAdminFactory;
}

const TEMPLATES = '/api/v1/admin/projects/templates';

/**
 * Project Templates (`specs/163-projects-and-tasks/contracts/admin-api.md`
 * §2.5, User Story 3). Reading is `projects:read` — the create screen offers
 * Templates to whoever creates Projects; every write is `projects:configure`.
 * `?active=true` leaves archived Templates out, which is what the create
 * screen asks for. An unknown id answers 404 `PROJECT_TEMPLATE_NOT_FOUND`.
 */
export async function registerTemplateRoutes(app: FastifyInstance, deps: TemplateRoutesDeps): Promise<void> {
  const { requireAdmin, templateService: templates } = deps;

  app.get(TEMPLATES, { preHandler: requireAdmin('projects:read') }, async (request) => {
    const query = ProjectDictionaryListQuerySchema.parse(request.query ?? {});
    return { data: await templates.list(query.active === 'true') };
  });

  app.post(
    TEMPLATES,
    { preHandler: requireAdmin('projects:configure'), schema: { body: ProjectTemplateBodySchema } },
    async (request, reply) => {
      const created = await templates.create(ProjectTemplateBodySchema.parse(request.body));
      reply.code(201);
      return { data: created };
    },
  );

  app.get<{ Params: { id: string } }>(
    `${TEMPLATES}/:id`,
    { preHandler: requireAdmin('projects:read') },
    async (request) => ({ data: await templates.get(request.params.id) }),
  );

  app.put<{ Params: { id: string } }>(
    `${TEMPLATES}/:id`,
    { preHandler: requireAdmin('projects:configure'), schema: { body: ProjectTemplateBodySchema } },
    async (request) => ({
      data: await templates.save(request.params.id, ProjectTemplateBodySchema.parse(request.body)),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${TEMPLATES}/:id/duplicate`,
    { preHandler: requireAdmin('projects:configure') },
    async (request, reply) => {
      const copy = await templates.duplicate(request.params.id, await request.responseLanguage());
      reply.code(201);
      return { data: copy };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${TEMPLATES}/:id/archive`,
    { preHandler: requireAdmin('projects:configure') },
    async (request) => ({ data: await templates.archive(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    `${TEMPLATES}/:id/restore`,
    { preHandler: requireAdmin('projects:configure') },
    async (request) => ({ data: await templates.restore(request.params.id) }),
  );
}
