import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import {
  opportunityAttachmentReferenceDescriptor,
  type CrmAssetRestrictionDeps,
} from './crm-asset-references.js';

// `specs/166-asset-reference-visibility/` contracts/ports.md §1.1 (CRM),
// research R-15 — the restriction's wiring: Organization reach through the
// scoped EntityManager, and `crm:read`. The SQL complement property over
// seeded rows is `backend/test/integration/crm/asset-reference-restriction.test.ts`
// (tasks.md T001 (f)).

const ASSET_1 = '00000000-0000-4000-8000-0000000000a1';
const ASSET_2 = '00000000-0000-4000-8000-0000000000a2';
const OPP_IN = '00000000-0000-4000-8000-0000000000c1';
const OPP_OUT = '00000000-0000-4000-8000-0000000000c2';

interface FakeEm {
  emFactory: () => EntityManager;
  statements: string[];
  finds: Array<{ entity: unknown; where: unknown }>;
}

/** `execute` answers raw rows; `find` answers through the reach — only `OPP_IN` is in scope. */
function fakeEm(rows: () => unknown[]): FakeEm {
  const statements: string[] = [];
  const finds: FakeEm['finds'] = [];
  const em = {
    async execute(sql: string) {
      statements.push(sql);
      return rows();
    },
    async find(entity: unknown, where: { id: { $in: string[] } }) {
      finds.push({ entity, where });
      return where.id.$in.filter((id) => id === OPP_IN).map((id) => ({ id }));
    },
  };
  return { emFactory: () => em as unknown as EntityManager, statements, finds };
}

function deps(mayRead: boolean): { deps: CrmAssetRestrictionDeps; asked: () => number } {
  let asked = 0;
  return {
    deps: {
      mayReadOpportunities: async () => {
        asked += 1;
        return mayRead;
      },
    },
    asked: () => asked,
  };
}

describe('the CRM asset-reference descriptor (feature 166)', () => {
  it('tags every hit with the asset it points at, in one statement', async () => {
    const em = fakeEm(() => [{ id: OPP_IN, number: 'O-1', asset_id: ASSET_1 }]);
    const descriptor = opportunityAttachmentReferenceDescriptor(em.emFactory, deps(true).deps);

    expect(await descriptor.findReferences([ASSET_1])).toEqual([
      { kind: 'crm_opportunity_attachment', entityId: OPP_IN, label: 'Sales opportunity O-1', assetId: ASSET_1 },
    ]);
    expect(em.statements).toHaveLength(1);
  });

  it('answers visibleEntityIds through the scoped EntityManager (Organization reach)', async () => {
    const em = fakeEm(() => []);
    const descriptor = opportunityAttachmentReferenceDescriptor(em.emFactory, deps(true).deps);

    expect([...(await descriptor.readerRestriction!.visibleEntityIds([OPP_IN, OPP_OUT, 'not-a-uuid']))]).toEqual([
      OPP_IN,
    ]);
    expect(em.finds).toHaveLength(1);
    expect(em.finds[0]!.entity).toBe(CrmOpportunity);
    expect(em.finds[0]!.where).toEqual({ id: { $in: [OPP_IN, OPP_OUT] } });
  });

  it('without crm:read, sees no Opportunity and reports every referenced asset as hidden', async () => {
    const em = fakeEm(() => [{ asset_id: ASSET_1 }]);
    const descriptor = opportunityAttachmentReferenceDescriptor(em.emFactory, deps(false).deps);

    expect([...(await descriptor.readerRestriction!.visibleEntityIds([OPP_IN]))]).toEqual([]);
    expect(em.finds).toEqual([]);
    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET_1]);
    expect(em.finds).toEqual([]);
  });

  it('reports an asset with a reference out of reach as hidden, in two statements', async () => {
    const em = fakeEm(() => [
      { asset_id: ASSET_1, opportunity_id: OPP_IN },
      { asset_id: ASSET_2, opportunity_id: OPP_OUT },
      { asset_id: ASSET_2, opportunity_id: OPP_IN },
    ]);
    const descriptor = opportunityAttachmentReferenceDescriptor(em.emFactory, deps(true).deps);

    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET_2]);
    expect(em.statements).toHaveLength(1);
    expect(em.finds).toHaveLength(1);
  });

  it('lists every attached asset for allReferencedAssetIds without asking the permission', async () => {
    const em = fakeEm(() => [{ asset_id: ASSET_1 }]);
    const { deps: d, asked } = deps(false);
    const descriptor = opportunityAttachmentReferenceDescriptor(em.emFactory, d);

    expect(await descriptor.readerRestriction!.allReferencedAssetIds()).toEqual([ASSET_1]);
    expect(em.statements[0]).toMatch(/from "crm_opportunity_attachments"/);
    expect(asked()).toBe(0);
    expect(em.finds).toEqual([]);
  });
});
