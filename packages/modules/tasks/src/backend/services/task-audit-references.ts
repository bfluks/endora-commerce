import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { TaskService } from './task-service.js';

/**
 * What a `task` audit row is called, and where the Admin UI shows it.
 *
 * Every Command of this module is recorded against `task` and the Task's id,
 * so the dashboard's recent activity names a Task by its number and title and
 * links to its screen through this one resolver. It reads through the
 * visibility seam, under the reader's own context: a Task whose context the
 * reader may not see gets no label — the audit row falls back to its snapshot
 * and renders no link.
 *
 * `tasks` is operator-switchable and `audit_logs` is not; the registry skips a
 * contributor that is not effectively present, which is why this is a push
 * from a contribution-only boot hook and not a port `audit_logs` resolves.
 */
export function registerTaskAuditReferences(
  registry: AuditReferenceRegistryPort,
  tasks: () => Pick<TaskService, 'visibleRowsByIds'>,
): void {
  registry.register({
    ownerModuleId: 'tasks',
    referenceType: 'task',
    resolve: async (ids) =>
      (await tasks().visibleRowsByIds(ids)).map((row) => ({
        id: row.id,
        label: `${row.number} ${row.title}`,
        url: `/tasks/${row.id}`,
      })),
  });
}
