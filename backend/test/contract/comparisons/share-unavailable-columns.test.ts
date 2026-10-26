import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, owner decision CMP-1 = A (2026-10-26; FR-002, FR-004,
 * `contracts/consumers.md` row 12) — a comparison column whose product is not available
 * at the viewer's (channel, language) is the owner's own history and nobody else's:
 *
 * - the owner keeps the column as it was, with `available: false`;
 * - any other reader (a share-link recipient) gets the existing `(removed product)`
 *   column shape — no name, SKU, slug, price, image or compared values — so a removed
 *   product and an unavailable one cannot be told apart, and `hiddenProductCount`
 *   does not move.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

interface Column {
  id: string;
  sku: string;
  name: Record<string, string>;
  slug: string;
  primaryAssetUrl: string | null;
  price: unknown;
  available: boolean;
}
interface View {
  shareToken: string;
  products: Column[];
  comparableAttributes: Array<{ values: unknown[] }>;
  hiddenProductCount: number;
}

describe('163 CMP-1 — an unavailable column is shown only to the owner [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let on: MinimumProductFixture;
  let off: MinimumProductFixture;
  let shareToken: string;

  const clearComparisons = () =>
    h
      .em()
      .getConnection()
      .execute(`delete from "comparisons" where "customer_account_id" = ?`, [TEST_CUSTOMER_ID]);

  const share = (cookies?: Record<string, string>) =>
    h.app.inject({
      method: 'GET',
      url: `/api/v1/comparisons/share/${shareToken}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    on = await createMinimumProduct(em, { sku: `S163-CMP1-ON-${RUN}`, nameEn: 'Shown', namePl: 'Widoczny', channelIds: channels });
    off = await createMinimumProduct(em, { sku: `S163-CMP1-OFF-${RUN}`, nameEn: 'Gone off', namePl: 'Wyłączony', channelIds: channels });
    await clearComparisons();
    for (const productId of [on.id, off.id]) {
      const added = await h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        cookies: BUYER,
        headers: { ...CHANNEL, 'content-type': 'application/json' },
        payload: { productId },
      });
      expect(added.statusCode, added.body).toBe(200);
      shareToken = (added.json() as { data: View }).data.shareToken;
    }
    await setChannelStatus(em, off.id, channels, 'inactive');
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearComparisons();
    await clearProductScopes(h.em(), [on.id, off.id]);
    await teardownBackendServer(h);
  });

  it('the owner keeps the column, marked unavailable', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    const column = (res.json() as { data: View }).data.products.find((p) => p.id === off.id);
    expect(column).toMatchObject({ sku: off.sku, available: false });
    expect(Object.values(column!.name)).not.toContain('(removed product)');

    const own = await share(BUYER);
    const body = own.json() as { data: View; meta: { viewerIsOwner: boolean } };
    expect(body.meta.viewerIsOwner).toBe(true);
    expect(body.data.products.find((p) => p.id === off.id)).toMatchObject({ sku: off.sku, available: false });
  });

  it('a recipient gets the removed-product shape for it, and the available column as usual', async () => {
    const res = await share();
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: View; meta: { viewerIsOwner: boolean } };
    expect(body.meta.viewerIsOwner).toBe(false);
    const index = body.data.products.findIndex((p) => p.id === off.id);
    expect(body.data.products[index]).toEqual(
      expect.objectContaining({
        sku: '',
        name: { en: '(removed product)' },
        slug: '',
        primaryAssetUrl: null,
        price: null,
        available: false,
      }),
    );
    for (const row of body.data.comparableAttributes) expect(row.values[index]).toBeNull();
    expect(body.data.products.find((p) => p.id === on.id)).toMatchObject({ sku: on.sku, available: true });
    expect(body.data.hiddenProductCount).toBe(0);
  });
});
