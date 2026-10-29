import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReference, AssetReferenceDescriptor, AssetReferenceRegistryPort } from '@endora-commerce/contracts';

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
 */
export function registerProjectAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register(projectAttachmentReferenceDescriptor(emFactory));
}

export function projectAttachmentReferenceDescriptor(emFactory: () => EntityManager): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'projects',
    async findReferences(assetIds: string[]): Promise<AssetReference[]> {
      if (assetIds.length === 0) return [];
      const rows = (await emFactory().execute(
        `select p."id"::text as "id", p."number" as "number"
           from "project_attachments" a
           join "projects" p on p."id" = a."project_id"
          where a."asset_id" in (${assetIds.map(() => '?').join(', ')})
          order by p."number"`,
        [...assetIds],
      )) as Array<{ id: string; number: string }>;
      return rows.map((row) => ({
        kind: 'project_attachment',
        entityId: row.id,
        label: `Project ${row.number}`,
      }));
    },
  };
}
