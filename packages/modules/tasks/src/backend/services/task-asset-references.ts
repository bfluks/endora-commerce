import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceReaderRestriction,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';
import type { OwnerReadCheck } from './owner-read-permissions.js';
import type { TaskAccess } from './task-access.js';
import type { TaskVisibility } from './task-visibility.js';

/**
 * Tasks → `assetReferenceRegistry`: a Task's attachments are references to
 * files of the asset library, and the library refuses to delete a file that is
 * still referenced (`specs/165-task-management/` FR-008, research R-7;
 * Projects' `project-asset-references.ts`, the model).
 *
 * **Referential integrity, not a surface**, so the registry honours it while
 * this module is switched off: the attachments survive a deactivation, and a
 * scanner that stopped answering would let an operator delete a file that
 * comes back as a broken attachment when Tasks is switched on again. The push
 * is made from a contribution-only boot hook with no presence probe.
 *
 * One batched statement, platform-wide on purpose: the question is "does
 * anything still use this file", asked by whoever deletes it in the library —
 * who need not be somebody who may see the Task. For the same reason the label
 * is the Task's number and never its title.
 *
 * **Reader-restricted** (`specs/166-asset-reference-visibility/` FR-002,
 * contracts/ports.md §1.1): a file of the library is shown only to a reader
 * who may see at least one record using it, so the descriptor also says which
 * Tasks the ambient caller may see — by the module's one read path,
 * {@link TaskVisibility}, and `tasks:read`, which that path leaves to the
 * routes. The library asks it only while Tasks is present and never for the
 * system or a wildcard holder; the services are resolved per call, never at
 * boot, so the hook stays contribution-only.
 */
export interface TaskAssetRestrictionDeps {
  /** The module's `TaskAccess`, resolved per call. */
  access: () => Pick<TaskAccess, 'visibleIds'>;
  /** The module's `TaskVisibility`, resolved per call. */
  visibility: () => Pick<TaskVisibility, 'condition'>;
  /** Whether the ambient caller holds `tasks:read` (or the wildcard). */
  mayReadTasks: OwnerReadCheck;
}

export function registerTaskAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
  restriction: TaskAssetRestrictionDeps,
): void {
  registry.register(taskAttachmentReferenceDescriptor(emFactory, restriction));
}

export function taskAttachmentReferenceDescriptor(
  emFactory: () => EntityManager,
  restriction: TaskAssetRestrictionDeps,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'tasks',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const rows = (await emFactory().execute(
        `select t."id"::text as "id", t."number" as "number", a."asset_id"::text as "asset_id"
           from "task_attachments" a
           join "tasks" t on t."id" = a."task_id"
          where a."asset_id" in (${assetIds.map(() => '?').join(', ')})
          order by t."number"`,
        [...assetIds],
      )) as Array<{ id: string; number: string; asset_id: string }>;
      return rows.map((row) => ({
        assetId: row.asset_id,
        kind: 'task_attachment',
        entityId: row.id,
        label: `Task ${row.number}`,
      }));
    },
    readerRestriction: taskAttachmentReaderRestriction(emFactory, restriction),
  };
}

function taskAttachmentReaderRestriction(
  emFactory: () => EntityManager,
  deps: TaskAssetRestrictionDeps,
): AssetReferenceReaderRestriction {
  const allReferencedAssetIds = async (): Promise<string[]> => {
    const rows = (await emFactory().execute(
      `select distinct a."asset_id"::text as "asset_id" from "task_attachments" a`,
    )) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  };
  return {
    async visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>> {
      if (!(await deps.mayReadTasks())) return new Set();
      return deps.access().visibleIds(entityIds);
    },
    async assetIdsWithHiddenReferences(): Promise<readonly string[]> {
      if (!(await deps.mayReadTasks())) return allReferencedAssetIds();
      const visible = await deps.visibility().condition('t');
      if (visible === null) return [];
      // `is not true`: a row the predicate cannot decide is hidden, never shown.
      const rows = (await emFactory().execute(
        `select distinct a."asset_id"::text as "asset_id"
           from "task_attachments" a
           join "tasks" t on t."id" = a."task_id"
          where (${visible.sql}) is not true`,
        visible.params,
      )) as Array<{ asset_id: string }>;
      return rows.map((row) => row.asset_id);
    },
    allReferencedAssetIds,
  };
}
