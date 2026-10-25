import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
import {
  clearProductScopes,
  errorBodyOf,
  setChannelStatus,
  setGlobalWindow,
} from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/consumers.md` rows 21–22)
 * — the storefront probes that take a bare product id: the resolved price, the
 * price display mode, the stock figure and both notify-when-available routes.
 *
 * Each of them answered about any product the global audience rule let through,
 * so a switched-off product, one outside its window or one sold on another channel had
 * its price, its existence and its stock disclosed by id. They now ask
 * `catalogProductAvailabilityPort` at the request's (channel, language) for the
 * caller, and every "no" is the route's own single not-found — the same body an
 * id nobody sells gets, so the reason cannot be told apart (and no 409/422 is
 * reachable for a product the caller may not have).
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — storefront probes by product id honour scoped availability [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let on: MinimumProductFixture;
  const unavailable: Record<string, MinimumProductFixture> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    const create = (label: string, channelIds: readonly string[]) =>
      createMinimumProduct(em, {
        sku: `S163-PRB-${label}-${RUN}`,
        nameEn: `Probe ${label}`,
        namePl: `Sonda ${label}`,
        channelIds,
      });
    on = await create('ON', channels);
    unavailable['switched off in the channel'] = await create('OFF', channels);
    unavailable['outside its window'] = await create('ENDED', channels);
    unavailable['sold on no channel of the request'] = await create('ELSEWHERE', []);
    await setChannelStatus(em, unavailable['switched off in the channel']!.id, channels, 'inactive');
    await setGlobalWindow(em, unavailable['outside its window']!.id, {
      from: null,
      until: new Date(Date.now() - 60_000),
    });
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [on.id, ...Object.values(unavailable).map((p) => p.id)]);
    await teardownBackendServer(h);
  });

  const probes: Array<[string, (productId: string) => Promise<{ statusCode: number; body: string; json(): unknown }>]> = [
    [
      'GET resolved-price',
      (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/products/${id}/resolved-price`, headers: CHANNEL }),
    ],
    [
      'GET resolved-price (signed in)',
      (id) =>
        h.app.inject({
          method: 'GET',
          url: `/api/v1/storefront/products/${id}/resolved-price`,
          headers: CHANNEL,
          cookies: BUYER,
        }),
    ],
    [
      'GET display-mode',
      (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/pricing/display-mode/${id}`, headers: CHANNEL }),
    ],
    [
      'GET inventory stock',
      (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/inventory/stock/${id}`, headers: CHANNEL }),
    ],
    [
      'POST storefront notify-when-available',
      (id) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/storefront/inventory/notify-when-available',
          headers: CHANNEL,
          payload: { productId: id, email: `probe-${RUN}@example.com` },
        }),
    ],
    [
      'POST catalog notify-when-available (signed in)',
      (id) =>
        h.app.inject({
          method: 'POST',
          url: `/api/v1/catalog/products/${id}/notify-when-available`,
          headers: CHANNEL,
          cookies: BUYER,
          payload: {},
        }),
    ],
  ];

  for (const [probe, call] of probes) {
    it(`${probe}: every unavailable product answers exactly what an absent one does`, async () => {
      const absent = await call(randomUUID());
      expect(absent.statusCode, absent.body).toBe(404);
      for (const [reason, product] of Object.entries(unavailable)) {
        const res = await call(product.id);
        expect(res.statusCode, `${reason}: ${res.body}`).toBe(404);
        expect(errorBodyOf(res), reason).toEqual(errorBodyOf(absent));
      }
    });

    it(`${probe}: still answers about an available product`, async () => {
      const res = await call(on.id);
      expect(res.statusCode, res.body).not.toBe(404);
      expect(res.statusCode, res.body).toBeLessThan(500);
    });
  }

  // Security review (checkpoint B) — the facet counts and the category tree are
  // cut by what the caller may reach, so an identified caller's answer is
  // private; the anonymous one is left unstamped (Principle VII).
  for (const url of ['/api/v1/catalog/filters', '/api/v1/catalog/categories']) {
    it(`GET ${url} is private for a signed-in caller and unstamped for the public`, async () => {
      const signedIn = await h.app.inject({ method: 'GET', url, headers: CHANNEL, cookies: BUYER });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      expect(signedIn.headers['cache-control']).toBe('private, no-store');
      const anonymous = await h.app.inject({ method: 'GET', url, headers: CHANNEL });
      expect(anonymous.statusCode, anonymous.body).toBe(200);
      expect(anonymous.headers['cache-control']).toBeUndefined();
    });
  }
});
