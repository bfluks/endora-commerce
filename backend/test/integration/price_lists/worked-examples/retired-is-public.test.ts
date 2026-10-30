import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PRICING_SETTING_CODES } from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { PriceDisplayModeOverride } from '../../../helpers/package-entities.js';
import { priceBookApi, type ApiClient } from '../../../helpers/price-book-admin.js';
import { migrateChannelsAsFormerlyNonPublic } from '../../../helpers/retire-is-public-migration.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../../helpers/test-server.js';
import {
  CHANNEL_AMOUNT,
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_PRODUCT_ID,
  VIEWER_PRICED_SKU,
  VIEWER_PRICED_SLUG,
  VIEWER_PRICED_SOURCE_SLUG,
} from '../../../helpers/viewer-priced-fixture.js';

/**
 * `specs/pricing/worked-examples.md` §10.20 — a channel that was non-public
 * after the flag is retired (issue #492), vectors P1–P4.
 *
 * The probe product (`viewer-priced-fixture.ts`) is priced 88.00 for everyone
 * on `pl_retail` and 10.00 for the buyer's Organization. `pl_retail` is made a
 * former non-public channel the way a real database becomes one: the column is
 * recreated, the channel marked non-public, and the retiring migration
 * run — so what is asserted is the migration's outcome on every surface, not a
 * setting this file wrote itself.
 *
 *  - P1 an anonymous visitor is sent no amount (guest mode `none`);
 *  - P2 a signed-in buyer is priced — the behaviour change: the flag used to
 *    withhold prices from them as well;
 *  - P3 the price ordering is refused to the visitor and served to the buyer;
 *  - P4 a product override to a priced mode reveals that product to the
 *    visitor: the product step precedes the channel's guest setting (owner
 *    decision of 2026-10-28, the chain unchanged).
 */
const LEAK = /"amount":"?88(\.0+)?"?[,}]|"88\.0000"/;

describe('§10.20 — a former non-public channel after #492', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let retailId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
    await seedViewerPricedFixture(h.em());
    retailId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await migrateChannelsAsFormerlyNonPublic(h.em(), [retailId]);
  }, 5 * 60_000);

  /**
   * Scoped to what this file wrote (issue #166): the guest value the migration
   * wrote for `pl_retail`, and the probe product's override — the harness does
   * not empty `price_display_mode_overrides` between files, and the probe id is
   * fixed.
   */
  async function removeOverride(): Promise<void> {
    await h.em().nativeDelete(PriceDisplayModeOverride, { targetId: VIEWER_PRICED_PRODUCT_ID });
  }

  afterEach(removeOverride);

  afterAll(async () => {
    await removeOverride();
    const em = h.em().fork();
    const setting = await em.findOneOrFail(Setting, { code: PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE });
    await em.nativeDelete(SettingValue, { setting: setting.id, salesChannel: retailId });
    await teardownBackendServer(h);
  });

  async function get(url: string, cookies?: Record<string, string>): Promise<{ status: number; body: unknown; raw: string }> {
    const res = await h.app.inject({ method: 'GET', url, headers: RETAIL_CHANNEL, ...(cookies ? { cookies } : {}) });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  }

  type Summary = {
    sku: string;
    price: { amount: number } | null;
    resolvedPrice?: { basePrice: unknown; salePrice: unknown; displayMode: string } | null;
  };

  async function surfaces(cookies?: Record<string, string>) {
    const listing = await get(`/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}`, cookies);
    const detail = await get(`/api/v1/catalog/products/${VIEWER_PRICED_SLUG}`, cookies);
    const links = await get(`/api/v1/catalog/products/${VIEWER_PRICED_SOURCE_SLUG}/links`, cookies);
    const compared = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...RETAIL_CHANNEL, 'content-type': 'application/json' },
      ...(cookies ? { cookies } : {}),
      payload: { productId: VIEWER_PRICED_PRODUCT_ID },
    });
    for (const [name, res] of Object.entries({ listing, detail, links })) expect(res.status, `${name}: ${res.raw}`).toBe(200);
    expect(compared.statusCode, compared.body).toBe(200);
    return {
      listing: {
        raw: listing.raw,
        entry: (listing.body as { data: Summary[] }).data.find((p) => p.sku === VIEWER_PRICED_SKU)!,
      },
      detail: { raw: detail.raw, entry: (detail.body as { data: Summary }).data },
      link: {
        raw: links.raw,
        price: (links.body as { data: Array<{ product: { slug: string; price: unknown } }> }).data.find(
          (l) => l.product.slug === VIEWER_PRICED_SLUG,
        )!.product.price,
      },
      comparison: {
        raw: compared.body,
        price: (compared.json() as { data: { products: Array<{ id: string; price: unknown }> } }).data.products.find(
          (p) => p.id === VIEWER_PRICED_PRODUCT_ID,
        )!.price,
      },
    };
  }

  it('P1 — an anonymous visitor is sent no amount', async () => {
    const s = await surfaces();
    for (const summary of [s.listing.entry, s.detail.entry]) {
      expect(summary.price).toBeNull();
      expect(summary.resolvedPrice).toEqual({ basePrice: null, salePrice: null, displayMode: 'none' });
    }
    expect(s.link.price).toBeNull();
    expect(s.comparison.price).toBeNull();
    for (const [surface, { raw }] of Object.entries(s)) expect(raw, surface).not.toMatch(LEAK);
  });

  it('P2 — a signed-in buyer is priced: the channel no longer withholds prices from them', async () => {
    const s = await surfaces(ORG_A_BUYER);
    expect(s.listing.entry.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.detail.entry.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.detail.entry.resolvedPrice).toMatchObject({ basePrice: { amount: '10.0000' }, displayMode: 'gross_only' });
    expect(s.link.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.comparison.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
  });

  it('P3 — the price ordering is refused to the visitor and served to the buyer', async () => {
    const anonymous = await get(`/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}&sort=price`);
    expect(anonymous.status, anonymous.raw).toBe(400);
    expect((anonymous.body as { error: { code: string } }).error.code).toBe('PRICE_ORDERING_UNAVAILABLE');
    const buyer = await get(`/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}&sort=price`, ORG_A_BUYER);
    expect(buyer.status, buyer.raw).toBe(200);
  });

  it('P4 — a product overridden to `gross_only` is priced for the visitor: the product step decides first', async () => {
    const res = await api.put(`/api/v1/admin/pricing/display-mode-overrides/product/${VIEWER_PRICED_PRODUCT_ID}`, {
      mode: 'gross_only',
    });
    expect([200, 204], res.raw).toContain(res.status);
    const s = await surfaces();
    expect(s.listing.entry.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    expect(s.detail.entry.resolvedPrice).toMatchObject({ basePrice: { amount: '88.0000' }, displayMode: 'gross_only' });
    expect(s.link.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
    expect(s.comparison.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
  });
});
