import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssetReferenceReaderRestriction } from '@endora-commerce/contracts';
import { resolveTenantContext } from '@endora-commerce/platform/composition';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { createCrmOpportunity, seedCrmAdmin, seedCrmOrganization } from '../../helpers/seed-crm.js';
import type { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';

/**
 * The CRM descriptor's reader restriction over seeded rows
 * (`specs/166-asset-reference-visibility/` contracts/ports.md §1.1, research
 * R-15, R-16): Organization reach through the scoped EntityManager, and
 * `crm:read`.
 *
 * `assetIdsWithHiddenReferences()` is the exact complement of
 * `visibleEntityIds` over this descriptor's references, and
 * `allReferencedAssetIds()` is every attached asset — for a reader reaching
 * every Organization, one confined to the second of two, and a caller without
 * `crm:read`.
 */
describe('crm — the asset-reference reader restriction (feature 166)', () => {
  let h: BackendServerHandle;
  type Person = { adminUserId: string; undo: () => void };
  let reader: Person;
  let nonReader: Person;
  let orgOne: string;
  let orgTwo: string;
  let oppOne: string;
  let oppTwo: string;
  const assets: Record<'one' | 'two' | 'shared', string> = {
    one: randomUUID(),
    two: randomUUID(),
    shared: randomUUID(),
  };
  let pairs: Array<[string, string]> = [];
  const ours = new Set(Object.values(assets));
  const sorted = (...ids: string[]) => [...ids].sort();

  function restriction(): AssetReferenceReaderRestriction {
    const registry = h.container.resolve<AssetReferenceRegistry>('assetReferenceRegistry');
    const descriptor = registry.partition().restricted.find((d) => d.ownerModuleId === 'crm');
    expect(descriptor, 'CRM registers a reader-restricted descriptor').toBeDefined();
    return descriptor!.readerRestriction!;
  }

  const as = <T>(adminUserId: string, reach: readonly string[] | 'all', body: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      resolveTenantContext(
        { kind: 'admin', adminUserId },
        reach === 'all'
          ? { allowAll: true, allowedOrganizationIds: [] }
          : { allowAll: false, allowedOrganizationIds: [...reach] },
      ),
      body,
    );

  async function complementFor(
    adminUserId: string,
    reach: readonly string[] | 'all' = 'all',
  ): Promise<{ visible: string[]; hidden: string[] }> {
    return as(adminUserId, reach, async () => {
      const r = restriction();
      const visible = await r.visibleEntityIds([oppOne, oppTwo]);
      const expected = new Set(pairs.filter(([, opp]) => !visible.has(opp)).map(([asset]) => asset));
      const hidden = (await r.assetIdsWithHiddenReferences()).filter((id) => ours.has(id));
      expect([...hidden].sort(), 'assetIdsWithHiddenReferences is the complement of visibleEntityIds').toEqual(
        [...expected].sort(),
      );
      return { visible: [...visible].sort(), hidden: [...hidden].sort() };
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    reader = await seedCrmAdmin(h.em(), 'r6-crm-reader', ['crm:read']);
    nonReader = await seedCrmAdmin(h.em(), 'r6-crm-none', ['assets.read']);
    orgOne = await seedCrmOrganization(h.em(), 'r6-crm-one');
    orgTwo = await seedCrmOrganization(h.em(), 'r6-crm-two');
    oppOne = (await createCrmOpportunity(h, { title: 'R6 one', organizationId: orgOne })).id;
    oppTwo = (await createCrmOpportunity(h, { title: 'R6 two', organizationId: orgTwo })).id;
    pairs = [
      [assets.one, oppOne],
      [assets.two, oppTwo],
      [assets.shared, oppOne],
      [assets.shared, oppTwo],
    ];
    const conn = h.orm.em.getConnection();
    for (const [asset, opportunity] of pairs) {
      await conn.execute(
        `insert into "crm_opportunity_attachments" ("id", "opportunity_id", "asset_id", "file_name", "uploaded_by_admin_user_id", "created_at")
         values (?, ?, ?, 'r6.pdf', ?, now())`,
        [randomUUID(), opportunity, asset, TEST_ADMIN_ID],
      );
    }
  });

  afterAll(async () => {
    await h.orm.em
      .getConnection()
      .execute(`delete from "crm_opportunity_attachments" where "opportunity_id" in (?, ?)`, [oppOne, oppTwo]);
    for (const person of [reader, nonReader]) person?.undo();
    await teardownBackendServer(h);
  });

  it('a reader reaching every Organization sees both Opportunities; nothing is hidden', async () => {
    const { visible, hidden } = await complementFor(reader.adminUserId);
    expect(visible).toEqual(sorted(oppOne, oppTwo));
    expect(hidden).toEqual([]);
  });

  it('a reader confined to the second Organization does not see the first one’s Opportunity', async () => {
    const { visible, hidden } = await complementFor(reader.adminUserId, [orgTwo]);
    expect(visible).toEqual([oppTwo]);
    expect(hidden).toEqual(sorted(assets.one, assets.shared));
  });

  it('a caller without crm:read sees no Opportunity, and every file has a hidden reference', async () => {
    const { visible, hidden } = await complementFor(nonReader.adminUserId);
    expect(visible).toEqual([]);
    expect(hidden).toEqual(sorted(...Object.values(assets)));
  });

  it('allReferencedAssetIds is every attached file, whoever asks', async () => {
    const all = await as(nonReader.adminUserId, [orgTwo], () => restriction().allReferencedAssetIds());
    expect(all.filter((id) => ours.has(id)).sort()).toEqual(sorted(...Object.values(assets)));
  });
});
