import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163 (FR-017 b, D6; QA checkpoint B) — `sort=name` / `sort=-name` page by
 * the keyset (effective name, id). Products sharing one effective name — here
 * three, one of which gets it from a channel override — straddle a page boundary
 * of two; the walk must show each exactly once, in both directions.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — name paging over equal effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const products: MinimumProductFixture[] = [];
  let channelId = '';
  const shared = `Twin ${RUN}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    for (const [i, nameBase] of [shared, shared, 'Other base name', 'Aaa first', 'Zzz last'].entries()) {
      products.push(
        await createMinimumProduct(em, {
          sku: `S163-TWIN-${i}-${RUN}`,
          nameEn: `${nameBase} ${i >= 2 ? RUN : ''}`.trim(),
          namePl: `${nameBase} ${i >= 2 ? RUN : ''}`.trim(),
          channelIds: [channelId],
        }),
      );
    }
    // Product 2 is renamed by the channel override to the same name as 0 and 1.
    await setNameOverride(em, products[2]!.id, channelId, null, shared);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), products.map((p) => p.id));
    await teardownBackendServer(h);
  });

  async function walk(sort: 'name' | '-name', limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 12; page++) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent('S163-TWIN-')}&sort=${sort}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: CHANNEL,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: Array<{ id: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      seen.push(...body.data.map((p) => p.id));
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.cursor;
    }
    return seen;
  }

  it.each(['name', '-name'] as const)('%s with limit 2: every product exactly once, ties broken by id', async (sort) => {
    const ids = products.map((p) => p.id);
    const seen = await walk(sort, 2);
    expect([...seen].sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(seen.length);
    const twins = [products[0]!.id, products[1]!.id, products[2]!.id];
    const inOrder = seen.filter((id) => twins.includes(id));
    expect(inOrder).toEqual([...twins].sort(sort === 'name' ? undefined : (a, b) => (a < b ? 1 : -1)));
  });

  it('the page size does not change the order', async () => {
    expect(await walk('name', 1)).toEqual(await walk('name', 3));
  });
});
