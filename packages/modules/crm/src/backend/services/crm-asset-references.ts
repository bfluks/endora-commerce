import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReferenceDescriptor,
  AssetReferenceHit,
  AssetReferenceReaderRestriction,
  AssetReferenceRegistryPort,
} from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { isUuid } from './opportunity-access.js';
import type { OwnerReadCheck } from './owner-read-permissions.js';

/**
 * CRM → `assetReferenceRegistry`: an Opportunity's attachments are references
 * to files of the media library, and the library refuses to delete a file that
 * is still referenced (FR-044).
 *
 * **This is referential integrity, not a surface**, and the registry honours it
 * while this module is switched off: the attachments survive a deactivation,
 * so a scanner that stopped answering would let an operator delete a file that
 * comes back as a broken attachment the moment the module is switched on
 * again. The push is therefore made from a contribution-only boot hook with no
 * presence probe.
 *
 * The statement is raw and platform-wide on purpose: the question is "does
 * anything, in any Organization, still use this file", and whoever is deleting
 * a file in the library need not be somebody who may read the Opportunity. For
 * the same reason the label is the Opportunity's number and never its title.
  *
 * **Reader-restricted** (`specs/166-asset-reference-visibility/` FR-002,
 * research R-15): a file of the library is shown only to a reader who may see
 * at least one record using it, so the descriptor also says which
 * Opportunities the ambient caller may see — the ones the tenant-scoped
 * EntityManager returns for their Organization reach, and none without
 * `crm:read`. The library asks it only while CRM is present and never for the
 * system or a wildcard holder; nothing is resolved at boot, so the hook stays
 * contribution-only.
 */
export interface CrmAssetRestrictionDeps {
  /** Whether the ambient caller holds `crm:read` (or the wildcard). */
  mayReadOpportunities: OwnerReadCheck;
}

export function registerCrmAssetReferences(
  registry: AssetReferenceRegistryPort,
  emFactory: () => EntityManager,
  restriction: CrmAssetRestrictionDeps,
): void {
  registry.register(opportunityAttachmentReferenceDescriptor(emFactory, restriction));
}

export function opportunityAttachmentReferenceDescriptor(
  emFactory: () => EntityManager,
  restriction: CrmAssetRestrictionDeps,
): AssetReferenceDescriptor {
  return {
    ownerModuleId: 'crm',
    async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
      if (assetIds.length === 0) return [];
      const rows = (await emFactory().execute(
        `select o."id"::text as id, o."number" as number, a."asset_id"::text as asset_id
           from "crm_opportunity_attachments" a
           join "crm_opportunities" o on o."id" = a."opportunity_id"
          where a."asset_id" in (${assetIds.map(() => '?').join(', ')})
          order by o."number"`,
        [...assetIds],
      )) as Array<{ id: string; number: string; asset_id: string }>;
      return rows.map((row) => ({
        assetId: row.asset_id,
        kind: 'crm_opportunity_attachment',
        entityId: row.id,
        label: `Sales opportunity ${row.number}`,
      }));
    },
    readerRestriction: opportunityAttachmentReaderRestriction(emFactory, restriction),
  };
}

function opportunityAttachmentReaderRestriction(
  emFactory: () => EntityManager,
  deps: CrmAssetRestrictionDeps,
): AssetReferenceReaderRestriction {
  /** Of these Opportunity ids, the ones the scoped EntityManager returns — the caller's Organization reach. */
  const inReach = async (ids: readonly string[]): Promise<Set<string>> => {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return new Set();
    const rows = await emFactory().find(CrmOpportunity, { id: { $in: candidates } }, { fields: ['id'] });
    return new Set(rows.map((row) => row.id));
  };
  const allReferencedAssetIds = async (): Promise<string[]> => {
    const rows = (await emFactory().execute(
      `select distinct a."asset_id"::text as asset_id from "crm_opportunity_attachments" a`,
    )) as Array<{ asset_id: string }>;
    return rows.map((row) => row.asset_id);
  };
  return {
    async visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>> {
      if (!(await deps.mayReadOpportunities())) return new Set();
      return inReach(entityIds);
    },
    async assetIdsWithHiddenReferences(): Promise<readonly string[]> {
      if (!(await deps.mayReadOpportunities())) return allReferencedAssetIds();
      // Two statements: every (asset, Opportunity) pair, raw and platform-wide,
      // then which of those Opportunities the caller reaches.
      const pairs = (await emFactory().execute(
        `select distinct a."asset_id"::text as asset_id, a."opportunity_id"::text as opportunity_id
           from "crm_opportunity_attachments" a`,
      )) as Array<{ asset_id: string; opportunity_id: string }>;
      if (pairs.length === 0) return [];
      const reached = await inReach(pairs.map((pair) => pair.opportunity_id));
      return [...new Set(pairs.filter((pair) => !reached.has(pair.opportunity_id)).map((pair) => pair.asset_id))];
    },
    allReferencedAssetIds,
  };
}
