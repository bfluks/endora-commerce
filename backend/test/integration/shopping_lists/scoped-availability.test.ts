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
 * Feature 163, Phase 6 (T041) — shopping lists ask `catalogProductAvailabilityPort`
 * (`contracts/consumers.md` row 17): a product not available at the request's
 * (channel, language) cannot be saved — the absent product's 404 — and a saved
 * line whose product went off is skipped on conversion as `product_not_found`,
 * the answer an out-of-channel line gets.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — shopping lists honour scoped availability [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;
  let goesOff: MinimumProductFixture;

  const save = (productId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists/default/items',
      cookies: BUYER,
      headers: CHANNEL,
      payload: { productId, quantity: 1 },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-SL-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-SL-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    goesOff = await createMinimumProduct(em, { sku: `S163-SL-GO-${RUN}`, nameEn: 'Goes', namePl: 'Idzie', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id, goesOff.id]);
    await teardownBackendServer(h);
  });

  it('refuses to save a product switched off in the channel with the absent product’s 404', async () => {
    const absent = await save(randomUUID());
    const refused = await save(off.id);
    expect(refused.statusCode).toBe(404);
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
  });

  it('skips a saved line whose product went off, as product_not_found, and converts the rest', async () => {
    expect((await save(on.id)).statusCode).toBe(201);
    const saved = await save(goesOff.id);
    expect(saved.statusCode).toBe(201);
    const listId = (saved.json() as { data: { id: string } }).data.id;
    await setChannelStatus(h.em(), goesOff.id, channels, 'inactive');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${listId}/convert-to-cart`,
      cookies: BUYER,
      headers: CHANNEL,
      payload: {},
    });
    expect(res.statusCode, res.body).toBeLessThan(300);
    const skipped = (res.json() as { data: { skipped: Array<{ productId: string; reason: string }> } }).data.skipped;
    expect(skipped).toContainEqual(expect.objectContaining({ productId: goesOff.id, reason: 'product_not_found' }));
    expect(skipped.map((s) => s.productId)).not.toContain(on.id);
  });
});
