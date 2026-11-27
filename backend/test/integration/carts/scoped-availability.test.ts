import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, errorBodyOf, setChannelStatus, setGlobalWindow } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T039) — the basket seams ask `catalogProductAvailabilityPort`
 * (`specs/163-product-data-scopes/contracts/consumers.md` rows 13–14; R0 F1).
 *
 *  - adding a product that is not available at the basket's (channel, language)
 *    — here switched off at the channel scope — is refused with the same 404 an
 *    absent product gets, single add and batch add alike (a batch naming one
 *    is refused whole, as feature 155 refuses an unknown id) (FR-004, F1: the
 *    add path tested no status at all before);
 *  - a line whose product goes off after it was added **stays** in the basket,
 *    reads `unavailable` in the full view, and refuses placement with the
 *    unknown-id 404 and its cart item id (FR-006);
 *  - a publication window that ends between the add and the placement refuses
 *    at placement (edge case *window boundary*).
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

describe('163 — basket acquisition seams honour scoped availability [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;
  let later: MinimumProductFixture;

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  const add = (productId: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: CUSTOMER,
      payload: { productId, quantity: 1 },
    });

  const view = async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: {
        items: Array<{
          id: string;
          productId: string;
          unavailable: boolean;
          unavailableReason: string | null;
          productName: string | null;
          productSlug: string | null;
          productSku: string | null;
        }>;
      };
    }).data.items;
  };

  const place = () =>
    h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies: CUSTOMER, payload: PLACEMENT });

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    later = await createMinimumProduct(em, { sku: `S163-LATER-${RUN}`, nameEn: 'Later', namePl: 'Później', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  });

  beforeEach(async () => {
    await completeActiveBaskets();
    await clearProductScopes(h.em(), [on.id, later.id]);
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await clearProductScopes(h.em(), [off.id, on.id, later.id]);
    await teardownBackendServer(h);
  });

  it('refuses to add a product switched off in the channel with the absent product’s 404', async () => {
    const absent = await add(randomUUID());
    expect(absent.statusCode).toBe(404);
    const refused = await add(off.id);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    const added = await add(on.id);
    expect(added.statusCode, added.body).toBeLessThan(300);
  });

  it('batch add (quick order → cart) refuses a batch naming a switched-off product with the same 404 and adds nothing', async () => {
    // Feature 155 (FR-011 b, threat F1) — every line of a batch is resolved
    // before any is added, and a line the buyer may not have answers the
    // unknown id's 404 for the whole batch. Feature 163 keeps that seam's
    // single not-found (`contracts/consumers.md`, preamble and row 13).
    const build = (productId: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/build',
        cookies: CUSTOMER,
        payload: {
          target: 'cart',
          items: [
            { productId, quantity: 1 },
            { productId: on.id, quantity: 1 },
          ],
        },
      });
    const absent = await build(randomUUID());
    expect(absent.statusCode, absent.body).toBe(404);
    const res = await build(off.id);
    expect(res.statusCode, res.body).toBe(404);
    expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
    expect(await view()).toEqual([]);
  });

  it('keeps a line whose product went off, marks it unavailable, and refuses placement with its cart item id (FR-006)', async () => {
    expect((await add(on.id)).statusCode).toBeLessThan(300);
    const [line] = await view();
    expect(line?.unavailable).toBe(false);
    expect(line?.productSlug).toBe(on.sku.toLowerCase());

    await setChannelStatus(h.em(), on.id, channels, 'inactive');

    const [stale] = await view();
    expect(stale?.productId).toBe(on.id);
    expect(stale?.unavailable).toBe(true);
    expect(stale?.unavailableReason).toBe('not_purchasable');
    // Owner decision S1 = A — the line keeps its name and SKU, so the buyer can
    // tell which line it is, and loses its link: the product page answers 404 here.
    expect(stale?.productName).toBeTruthy();
    expect(stale?.productSku).toBe(on.sku);
    expect(stale?.productSlug).toBeNull();

    const res = await place();
    expect(res.statusCode, res.body).toBe(404);
    const error = (res.json() as { error: { code: string; details?: { cartItemIds?: string[] } } }).error;
    expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    expect(error.details?.cartItemIds).toEqual([stale!.id]);
  });

  it('refuses at placement a line whose publication window ended after it was added', async () => {
    await setGlobalWindow(h.em(), later.id, { from: null, until: new Date(Date.now() + 60 * 60 * 1000) });
    expect((await add(later.id)).statusCode).toBeLessThan(300);
    await setGlobalWindow(h.em(), later.id, { from: null, until: new Date(Date.now() - 1000) });

    const res = await place();
    expect(res.statusCode, res.body).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });
});
