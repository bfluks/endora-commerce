import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 8 (T059, FR-017 a) — the buyer type-ahead matches the Name
 * shown at (channel, language) and returns it.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — quick search over effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    product = await createMinimumProduct(em, { sku: `S163-QSN-${RUN}`, nameEn: 'Plain', namePl: 'Plain', channelIds: [channelId] });
    await setNameOverride(em, product.id, channelId, null, `Overridden${RUN}`);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [product.id]);
    await teardownBackendServer(h);
  });

  it('finds the product by its overridden name and shows that name', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quick-order/search?q=${encodeURIComponent(`Overridden${RUN}`)}&limit=10`,
      headers: CHANNEL,
      cookies: BUYER,
    });
    expect(res.statusCode, res.body).toBe(200);
    const hits = (res.json() as { data: Array<{ productId: string; name: string }> }).data;
    expect(hits.map((h) => h.productId)).toEqual([product.id]);
    expect(hits[0]!.name).toBe(`Overridden${RUN}`);
  });
});
