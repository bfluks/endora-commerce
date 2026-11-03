import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
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
import { clearProductScopes, errorBodyOf, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T041) — comparisons ask `catalogProductAvailabilityPort`
 * (`contracts/consumers.md` row 12): a product not available at the request's
 * (channel, language) cannot be added — the same 404 an absent product gets —
 * and a column whose product went off after it was added reads `available: false`.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — comparisons honour scoped availability [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;

  const add = (productId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: BUYER,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-CMP-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-CMP-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id]);
    await teardownBackendServer(h);
  });

  it('refuses a product switched off in the channel with the absent product’s 404', async () => {
    const absent = await add(randomUUID());
    const refused = await add(off.id);
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
  });

  it('accepts an available product and marks it unavailable once it is switched off', async () => {
    const added = await add(on.id);
    expect(added.statusCode, added.body).toBe(200);
    await setChannelStatus(h.em(), on.id, channels, 'inactive');
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    const column = (res.json() as { data: { products: Array<{ id: string; available: boolean }> } }).data.products.find(
      (p) => p.id === on.id,
    );
    expect(column?.available).toBe(false);
  });
});
