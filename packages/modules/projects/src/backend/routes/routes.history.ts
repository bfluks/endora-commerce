import type { FastifyInstance } from 'fastify';
import { RecordHistoryQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectHistoryService } from '../services/history-service.js';

export interface HistoryRoutesDeps {
  historyService: ProjectHistoryService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The change history of a Project (`contracts/admin-api.md` §2.4). `projects:read`,
 * deliberately not `audit_log:read`: whoever may see a Project may read what
 * happened to it.
 */
export async function registerHistoryRoutes(app: FastifyInstance, deps: HistoryRoutesDeps): Promise<void> {
  const { requireAdmin, historyService } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/projects/:id/history',
    { preHandler: requireAdmin('projects:read') },
    async (request) => historyService.list(request.params.id, RecordHistoryQuerySchema.parse(request.query ?? {})),
  );
}
