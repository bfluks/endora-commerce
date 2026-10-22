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
 * Feature 163, Phase 8 (T058, FR-017 b, D6) — the Postgres listing searches and
 * sorts by the Name a card shows at (channel, language): the channel override
 * where one applies. The name ordering pages by the keyset (effective name, id)
 * without gaps or repeats, across a page boundary an override moved a product
 * over.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — listing over effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  const products: MinimumProductFixture[] = [];
  /** The order the effective names put the products in. */
  let expected: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    // Baseline names sort A..E; the override renames C to "Zeta …" (last) and
    // E to "Aardvark …" (first) on this channel only.
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      products.push(
        await createMinimumProduct(em, {
          sku: `S163-LEN-${letter}-${RUN}`,
          nameEn: `Len ${letter} ${RUN}`,
          namePl: `Len ${letter} ${RUN}`,
          channelIds: [channelId],
        }),
      );
    }
    await setNameOverride(em, products[2]!.id, channelId, null, `Len Zeta ${RUN}`);
    await setNameOverride(em, products[4]!.id, channelId, null, `Len Aardvark ${RUN}`);
    expected = [products[4]!, products[0]!, products[1]!, products[3]!, products[2]!].map((p) => p.id);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), products.map((p) => p.id));
    await teardownBackendServer(h);
  });

  it('pages sort=name by the effective name with no gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-LEN-`)}&sort=name&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: CHANNEL,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: Array<{ id: string; name: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      seen.push(...body.data.map((p) => p.id).filter((id) => expected.includes(id)));
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.cursor;
    }
    expect(seen).toEqual(expected);
  });

  it('shows and finds the overridden name', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(`Aardvark ${RUN}`)}&limit=10`,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Array<{ id: string; name: string }> }).data;
    expect(data.map((p) => p.id)).toEqual([products[4]!.id]);
    expect(data[0]!.name).toBe(`Len Aardvark ${RUN}`);
  });
});
