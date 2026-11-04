import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T041) — the pasted-SKU list asks
 * `catalogProductAvailabilityPort` (`contracts/consumers.md` row 18): a SKU of a
 * product not available in the request's channel comes back as the unknown
 * SKU's `product_not_found`, never as a second reason; the operator's
 * `'unrestricted'` arm (`POST /api/v1/admin/quick-order/import`) is unchanged
 * and still recognises it.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface ImportAnswer {
  data: { recognized: Array<{ sku: string }>; rejected: Array<{ sku?: string; reason: string }> };
}

describe('163 — quick order recognises only available products [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-QO-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-QO-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id]);
    await teardownBackendServer(h);
  });

  const csv = (...skus: string[]) => ['sku,quantity', ...skus.map((s) => `${s},1`)].join('\n');

  it('answers a switched-off SKU as the unknown SKU does', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      headers: CHANNEL,
      cookies: BUYER,
      payload: { csv: csv(on.sku, off.sku, `S163-QO-NONE-${RUN}`) },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as ImportAnswer;
    expect(body.data.recognized.map((r) => r.sku)).toEqual([on.sku]);
    expect(body.data.rejected.map((r) => r.reason)).toEqual(['product_not_found', 'product_not_found']);
  });

  it('leaves the operator’s unrestricted import arm unchanged', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/import',
      cookies: ADMIN,
      payload: { csv: csv(off.sku) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as ImportAnswer).data.recognized.map((r) => r.sku)).toEqual([off.sku]);
  });
});
