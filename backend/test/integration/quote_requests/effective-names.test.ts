import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 8 (T059, FR-017 d, N2) — a quote-request line snapshots
 * the Name shown at the request's (channel, language): the buyer's request
 * language, an operator's channel default. The snapshot stays when the
 * override changes afterwards.
 *
 * Phase 22 (T138, FR-079; owner decision 2026-10-26) — the packaging-unit name
 * appended to a buyer's line is the unit's name in the same scope language, and
 * stays when the unit is renamed afterwards.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — quote-request line snapshots are effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  let channelId = '';
  let channelLanguage = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channelId = channel.id;
    channelLanguage = channel.defaultLanguage;
    product = await createMinimumProduct(em, { sku: `S163-QN-${RUN}`, nameEn: 'Plain', namePl: 'Plain', channelIds: [channelId] });
    await setNameOverride(em, product.id, channelId, null, `Quoted ${RUN}`);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [product.id]);
    await teardownBackendServer(h);
  });

  const lineName = (body: unknown): string | undefined =>
    (body as { data: { items: Array<{ productId: string; productName: string }> } }).data.items.find(
      (i) => i.productId === product.id,
    )?.productName;

  it('a buyer’s line snapshots the effective name and keeps it', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: BUYER,
      headers: CHANNEL,
      payload: { items: [{ productId: product.id, quantity: 1 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(lineName(res.json())).toBe(`Quoted ${RUN}`);
    const id = (res.json() as { data: { id: string } }).data.id;
    await h.em().getConnection().execute(
      `update product_value_overrides set value = ?::jsonb where product_id = ?`,
      [JSON.stringify({ v: `Renamed ${RUN}` }), product.id],
    );
    const again = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: BUYER, headers: CHANNEL });
    expect(again.statusCode, again.body).toBe(200);
    expect(lineName(again.json())).toBe(`Quoted ${RUN}`);
    await h.em().getConnection().execute(
      `update product_value_overrides set value = ?::jsonb where product_id = ?`,
      [JSON.stringify({ v: `Quoted ${RUN}` }), product.id],
    );
  });

  it('an operator’s line snapshots the effective name at the channel default', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      headers: CHANNEL,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: product.id, quantity: 1, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(lineName(res.json())).toBe(`Quoted ${RUN}`);
  });

  it('a buyer’s line snapshots the packaging-unit name in the request language and keeps it', async () => {
    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units`,
      cookies: ADMIN,
      payload: { name: 'Carton', baseQuantity: 6, nameTranslations: { [channelLanguage]: `Karton ${RUN}` } },
    });
    expect(unit.statusCode, unit.body).toBe(201);
    const unitId = (unit.json() as { data: { id: string } }).data.id;
    const headers = { ...CHANNEL, 'accept-language': channelLanguage };

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: BUYER,
      headers,
      payload: { items: [{ productId: product.id, quantity: 1, packagingUnitId: unitId }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(lineName(res.json())).toBe(`Quoted ${RUN} (Karton ${RUN})`);
    const id = (res.json() as { data: { id: string } }).data.id;

    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { name: 'Box', nameTranslations: { [channelLanguage]: `Pudło ${RUN}` } },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const again = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: BUYER, headers });
    expect(again.statusCode, again.body).toBe(200);
    expect(lineName(again.json())).toBe(`Quoted ${RUN} (Karton ${RUN})`);
  });
});
