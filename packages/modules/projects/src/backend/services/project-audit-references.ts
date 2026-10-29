import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import { uuidArray, type ProjectAccess } from './project-access.js';

/**
 * What a `project` audit row is called, and where the Admin UI shows it
 * (FR-028; CRM's `crm-audit-references.ts` and Tasks' `task-audit-references.ts`,
 * the models).
 *
 * Every Command of this module about a Project is recorded against `project`
 * and the Project's id, so the dashboard's recent activity names a Project by
 * its number and title and links to its screen through this one resolver. It
 * asks `ProjectAccess.visibleIds` under the reader's own context first, and
 * labels only those: a Project the reader may not see gets no label — the audit
 * row falls back to its snapshot and renders no link.
 *
 * `projects` is operator-switchable and `audit_logs` is not; the registry skips
 * a contributor that is not effectively present, which is why this is a push
 * from a contribution-only boot hook and not a port `audit_logs` resolves.
 */
export function registerProjectAuditReferences(
  registry: AuditReferenceRegistryPort,
  deps: () => { access: Pick<ProjectAccess, 'visibleIds'>; emFactory: () => EntityManager },
): void {
  registry.register({
    ownerModuleId: 'projects',
    referenceType: 'project',
    resolve: async (ids) => {
      const { access, emFactory } = deps();
      const visible = await access.visibleIds(ids);
      if (visible.size === 0) return [];
      const rows = (await emFactory().execute(
        `select p."id", p."number", p."title" from "projects" p where p."id" = any(?::uuid[])`,
        [uuidArray(visible)],
      )) as Array<{ id: string; number: string; title: string }>;
      return rows.map((row) => ({
        id: row.id,
        label: `${row.number} ${row.title}`,
        url: `/projects/${row.id}`,
      }));
    },
  });
}
