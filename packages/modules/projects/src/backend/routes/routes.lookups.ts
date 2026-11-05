import type { FastifyInstance } from 'fastify';
import {
  ProjectAdminUserLookupQuerySchema,
  ProjectDocumentLookupQuerySchema,
  ProjectMentionableLookupQuerySchema,
  ProjectOrganizationLookupQuerySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ProjectDocumentLookupService } from '../services/document-lookup-service.js';
import type { ProjectLookupService } from '../services/lookup-service.js';
import type { ProjectMentionService } from '../services/mention-service.js';
import type { ProjectAccess } from '../services/project-access.js';

export interface LookupRoutesDeps {
  lookupService: ProjectLookupService;
  access: ProjectAccess;
  mentionService: ProjectMentionService;
  documentLookupService: ProjectDocumentLookupService;
  requireAdmin: RequireAdminFactory;
}

/**
 * What the Projects screens' pickers choose from
 * (`specs/163-projects-and-tasks/contracts/admin-api.md` §2.1a), and the module
 * visibility setting the visibility control explains.
 *
 * All three are `projects:read`. The two lookups serve the forms that write a
 * Project — Organizations, Members, listed people — and also the list's
 * Organization and any-member filters, which are a reader's (the CRM
 * precedent: its filter lookups are `crm:read`). They answer names and nothing
 * else, and Organizations only within the caller's reach. The setting —
 * whoever sees a Project's visibility may be told what *Follow the module
 * setting* means.
 */
export async function registerLookupRoutes(app: FastifyInstance, deps: LookupRoutesDeps): Promise<void> {
  const { requireAdmin, lookupService: lookups, access, mentionService, documentLookupService } = deps;

  app.get('/api/v1/admin/projects/lookups/organizations', { preHandler: requireAdmin('projects:read') }, async (request) => ({
    data: await lookups.organizations(ProjectOrganizationLookupQuerySchema.parse(request.query ?? {})),
  }));

  app.get('/api/v1/admin/projects/lookups/admin-users', { preHandler: requireAdmin('projects:read') }, async (request) => ({
    data: await lookups.adminUsers(ProjectAdminUserLookupQuerySchema.parse(request.query ?? {})),
  }));

  app.get('/api/v1/admin/projects/visibility-setting', { preHandler: requireAdmin('projects:read') }, async () => ({
    data: { setting: await access.visibilitySetting() },
  }));

  // What a text of a Project may refer to (User Story 7, FR-026, FR-044):
  // `projects:write`, because a reference is chosen only while writing. The
  // people offered are those who may see the Project; each `@@` group's own
  // read code and its owner's presence are the service's to decide — a
  // switchable owner's code on the route would answer 403 where the list
  // should simply leave the group out. The document list answers
  // `RecordDocumentLookupResponse` as it stands, the shape CRM serves.
  app.get('/api/v1/admin/projects/lookups/mentionable', { preHandler: requireAdmin('projects:write') }, async (request) => ({
    data: await mentionService.mentionable(ProjectMentionableLookupQuerySchema.parse(request.query ?? {})),
  }));

  app.get('/api/v1/admin/projects/lookups/documents', { preHandler: requireAdmin('projects:write') }, async (request) =>
    documentLookupService.documents(ProjectDocumentLookupQuerySchema.parse(request.query ?? {})),
  );
}
