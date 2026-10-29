import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRICING_SETTING_CODES, type DisplayMode } from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { PriceDisplayModeOverride } from '../../helpers/package-entities.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';

/**
 * Issue #491 (`specs/pricing/worked-examples.md` §10.19, W1–W3 on search) — a
 * Meilisearch-backed listing hit and a typeahead suggestion are priced through
 * the same listing mapping as the catalogue cards, so display mode `none`
 * withholds every amount there too: `price` and `resolvedPrice`'s base and
 * sale on a hit, `basePrice` and `salePrice` on a suggestion — and
 * `displayMode: 'none'` stays so the storefront says "price on request".
 *
 * The seeded product is priced 33.33 for everyone on `pl_retail` by a book
 * this file adds, so a leak has one figure to look for.
 */
const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('search hits and suggestions withhold every amount under display mode `none` (#491)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let retailId: string;
  const saved: Record<string, string | undefined> = {};

  const BUYER = { b2b_session: 'stub-customer-session' };
  const CHANNEL = { 'x-sales-channel': 'pl_retail' };
  const LEAK = /33\.33/;
  type Money = { amount: string; currency: string };

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

  async function hit(cookies?: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${SEED_PRODUCT_101_SKU}&limit=50`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const entry = (
      res.json() as {
        data: Array<{
          id: string;
          price: { amount: number } | null;
          resolvedPrice?: { basePrice: Money | null; salePrice: Money | null; displayMode: string } | null;
        }>;
      }
    ).data.find((p) => p.id === SEED_PRODUCT_101_ID);
    expect(entry, 'the seeded product is a hit').toBeDefined();
    return { entry: entry!, raw: res.body };
  }

  async function suggestion(cookies?: Record<string, string>) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${SEED_PRODUCT_101_SKU}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    const item = (
      res.json() as { data: Array<{ id: string; basePrice?: Money | null; salePrice?: Money | null; priceDisplayMode?: string }> }
    ).data.find((p) => p.id === SEED_PRODUCT_101_ID);
    expect(item, 'the seeded product is suggested').toBeDefined();
    return { item: item!, raw: res.body };
  }

  async function expectWithheld(cookies?: Record<string, string>): Promise<void> {
    const h1 = await hit(cookies);
    expect(h1.entry.price).toBeNull();
    expect(h1.entry.resolvedPrice).toEqual({ basePrice: null, salePrice: null, displayMode: 'none' });
    expect(h1.raw).not.toMatch(LEAK);
    const s1 = await suggestion(cookies);
    expect(s1.item.basePrice).toBeNull();
    expect(s1.item.salePrice).toBeNull();
    expect(s1.item.priceDisplayMode).toBe('none');
    expect(s1.raw).not.toMatch(LEAK);
  }

  beforeAll(async () => {
    for (const key of ['CATALOG_SEARCH_BACKEND', 'MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    api = priceBookApi(h);
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    retailId = channel.id;
    await seedPriceBookSql(h.em(), {
      name: '#491 search — everyone',
      audience: 'everyone',
      channelIds: [retailId],
      rows: [{ productId: SEED_PRODUCT_101_ID, fixed: '33.33' }],
    });
    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    await indexer.reindexChannel(h.em(), channel);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 5 * 60_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await teardownBackendServer(h);
  });

  /**
   * Before and after each case: the harness does not empty
   * `price_display_mode_overrides` between files, and the seeded product's id
   * is fixed, so an override left behind would withhold it in the next file.
   */
  async function reset(): Promise<void> {
    await h.em().nativeDelete(PriceDisplayModeOverride, { targetId: SEED_PRODUCT_101_ID });
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, null);
    await setSetting(PRICING_SETTING_CODES.DEFAULT_DISPLAY_MODE, null);
  }

  beforeEach(reset);
  afterEach(reset);

  it('control — a guest on a priced mode is sent the price', async () => {
    expect((await hit()).entry.price).toEqual({ amount: 33.33, currency: 'PLN' });
    expect((await suggestion()).item.basePrice).toEqual({ amount: '33.3300', currency: 'PLN' });
  }, 60_000);

  it('W1 — `unauthenticated = none`: a guest is sent no amount on a hit or a suggestion', async () => {
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'none');
    await expectWithheld();
  }, 60_000);

  it('W2 — the same shop: a signed-in buyer on a priced mode is sent the price', async () => {
    await setSetting(PRICING_SETTING_CODES.UNAUTHENTICATED_DISPLAY_MODE, 'none');
    const buyerHit = await hit(BUYER);
    expect(buyerHit.entry.price).toEqual({ amount: 33.33, currency: 'PLN' });
    expect(buyerHit.entry.resolvedPrice?.displayMode).toBe('gross_only');
    expect((await suggestion(BUYER)).item.basePrice).toEqual({ amount: '33.3300', currency: 'PLN' });
  }, 60_000);

  it('W3 — a product overridden to `none`: withheld from a guest and a buyer alike', async () => {
    const res = await api.put(`/api/v1/admin/pricing/display-mode-overrides/product/${SEED_PRODUCT_101_ID}`, { mode: 'none' });
    expect(res.status, res.raw).toBe(200);
    await expectWithheld();
    await expectWithheld(BUYER);
  }, 60_000);
});
