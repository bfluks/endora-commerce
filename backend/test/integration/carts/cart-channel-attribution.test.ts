import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { Cart, CartItem } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  quoteOnlyOnChannel,
  seedTwoChannelBasket,
  type TwoChannelBasket,
} from '../../helpers/two-channel-basket-fixture.js';

/**
 * `specs/154-sales-channel-access/` User Story 6 — the basket belongs to the
 * store it is used on (FR-030–FR-033, contracts/basket-attribution.md §1–§3).
 *
 * Every basket used to be created on the system-default channel and priced
 * there, whatever storefront it was used on. The two channels here sell one
 * product at two prices and nothing else prices it, so a line priced on the
 * default channel would be refused as unpriced and a line priced on the other
 * store would carry the other figure: each assertion on a price is an assertion
 * on the channel.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ANON_COOKIE = 'b2b_cart_anon';

interface CartBody {
  data: {
    id: string | null;
    salesChannelId: string | null;
    items: Array<{ id: string; productId: string; quantity: number; unitPrice: { amount: number } }>;
  };
}

describe('the basket belongs to the channel it is used on', () => {
  let h: BackendServerHandle;
  let fx: TwoChannelBasket;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await seedTwoChannelBasket(h, 'attribution');
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    const carts = await em.find(Cart, {
      customerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: { $in: [fx.a.id, fx.b.id] },
    });
    if (carts.length > 0) {
      await em.nativeDelete(CartItem, { cartId: { $in: carts.map((c) => c.id) } });
      await em.nativeDelete(Cart, { id: { $in: carts.map((c) => c.id) } });
    }
  });

  function add(
    channelCode: string,
    opts: { cookies?: Record<string, string>; quantity?: number } = {},
  ) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-sales-channel': channelCode, 'content-type': 'application/json' },
      ...(opts.cookies ? { cookies: opts.cookies } : {}),
      payload: { productId: fx.productId, quantity: opts.quantity ?? 1 },
    });
  }

  function read(channelCode: string, cookies?: Record<string, string>) {
    return h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: { 'x-sales-channel': channelCode },
      ...(cookies ? { cookies } : {}),
    });
  }

  function anonTokenOf(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
    return res.cookies.find((c) => c.name === ANON_COOKIE)?.value;
  }

  describe('a signed-in customer', () => {
    it('gets one basket per channel, each priced for its channel', async () => {
      const onA = await add(fx.a.code, { cookies: BUYER });
      expect(onA.statusCode, onA.body).toBe(200);
      const onB = await add(fx.b.code, { cookies: BUYER });
      expect(onB.statusCode, onB.body).toBe(200);

      const cartA = (onA.json() as CartBody).data;
      const cartB = (onB.json() as CartBody).data;
      expect(cartA.id).not.toBe(cartB.id);
      expect(cartA.salesChannelId).toBe(fx.a.id);
      expect(cartB.salesChannelId).toBe(fx.b.id);
      expect(cartA.items.map((i) => i.unitPrice.amount)).toEqual([Number(fx.priceOnA)]);
      expect(cartB.items.map((i) => i.unitPrice.amount)).toEqual([Number(fx.priceOnB)]);

      const rows = await h.em().find(Cart, {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        status: 'active',
        salesChannelId: { $in: [fx.a.id, fx.b.id] },
      });
      expect(rows.map((r) => r.salesChannelId).sort()).toEqual([fx.a.id, fx.b.id].sort());
    });

    it('sees and changes only the basket of the storefront it is on', async () => {
      const onA = await add(fx.a.code, { cookies: BUYER, quantity: 2 });
      expect(onA.statusCode, onA.body).toBe(200);
      const lineOnA = (onA.json() as CartBody).data.items[0]!;

      const viewOnB = await read(fx.b.code, BUYER);
      expect(viewOnB.statusCode).toBe(200);
      expect((viewOnB.json() as CartBody).data.items).toEqual([]);

      // A line of A's basket, addressed from B, is not a line of B's basket.
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/cart/items/${lineOnA.id}`,
        headers: { 'x-sales-channel': fx.b.code, 'content-type': 'application/json' },
        cookies: BUYER,
        payload: { quantity: 5 },
      });
      expect(patched.statusCode).toBe(404);
      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/cart/items/${lineOnA.id}`,
        headers: { 'x-sales-channel': fx.b.code },
        cookies: BUYER,
      });
      expect(removed.statusCode).toBe(404);

      const viewOnA = await read(fx.a.code, BUYER);
      expect((viewOnA.json() as CartBody).data.items.map((i) => i.quantity)).toEqual([2]);
    });

    it('is refused a product sold on request only on that channel, and only there', async () => {
      const undo = await quoteOnlyOnChannel(h, fx.b.id);
      try {
        const onB = await add(fx.b.code, { cookies: BUYER });
        expect(onB.statusCode).toBe(400);
        expect((onB.json() as { error: { code: string } }).error.code).toBe(
          ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
        );
        const onA = await add(fx.a.code, { cookies: BUYER });
        expect(onA.statusCode, onA.body).toBe(200);
      } finally {
        await undo();
      }
    });
  });

  describe('an anonymous visitor', () => {
    it('has no basket on B for a token of a basket made on A, and the first write on B starts one', async () => {
      const onA = await add(fx.a.code);
      expect(onA.statusCode, onA.body).toBe(200);
      const tokenA = anonTokenOf(onA);
      expect(tokenA).toBeDefined();
      expect((onA.json() as CartBody).data.salesChannelId).toBe(fx.a.id);
      expect((onA.json() as CartBody).data.items.map((i) => i.unitPrice.amount)).toEqual([
        Number(fx.priceOnA),
      ]);

      const viewOnB = await read(fx.b.code, { [ANON_COOKIE]: tokenA! });
      expect(viewOnB.statusCode).toBe(200);
      expect((viewOnB.json() as CartBody).data.id).toBeNull();
      expect((viewOnB.json() as CartBody).data.items).toEqual([]);

      const onB = await add(fx.b.code, { cookies: { [ANON_COOKIE]: tokenA! } });
      expect(onB.statusCode, onB.body).toBe(200);
      const tokenB = anonTokenOf(onB);
      expect(tokenB).toBeDefined();
      expect(tokenB).not.toBe(tokenA);
      const cartB = (onB.json() as CartBody).data;
      expect(cartB.salesChannelId).toBe(fx.b.id);
      expect(cartB.items.map((i) => i.unitPrice.amount)).toEqual([Number(fx.priceOnB)]);

      // A's basket is untouched and still answers to A's token on A.
      const backOnA = await read(fx.a.code, { [ANON_COOKIE]: tokenA! });
      const cartA = (backOnA.json() as CartBody).data;
      expect(cartA.id).toBe((onA.json() as CartBody).data.id);
      expect(cartA.items.map((i) => i.quantity)).toEqual([1]);
    });

    it('is refused a product sold on request only on that channel', async () => {
      const undo = await quoteOnlyOnChannel(h, fx.b.id);
      try {
        const onB = await add(fx.b.code);
        expect(onB.statusCode).toBe(400);
        expect((onB.json() as { error: { code: string } }).error.code).toBe(
          ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
        );
      } finally {
        await undo();
      }
    });
  });

  describe('merge at sign-in (contract §3)', () => {
    it('merges the anonymous basket of the sign-in channel into the customer basket of that channel', async () => {
      const anon = await add(fx.b.code, { quantity: 3 });
      expect(anon.statusCode, anon.body).toBe(200);
      const token = anonTokenOf(anon)!;

      const outcome = await h.cartService()!.mergeAnonymousIntoCustomer(token, {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: fx.b.id,
      });
      expect(outcome.outcome).toBe('adopted');

      const em = h.em();
      em.clear();
      const dest = await em.findOneOrFail(Cart, { id: outcome.destinationCartId });
      expect(dest.salesChannelId).toBe(fx.b.id);
      expect(dest.customerAccountId).toBe(TEST_CUSTOMER_ID);
      const lines = await em.find(CartItem, { cartId: dest.id });
      expect(lines.map((l) => [l.quantity, Number(l.unitPrice).toFixed(2)])).toEqual([
        [3, fx.priceOnB],
      ]);
    });

    it('leaves an anonymous basket of another channel alone (noop_no_anon)', async () => {
      const anon = await add(fx.a.code, { quantity: 2 });
      expect(anon.statusCode, anon.body).toBe(200);
      const token = anonTokenOf(anon)!;
      const anonCartId = (anon.json() as CartBody).data.id!;

      const outcome = await h.cartService()!.mergeAnonymousIntoCustomer(token, {
        customerAccountId: TEST_CUSTOMER_ID,
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: fx.b.id,
      });
      expect(outcome.outcome).toBe('noop_no_anon');

      const em = h.em();
      em.clear();
      const untouched = await em.findOneOrFail(Cart, { id: anonCartId });
      expect(untouched.status).toBe('active');
      expect(untouched.anonymousCartToken).toBe(token);
      expect(untouched.salesChannelId).toBe(fx.a.id);
      expect((await em.find(CartItem, { cartId: anonCartId })).map((l) => l.quantity)).toEqual([2]);
    });
  });
});
