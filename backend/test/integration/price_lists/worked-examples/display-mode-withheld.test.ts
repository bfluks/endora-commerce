import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRICING_SETTING_CODES, type DisplayMode } from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { PriceDisplayModeOverride } from '../../../helpers/package-entities.js';
import { priceBookApi, type ApiClient } from '../../../helpers/price-book-admin.js';
import { seedPriceBookSql } from '../../../helpers/price-book-sql.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../../helpers/test-server.js';
import {
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  PRICED_CATEGORY_A,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_PRODUCT_ID,
  VIEWER_PRICED_SKU,
  VIEWER_PRICED_SLUG,
  VIEWER_PRICED_SOURCE_SLUG,
} from '../../../helpers/viewer-priced-fixture.js';

/**
 * `specs/pricing/worked-examples.md` §10.19 — display mode `none` withholds
 * every amount on the server (issue #491), vectors W1–W6.
 *
 * The probe product (`viewer-priced-fixture.ts`) is priced 88.00 for everyone
 * on `pl_retail` and 10.00 for the buyer's Organization; this file adds a sale
 * of 80.00 for everyone and turns the list price on, so a guest's priced answer
 * carries four figures — the price 80.00, its compare-at 88.00, the sale 80.00
 * and the list price 88.00 — and a withheld answer has four to leak.
 *
 * Every catalogue surface is asked: the listing, the product page, the product
 * links strip, the comparison and the storefront resolved price. Search hits
 * and suggestions ask the same mapping through Meilisearch, in
 * `backend/test/integration/search/display-mode-withheld-in-search.test.ts`.
 */
const SALE_AMOUNT = '80.00';

/** No figure of the probe product's — 88 or 80, in any spelling — anywhere in the body. */
const LEAK = /"amount":"?(88|80)(\.0+)?"?[,}]|"(88|80)\.0000"/;

describe('§10.19 — display mode `none` withholds every amount (#491)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let retailId: string;

  async function setSetting(code: string, mode: DisplayMode | null): Promise<void> {
    const em = h.em().fork();
    const setting = await em.findOneOrFail(Setting, { code });
    const existing = await em.findOne(SettingValue, { setting: setting.id, salesChannel: retailId });
    if (mode === null) {
      if (existing) em.remove(existing);
    } else if (existing) {
      existing.value = mode;
      existing.updatedAt = new Date();
    } else {
      em.create(SettingValue, { setting, salesChannel: em.getReference(SalesChannel, retailId), value: mode });
    }
    await em.flush();
  }

  async function override(scope: 'product' | 'category', targetId: string, mode: DisplayMode | 'inherit'): Promise<void> {
    const res = await api.put(`/api/v1/admin/pricing/display-mode-overrides/${scope}/${targetId}`, { mode });
    expect([200, 204], res.raw).toContain(res.status);
  }

  async function get(url: string, cookies?: Record<string, string>): Promise<{ body: unknown; raw: string }> {
    const res = await h.app.inject({ method: 'GET', url, headers: RETAIL_CHANNEL, ...(cookies ? { cookies } : {}) });
    expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
    return { body: res.json(), raw: res.body };
  }

  type Summary = {
    sku: string;
    price: { amount: number } | null;
    compareAtPrice?: unknown;
    priceVariesByVariant?: unknown;
    resolvedPrice?: { basePrice: unknown; salePrice: unknown; displayMode: string; listPrice?: unknown } | null;
  };

  /** Every surface's answer for the probe product, with the raw body it came in. */
  async function surfaces(cookies?: Record<string, string>) {
    const listing = await get(`/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}`, cookies);
    const detail = await get(`/api/v1/catalog/products/${VIEWER_PRICED_SLUG}`, cookies);
    const links = await get(`/api/v1/catalog/products/${VIEWER_PRICED_SOURCE_SLUG}/links`, cookies);
    const resolved = await get(`/api/v1/storefront/products/${VIEWER_PRICED_PRODUCT_ID}/resolved-price`, cookies);
    const compared = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      headers: { ...RETAIL_CHANNEL, 'content-type': 'application/json' },
      ...(cookies ? { cookies } : {}),
      payload: { productId: VIEWER_PRICED_PRODUCT_ID },
    });
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
      resolved: {
        raw: resolved.raw,
        price: (resolved.body as { data: { resolvedPrice: Record<string, unknown> } }).data.resolvedPrice,
      },
      comparison: {
        raw: compared.body,
        price: (compared.json() as { data: { products: Array<{ id: string; price: unknown }> } }).data.products.find(
          (p) => p.id === VIEWER_PRICED_PRODUCT_ID,
        )!.price,
      },
    };
  }

  /** The probe product is withheld on every surface: no figure, `displayMode: 'none'` where a mode is carried. */
  async function expectWithheld(cookies?: Record<string, string>): Promise<void> {
    const s = await surfaces(cookies);
    for (const summary of [s.listing.entry, s.detail.entry]) {
      expect(summary.price).toBeNull();
      expect(summary.compareAtPrice ?? null).toBeNull();
      expect(summary.priceVariesByVariant).toBeUndefined();
      expect(summary.resolvedPrice).toEqual({ basePrice: null, salePrice: null, displayMode: 'none' });
    }
    expect(s.link.price).toBeNull();
    expect(s.comparison.price).toBeNull();
    expect(s.resolved.price).toEqual({
      baseListId: null,
      basePrice: null,
      saleListId: null,
      salePrice: null,
      displayMode: 'none',
      currencyCode: 'PLN',
      quantityBracket: null,
      source: null,
      compareAt: null,
    });
    for (const [surface, { raw }] of Object.entries(s)) expect(raw, surface).not.toMatch(LEAK);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
    await seedViewerPricedFixture(h.em());
    retailId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    await seedPriceBookSql(h.em(), {
      name: '§10.19 sale for everyone',
      type: 'sale',
      audience: 'everyone',
      rows: [{ productId: VIEWER_PRICED_PRODUCT_ID, fixed: SALE_AMOUNT }],
    });
    const shown = await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: true });
    expect(shown.status, shown.raw).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: false });
    await teardownBackendServer(h);
  });

  /**
   * Scoped to the targets this file writes, never a table wipe (issue #166) —
   * and after each case as well as before it: the harness does not empty
   * `price_display_mode_overrides` between files, and the probe product's id is
   * fixed, so an override left behind would withhold it in the next file.
   */
  async function reset(): Promise<void> {
    await h.em().nativeDelete(PriceDisplayModeOverride, { targetId: { $in: [VIEWER_PRICED_PRODUCT_ID, PRICED_CATEGORY_A.id] } });
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, null);
    await setSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, null);
  }

  beforeEach(reset);
  afterEach(reset);

  it('control — a guest on a priced mode is sent the sale, its compare-at and the list price', async () => {
    const s = await surfaces();
    expect(s.listing.entry.price).toEqual({ amount: 80, currency: 'PLN' });
    expect(s.listing.entry.compareAtPrice).toEqual({ amount: 88, currency: 'PLN' });
    expect(s.detail.entry.resolvedPrice).toMatchObject({
      basePrice: { amount: '88.0000', currency: 'PLN' },
      salePrice: { amount: '80.0000', currency: 'PLN' },
      displayMode: 'gross_only',
      listPrice: { amount: '88.0000', currency: 'PLN' },
    });
    expect(s.link.price).toEqual({ amount: 80, currency: 'PLN' });
    expect(s.comparison.price).toEqual({ amount: 80, currency: 'PLN' });
    expect(s.resolved.price).toMatchObject({ salePrice: { amount: '80.0000' }, source: 'sale', displayMode: 'gross_only' });
  });

  it('W1 — `pricing.unauthenticated_display_mode = none`: a guest is sent no amount anywhere', async () => {
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'none');
    await expectWithheld();
  });

  it('W2 — the same shop: a signed-in buyer on a priced mode is sent their price unchanged', async () => {
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'none');
    await setSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, 'net_only');
    const s = await surfaces(ORG_A_BUYER);
    expect(s.listing.entry.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.detail.entry.resolvedPrice).toMatchObject({ basePrice: { amount: '10.0000' }, displayMode: 'net_only' });
    expect(s.link.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.comparison.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
    expect(s.resolved.price).toMatchObject({ basePrice: { amount: '10.0000' }, source: 'buyer', displayMode: 'net_only' });
  });

  it('W3 — a product overridden to `none`: withheld from a guest and from a signed-in buyer alike', async () => {
    await override('product', VIEWER_PRICED_PRODUCT_ID, 'none');
    await expectWithheld();
    await expectWithheld(ORG_A_BUYER);
  });

  it('W4 — a category of the product overridden to `none`: withheld', async () => {
    await override('category', PRICED_CATEGORY_A.id, 'none');
    await expectWithheld();
  });

  it('W5 — a product overridden to a priced mode under `unauthenticated = none`: the product step decides, the guest is priced', async () => {
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'none');
    await override('product', VIEWER_PRICED_PRODUCT_ID, 'gross_only');
    const s = await surfaces();
    expect(s.listing.entry.price).toEqual({ amount: 80, currency: 'PLN' });
    expect(s.resolved.price).toMatchObject({ salePrice: { amount: '80.0000' }, displayMode: 'gross_only' });
  });

  it('W6 — the cart still refuses a withheld product as quote-only', async () => {
    await override('product', VIEWER_PRICED_PRODUCT_ID, 'none');
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { ...RETAIL_CHANNEL, 'content-type': 'application/json' },
      cookies: ORG_A_BUYER,
      payload: { productId: VIEWER_PRICED_PRODUCT_ID, quantity: 1 },
    });
    expect(added.statusCode, added.body).toBe(400);
    expect((added.json() as { error: { code: string } }).error.code).toBe('CART_PRODUCT_QUOTE_ONLY');
    expect(added.body).not.toMatch(LEAK);
  });
});
