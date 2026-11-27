import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  adminPreferencesLegacyImportSchema,
  adminPreferencesPatchSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { AdminPreferenceService } from './services/admin-preference-service.js';

/**
 * Feature 164 — the signed-in administrator's own Admin UI preferences
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §2).
 *
 * Self-service only: the subject is always the session's admin and no route
 * takes an admin id, so no request can name — and no permission, the wildcard
 * included, can reach — another admin's preferences (FR-011). Gated on a session
 * and no permission code (`requireAdmin()`), so a role-less admin keeps
 * preferences too; each route is listed with its reason in the permissionless
 * ledger. The gate runs before validation, so an anonymous caller is answered
 * `401` and never `400`; a body the contract refuses is `400 VALIDATION_FAILED`
 * with nothing written (FR-012).
 */
export interface AdminPreferenceRouteDeps {
  adminPreferenceService: AdminPreferenceService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

export async function registerAdminPreferenceRoutes(
  app: FastifyInstance,
  deps: AdminPreferenceRouteDeps,
): Promise<void> {
  const { adminPreferenceService, requireAdmin, resolveAdminContext } = deps;

  // The refetch path: on the next load, on foreground and after a retry.
  app.get(
    '/api/v1/admin/me/preferences',
    { preHandler: requireAdmin() },
    async (request) => {
      const { adminUserId } = resolveAdminContext(request);
      return { data: await adminPreferenceService.read(adminUserId) };
    },
  );

  // Each key present is written; the sidebar keys replace their value, page
  // sizes merge per list. Answers the whole document after the write.
  app.patch(
    '/api/v1/admin/me/preferences',
    {
      preHandler: requireAdmin(),
      schema: { body: adminPreferencesPatchSchema },
    },
    async (request) => {
      const { adminUserId } = resolveAdminContext(request);
      const patch = adminPreferencesPatchSchema.parse(request.body);
      return { data: await adminPreferenceService.update(adminUserId, patch) };
    },
  );

  // The one-time carry-over of the browser's page sizes: insert-if-absent per
  // list, so it never overwrites a value stored on the server (FR-022, FR-023).
  app.post(
    '/api/v1/admin/me/preferences/legacy-import',
    {
      preHandler: requireAdmin(),
      schema: { body: adminPreferencesLegacyImportSchema },
    },
    async (request) => {
      const { adminUserId } = resolveAdminContext(request);
      const body = adminPreferencesLegacyImportSchema.parse(request.body);
      return { data: await adminPreferenceService.importLegacy(adminUserId, body) };
    },
  );
}
