import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceReaderRestriction,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';
import type { ProjectAccess } from './project-access.js';

/**
 * Projects → `assetReferenceRegistry`: a Project's attachments are references
 * to files of the asset library, and the library refuses to delete a file that
 * is still referenced (FR-027; CRM's `crm-asset-references.ts`, the model).
 *
 * **Referential integrity, not a surface**, so the registry honours it while
 * this module is switched off: the attachments survive a deactivation, and a
 * scanner that stopped answering would let an operator delete a file that
 * comes back as a broken attachment when Projects is switched on again. The
 * push is made from a contribution-only boot hook with no presence probe.
 *
 * One batched statement, platform-wide on purpose: the question is "does
 * anything still use this file", asked by whoever deletes it in the library —
 * who need not be somebody who may see the Project. For the same reason the
 * label is the Project's number and never its title.
  *
 * **Reader-restricted** (`specs/166-asset-reference-visibility/` FR-002,
 * contracts/ports.md §1.1): a file of the library is shown only to a reader
 * who may see at least one record using it, so the descriptor also says which
 * Projects the ambient caller may see — by {@link ProjectAccess}, whose viewer
 * already carries `projects:read`, membership, viewers, the module setting and
 * the Organization reach. The library asks it only while Projects is present
 * and never for the system or a wildcard holder; `ProjectAccess` is resolved
 * per call, never at boot, so the hook stays contribution-only.
 */
export interface ProjectAssetRestrictionDeps {
  /** The module's `ProjectAccess`, resolved per call. */
  access: () => Pick<ProjectAccess, 'visibleIds' | 'currentViewer' | 'visibleProjectSql'>;
}

export function registerProjectAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
  restriction: ProjectAssetRestrictionDeps,
): void {
  registry.register(projectAttachmentReferenceDescriptor(emFactory, restriction));
}

export function projectAttachmentReferenceDescriptor(
  emFactory: () => EntityManager,
  restriction: ProjectAssetRestrictionDeps,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'projects',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const rows = (await emFactory().execute(
        `select p."id"::text as "id", p."number" as "number", a."asset_id"::text as "asset_id"
           from "project_attachments" a
           join "projects" p on p."id" = a."project_id"
          where a."asset_id" in (${assetIds.map(() => '?').join(', ')})
          order by p."number"`,
        [...assetIds],
      )) as Array<{ id: string; number: string; asset_id: string }>;
      return rows.map((row) => ({
        assetId: row.asset_id,
        kind: 'project_attachment',
        entityId: row.id,
        label: `Project ${row.number}`,
      }));
    },
    readerRestriction: projectAttachmentReaderRestriction(emFactory, restriction),
  };
}

function projectAttachmentReaderRestriction(
  emFactory: () => EntityManager,
  deps: ProjectAssetRestrictionDeps,
): AssetReferenceReaderRestriction {
  const allReferencedAssetIds = async (): Promise<string[]> => {
    const rows = (await emFactory().execute(
      `select distinct a."asset_id"::text as "asset_id" from "project_attachments" a`,
    )) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  };
  return {
    async visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>> {
      return deps.access().visibleIds(entityIds);
    },
    async assetIdsWithHiddenReferences(): Promise<readonly string[]> {
      const access = deps.access();
      const viewer = await access.currentViewer();
      // Not a reader of Projects: every attachment is hidden from them.
      if (!viewer.canRead) return allReferencedAssetIds();
      const visible = await access.visibleProjectSql(viewer);
      if (visible === null) return [];
      // `is not true`: a row the predicate cannot decide is hidden, never shown.
      const rows = (await emFactory().execute(
        `select distinct a."asset_id"::text as "asset_id"
           from "project_attachments" a
           join "projects" p on p."id" = a."project_id"
          where (${visible.sql}) is not true`,
        visible.params,
      )) as Array<{ asset_id: string }>;
      return rows.map((row) => row.asset_id);
    },
    allReferencedAssetIds,
  };
}
