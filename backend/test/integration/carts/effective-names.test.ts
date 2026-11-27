import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 8 (T059, FR-017 d) — the basket names a line as the
 * storefront shows its product in the basket's (channel, language).
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — basket line names are effective [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    product = await createMinimumProduct(em, { sku: `S163-CN-${RUN}`, nameEn: 'Plain', namePl: 'Plain', channelIds: [channelId] });
    await setNameOverride(em, product.id, channelId, null, `Basket ${RUN}`);
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await clearValueOverrides(h.em(), [product.id]);
    await teardownBackendServer(h);
  });

  it('shows the channel override as the line name', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: CHANNEL,
      payload: { productId: product.id, quantity: 1 },
    });
    expect(added.statusCode, added.body).toBeLessThan(300);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: BUYER, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ productId: string; productName?: string; name?: string }> } }).data.items;
    const line = items.find((i) => i.productId === product.id);
    expect(line?.productName ?? line?.name).toBe(`Basket ${RUN}`);
  });
});
