import type { FastifyInstance } from 'fastify';
import { ProjectAnalyticsQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectAnalyticsService } from '../services/analytics-service.js';

export interface AnalyticsRoutesDeps {
  analyticsService: ProjectAnalyticsService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Project analytics (`specs/163-projects-and-tasks/contracts/admin-api.md`
 * §2.6; User Story 10).
 *
 * Seven reads, each gated `projects:analytics` — a code of its own, because how
 * all Projects are going is not what everybody who works on one is shown.
 * Each takes a range of days and may be narrowed to a Template, an
 * Organization and a Project Manager; each answers its figure inside
 * `{ from, to, projectCount, excluded: { noValue }, data }` (FR-038), over the
 * Projects the reader may see.
 */
export async function registerAnalyticsRoutes(app: FastifyInstance, deps: AnalyticsRoutesDeps): Promise<void> {
  const { requireAdmin, analyticsService: analytics } = deps;
  const query = (request: { query: unknown }) => ProjectAnalyticsQuerySchema.parse(request.query ?? {});

  app.get('/api/v1/admin/projects/analytics/summary', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.summary(query(request)),
  );

  app.get('/api/v1/admin/projects/analytics/durations', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.durations(query(request)),
  );

  app.get('/api/v1/admin/projects/analytics/time-in-stage', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.timeInStage(query(request)),
  );

  app.get('/api/v1/admin/projects/analytics/losses', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.losses(query(request), await request.responseLanguage()),
  );

  app.get('/api/v1/admin/projects/analytics/value', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.value(query(request)),
  );

  app.get('/api/v1/admin/projects/analytics/top-open', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.topOpen(query(request)),
  );

  app.get('/api/v1/admin/projects/analytics/managers', { preHandler: requireAdmin('projects:analytics') }, async (request) =>
    analytics.managers(query(request)),
  );
}
