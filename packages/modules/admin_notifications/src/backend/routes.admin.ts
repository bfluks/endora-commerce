import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Resolve the acting admin's id. Production decorates `request.actor` via the
 * auth plugin; the test harness decorates `request.testActor` — both shapes
 * are checked (the signed-in-admin gate has already run).
 */
function resolveAdminUserId(request: FastifyRequest): string {
  const r = request as FastifyRequest & {
    actor?: { kind: string; adminUserId?: string };
    testActor?: { kind: string; adminUserId?: string };
  };
  const actor = r.testActor?.kind === 'admin' ? r.testActor : r.actor;
  if (!actor || actor.kind !== 'admin' || !actor.adminUserId) {
    throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
  }
  return actor.adminUserId;
}
import type { AdminNotificationService } from './services/admin-notification-service.js';
import { NotificationNotFoundError } from './services/admin-notification-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

const listQuerySchema = z.object({
  unread: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(100).default(25),
  cursor: z.string().optional(),
});

/**
 * The permission that admits the `all_admins` broadcast audience (issue #518).
 * The bell itself needs none: every signed-in admin reads their own
 * `admin_user` rows.
 */
export const BROADCAST_READ_PERMISSION = 'admin:read';

export interface AdminNotificationsRoutesDeps {
  adminNotificationService: AdminNotificationService;
  requireAdmin: RequireAdminFactory;
  /** Whether this admin holds `code` — `admin_roles`' capability check. */
  hasPermission: (adminUserId: string, code: string) => Promise<boolean>;
}

/**
 * Routes for the admin notification bell (feature 026, US1).
 *
 * Gated on a signed-in admin and no permission code (issue #518): personal
 * notifications are recorded for any administrator a Task or a CRM record
 * names, whatever their role, so a role without `admin:read` must still be
 * able to read and acknowledge them. `admin:read` decides one thing — whether
 * the `all_admins` broadcasts are listed, counted and acknowledgeable — and is
 * checked per request, so a role change takes effect on the next call.
 *
 * The list endpoint resolves per-admin `isRead` by joining
 * `admin_notification_reads` for `audience='all_admins'` rows. Read state
 * for `audience='admin_user'` lives directly on the notification row.
 */
export async function registerAdminNotificationsRoutes(
  app: FastifyInstance,
  deps: AdminNotificationsRoutesDeps,
): Promise<void> {
  const { adminNotificationService, requireAdmin, hasPermission } = deps;
  const includeBroadcasts = (adminUserId: string): Promise<boolean> =>
    hasPermission(adminUserId, BROADCAST_READ_PERMISSION);

  app.get('/api/v1/admin/notifications', { preHandler: requireAdmin() }, async (request) => {
    const adminUserId = resolveAdminUserId(request);
    const query = listQuerySchema.parse(request.query);
    const page = await adminNotificationService.listForAdmin({
      adminUserId,
      includeBroadcasts: await includeBroadcasts(adminUserId),
      unread: query.unread,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
    return {
      items: page.items.map((it) => ({
        id: it.id,
        audience: it.audience,
        kind: it.kind,
        subjectType: it.subjectType,
        subjectId: it.subjectId,
        title: it.title,
        body: it.body,
        linkPath: it.linkPath,
        // Beside `title` and `body`, never instead of them: the Admin UI
        // resolves a message in the reader's language and falls back to the
        // finished sentence when it cannot.
        titleMessage: it.titleMessage,
        bodyMessage: it.bodyMessage,
        createdAt: it.createdAt.toISOString(),
        isRead: it.isRead,
      })),
      nextCursor: page.nextCursor,
      unreadCount: page.unreadCount,
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/notifications/:id/read',
    { preHandler: requireAdmin() },
    async (request, reply) => {
      const adminUserId = resolveAdminUserId(request);
      try {
        await adminNotificationService.markRead(request.params.id, adminUserId, {
          includeBroadcasts: await includeBroadcasts(adminUserId),
        });
      } catch (err) {
        if (err instanceof NotificationNotFoundError) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Notification not found.');
        }
        throw err;
      }
      return reply.status(204).send();
    },
  );

  app.post('/api/v1/admin/notifications/mark-all-read', { preHandler: requireAdmin() }, async (request) => {
    const adminUserId = resolveAdminUserId(request);
    const markedCount = await adminNotificationService.markAllRead(adminUserId, {
      includeBroadcasts: await includeBroadcasts(adminUserId),
    });
    return { markedCount };
  });
}
