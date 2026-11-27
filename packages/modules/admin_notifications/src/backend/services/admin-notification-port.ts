import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminNotificationRecord,
  AdminNotificationRecordPort,
} from '@endora-commerce/contracts';
import type { AdminNotification } from '../entities/admin-notification.entity.js';
import type { AdminNotificationService } from './admin-notification-service.js';

/**
 * The published face of `admin_notifications` (feature 075, Phase P).
 *
 * One cross-module consumer — `organizations` records a notification when a
 * new organisation registers — so the port is that one method, not the
 * module's five. The other four are its own admin surface: listing, marking
 * read, archiving, counting.
 *
 * The adapter exists for the usual reason: `record` answers with the
 * `AdminNotification` entity, and the port answers with the record.
 *
 * `recordWithin` is the co-transactional twin (`specs/165-task-management/`
 * SC-004): the entry is persisted into the caller's unit of work and commits
 * with it.
 */
export function createAdminNotificationRecordPort(
  getService: () => AdminNotificationService,
): AdminNotificationRecordPort<EntityManager> {
  return {
    async record(input) {
      return toAdminNotificationRecord(await getService().record(input));
    },
    recordWithin(em, input) {
      return toAdminNotificationRecord(getService().recordWithin(em, input));
    },
  };
}

export function toAdminNotificationRecord(
  notification: AdminNotification,
): AdminNotificationRecord {
  return {
    id: notification.id,
    audience: notification.audience,
    targetAdminUserId: notification.targetAdminUserId ?? null,
    kind: notification.kind,
    subjectType: notification.subjectType ?? null,
    subjectId: notification.subjectId ?? null,
    title: notification.title,
    body: notification.body ?? null,
    linkPath: notification.linkPath ?? null,
    createdAt: notification.createdAt,
    titleMessage: notification.titleMessage ?? null,
    bodyMessage: notification.bodyMessage ?? null,
  };
}
