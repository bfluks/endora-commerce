import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  seedTwoChannelBasket,
  type TwoChannelBasket,
} from '../../helpers/two-channel-basket-fixture.js';

/**
 * `specs/154-sales-channel-access/` contracts/basket-attribution.md §1 — which
 * basket a storefront cart request addresses, at the HTTP boundary.
 *
 * A customer's basket is `(customer, request channel)`; an anonymous one is
 * `(cookie token, request channel)`, and a token whose basket is another
 * channel's is "no basket" — every read answers the empty cart, and the first
 * write replaces the `b2b_cart_anon` cookie with a new token.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const ANON_COOKIE = 'b2b_cart_anon';

describe('storefront cart routes address the basket of the request channel', () => {
  let h: BackendServerHandle;
  let fx: TwoChannelBasket;
  let tokenOfA: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await seedTwoChannelBasket(h, 'contract');
    const onA = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { 'x-sales-channel': fx.a.code, 'content-type': 'application/json' },
      payload: { productId: fx.productId, quantity: 1 },
    });
    expect(onA.statusCode, onA.body).toBe(200);
    tokenOfA = onA.cookies.find((c) => c.name === ANON_COOKIE)!.value;
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function onB(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
    return h.app.inject({
      method,
      url,
      headers: {
        'x-sales-channel': fx.b.code,
        ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      cookies: { [ANON_COOKIE]: tokenOfA },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  describe('an anonymous token of a basket made on another channel', () => {
    it('GET /api/v1/cart answers the empty cart', async () => {
      const res = await onB('GET', '/api/v1/cart');
      expect(res.statusCode).toBe(200);
      const data = (res.json() as { data: { id: string | null; items: unknown[] } }).data;
      expect(data.id).toBeNull();
      expect(data.items).toEqual([]);
    });

    it('GET /api/v1/cart?view=mini answers the empty mini cart', async () => {
      const res = await onB('GET', '/api/v1/cart?view=mini');
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { id: string | null } }).data.id).toBeNull();
    });

    it('POST /api/v1/cart/coupon answers 422 CART_EMPTY', async () => {
      const res = await onB('POST', '/api/v1/cart/coupon', { code: 'ANY' });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CART_EMPTY);
    });

    it('DELETE /api/v1/cart/coupon answers the empty cart', async () => {
      const res = await onB('DELETE', '/api/v1/cart/coupon');
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { id: string | null } }).data.id).toBeNull();
    });

    it('GET /api/v1/cart/upsells answers no candidates', async () => {
      const res = await onB('GET', '/api/v1/cart/upsells');
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('POST /api/v1/cart/items starts a basket on this channel under a new cookie', async () => {
      const res = await onB('POST', '/api/v1/cart/items', { productId: fx.productId, quantity: 1 });
      expect(res.statusCode, res.body).toBe(200);
      const cookie = res.cookies.find((c) => c.name === ANON_COOKIE);
      expect(cookie).toBeDefined();
      expect(cookie!.value).not.toBe(tokenOfA);
      expect(cookie!.path).toBe('/');
      expect(cookie!.httpOnly).toBe(true);
      const data = (res.json() as { data: { salesChannelId: string; anonymousCartToken: string } })
        .data;
      expect(data.salesChannelId).toBe(fx.b.id);
      expect(data.anonymousCartToken).toBe(cookie!.value);
    });

    it('still addresses its own basket on its own channel', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/cart',
        headers: { 'x-sales-channel': fx.a.code },
        cookies: { [ANON_COOKIE]: tokenOfA },
      });
      const data = (res.json() as { data: { salesChannelId: string; items: unknown[] } }).data;
      expect(data.salesChannelId).toBe(fx.a.id);
      expect(data.items).toHaveLength(1);
    });
  });

  describe('a signed-in customer', () => {
    it('reads a different basket on each channel, each recording its channel', async () => {
      const read = (code: string) =>
        h.app.inject({
          method: 'GET',
          url: '/api/v1/cart',
          headers: { 'x-sales-channel': code },
          cookies: BUYER,
        });
      const a = (await read(fx.a.code)).json() as { data: { id: string; salesChannelId: string } };
      const b = (await read(fx.b.code)).json() as { data: { id: string; salesChannelId: string } };
      expect(a.data.id).not.toBe(b.data.id);
      expect(a.data.salesChannelId).toBe(fx.a.id);
      expect(b.data.salesChannelId).toBe(fx.b.id);
    });
  });
});
