import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES, type CatalogProductAvailabilityPort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { checkOutBasket, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { clearProductScopes, errorBodyOf, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 24 (T145) — the SC-007 sweep: every consumer of availability
 * (`specs/163-product-data-scopes/contracts/consumers.md`, one entry per row) refuses a
 * product that is off at the request's (channel, language), and admits one that is on.
 *
 * One fixture for the whole table: ON, a member of the buyer channels with no scope
 * row (inherits global `active`); OFF, the same but switched off at the channel scope
 * on every buyer channel — off at every (C, L) of those channels; ARCHIVED, archived;
 * GOES, on until an entry switches it off mid-flow (rows 12, 14, 17, 20). Every entry
 * asserts **both** arms — a refusal test that cannot tell "off" from "always refuses"
 * measures nothing — and every refusal is held byte-equal to the seam's answer for an
 * absent id where the seam has one (#227, #259: the reason is never disclosed).
 *
 * The request shapes are the per-seam tests' (`integration/{carts,comparisons,
 * shopping_lists,quick_order,quote_requests}/scoped-availability.test.ts`,
 * `contract/catalog/scoped-availability-probes.test.ts`,
 * `integration/quote_requests/archived-product.test.ts`,
 * `contract/orders/external-intake.test.ts`, `contract/catalog/bulk-pricing-parity.test.ts`);
 * those files keep the per-seam detail (language arms, windows, audiences), this one
 * keeps the population — a row added to `consumers.md` without an entry here is the gap.
 *
 * Rows without an entry, and why:
 *  - 10 (storefront `app/sitemap.ts`) has no backend seam: it calls row 1, whose
 *    `ProductSummary.slug` the row-1 entry reads.
 *  - 15 (feature-155 order rules per channel) and 25 (gallery per channel) refuse
 *    nothing: they choose which value applies, and are asserted by
 *    `integration/carts/channel-order-rules.test.ts`, `integration/orders/channel-returnable.test.ts`,
 *    `unit/product_feeds/gallery-comes-from-catalog.test.ts` and
 *    `unit/comparisons/base-image-comes-from-catalog.test.ts`.
 *  - 7–8's index filter needs Meilisearch (`integration/search/scoped-availability.test.ts`,
 *    serial project); the entry here holds the projection the documents are built from.
 *
 * The ARCHIVED arm (final code review C-m1) — asserted here wherever the seam's refusal
 * is its single not-found or an absence: rows 1, 2, 4, 5, 6, 7–8, 9, 14 (a basket line
 * archived before placement), and every seam that goes through `expectSingleNotFound`
 * (12 add, 13, 16 buyer, 17 save, 21, 22); row 3 answers the archived product's own
 * `410`; row 26 is archived-only. Not here, and where instead: 11 (the feed's selection
 * — `integration/product_feeds/generation.test.ts` emits no archived product), 18
 * (quick-order import reports `product_archived`, a different reason by design —
 * `packages/modules/quick_order/src/backend/services/import-pipeline.test.ts`), row 26's
 * draft edit, resubmit, operator edit and approved-quote conversion
 * (`integration/quote_requests/archived-product.test.ts`). **Not asserted for an archived
 * product anywhere**: 20 (reorder of a line archived since — its placement refusal is
 * row 14's seam), 23 (external intake — its archived answer waits on owner decision
 * S-M2) and 24 (the bulk-price probe's reason for an archived SKU).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const BUYER = { b2b_session: 'stub-customer-session' };
const RETAIL = 'pl_retail';
const CHANNEL = { 'x-sales-channel': RETAIL };
const PLACEMENT = {
  deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
  billingAddressId: SEED_ADDRESS_BILLING_ID,
  deliveryMethodId: SEED_DELIVERY_METHOD_ID,
  paymentMethodId: SEED_PAYMENT_METHOD_ID,
};

interface Res {
  statusCode: number;
  body: string;
  json(): unknown;
}

describe('163 SC-007 — every consumer of availability refuses an off product [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let retailId = '';
  let on: MinimumProductFixture;
  let off: MinimumProductFixture;
  let archived: MinimumProductFixture;
  let goes: MinimumProductFixture;
/** The warehouse `seedUs2Commerce` stocks (`backend/test/helpers/seed-commerce.ts`). */
const SEED_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
  let source: MinimumProductFixture;
  let facetKey: string | null = null;
  const facetValue = `sweep-${RUN}`;
  let ordersToken = '';
  let pricesToken = '';

  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);
  const slug = (p: MinimumProductFixture) => p.sku.toLowerCase();
  const errorCode = (res: Res) => (res.json() as { error?: { code: string } }).error?.code;

  const completeActiveBaskets = () =>
    sql(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);
  const clearComparisons = () => sql(`delete from "comparisons" where "customer_account_id" = ?`, [TEST_CUSTOMER_ID]);

  /**
   * The common shape: the seam answers an absent id with its single not-found, OFF
   * with exactly that body, and ON with something that is not a refusal.
   */
  async function expectSingleNotFound(call: (productId: string) => Promise<Res>, admitted = (res: Res) => res.statusCode < 300) {
    const absent = await call(randomUUID());
    expect(absent.statusCode, absent.body).toBe(404);
    const refused = await call(off.id);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
    const gone = await call(archived.id);
    expect(gone.statusCode, `ARCHIVED: ${gone.body}`).toBe(404);
    expect(errorBodyOf(gone)).toEqual(errorBodyOf(absent));
    const res = await call(on.id);
    expect(admitted(res), `ON: ${res.statusCode} ${res.body}`).toBe(true);
  }

  const mint = async (payload: Record<string, unknown>): Promise<string> => {
    const res = await h.app.inject({ method: 'POST', url: '/api/v1/admin/api-keys', payload, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    retailId = (await em.findOneOrFail(SalesChannel, { code: RETAIL })).id;
    const create = (label: string, name: string) =>
      createMinimumProduct(em, { sku: `S163-ALL-${RUN}-${label}`, nameEn: name, namePl: name, channelIds: channels });
    on = await create('ON', `Sweep on ${RUN}`);
    off = await create('OFF', `Sweep off ${RUN}`);
    archived = await create('ARCH', `Sweep archived ${RUN}`);
    goes = await create('GOES', `Sweep goes ${RUN}`);
    source = await create('SRC', `Sweep source ${RUN}`);
    await setChannelStatus(em, off.id, channels, 'inactive');
    await sql(`update "products" set "archived_at" = now() where "id" = ?`, [archived.id]);
    // Row 20 places an order for GOES before switching it off: it needs stock in the
    // seeded warehouse, or placement answers STOCK_UNAVAILABLE instead.
    await sql(
      `insert into stock_levels (id, product_id, warehouse_id, on_hand, reserved, created_at, updated_at)
       values (?, ?, ?, 1000, 0, now(), now())`,
      [randomUUID(), goes.id, SEED_WAREHOUSE_ID],
    );

    // Row 2 — a filterable option-style attribute carrying a per-run value.
    const filters = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: CHANNEL });
    const defs = (filters.json() as { data: Array<{ attributeKey: string; valueType: string }> }).data;
    facetKey = defs.find((d) => ['enum', 'select', 'string'].includes(d.valueType))?.attributeKey ?? null;
    if (facetKey) {
      await sql(`update "products" set "attribute_values" = ?::jsonb where "id" in (?, ?, ?)`, [
        JSON.stringify({ [facetKey]: facetValue }),
        on.id,
        off.id,
        archived.id,
      ]);
    }
    // Row 4 — SOURCE names ON and OFF as related.
    await sql(
      `insert into product_links (id, source_product_id, target_product_id, kind, position, created_at, updated_at)
       values (?, ?, ?, 'related', 0, now(), now()), (?, ?, ?, 'related', 1, now(), now()),
              (?, ?, ?, 'related', 2, now(), now())`,
      [randomUUID(), source.id, on.id, randomUUID(), source.id, off.id, randomUUID(), source.id, archived.id],
    );
    // Rows 23–24 — keys bound to the retail channel and the test buyer.
    const binding = { organizationId: TEST_ORGANIZATION_ID, salesChannelId: retailId, customerAccountId: TEST_CUSTOMER_ID };
    ordersToken = await mint({ name: `Sweep orders ${RUN}`, scopes: ['orders:read', 'orders:write'], binding });
    pricesToken = await mint({ name: `Sweep prices ${RUN}`, scopes: ['catalog:read'], binding });
  }, 60_000);

  beforeEach(async () => {
    await completeActiveBaskets();
    await clearComparisons();
    await clearProductScopes(h.em(), [goes.id]);
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await clearComparisons();
    await sql(`delete from product_links where source_product_id = ?`, [source.id]);
    await sql(`delete from stock_levels where product_id = ?`, [goes.id]);
    await sql(`update "products" set "archived_at" = null where "id" = ?`, [archived.id]);
    await clearProductScopes(h.em(), [on.id, off.id, goes.id]);
    await teardownBackendServer(h);
  });

  const listing = (query: string) =>
    h.app.inject({ method: 'GET', url: `/api/v1/catalog/products?${query}`, headers: CHANNEL });
  const addToBasket = (productId: string) =>
    h.app.inject({ method: 'POST', url: '/api/v1/cart/items', cookies: BUYER, payload: { productId, quantity: 1 } });

  const SEAMS: ReadonlyArray<{ row: string; seam: string; check: () => Promise<void> }> = [
    {
      row: '1, 10',
      seam: 'catalog listing (and the storefront sitemap built on it)',
      check: async () => {
        const res = await listing(`q=${encodeURIComponent(`S163-ALL-${RUN}`)}&limit=50`);
        expect(res.statusCode, res.body).toBe(200);
        const data = (res.json() as { data: Array<{ id: string; slug: string }> }).data;
        expect(data.find((p) => p.id === on.id)?.slug).toBe(slug(on));
        expect(data.map((p) => p.id)).not.toContain(off.id);
        expect(data.map((p) => p.id)).not.toContain(archived.id);
      },
    },
    {
      row: '2',
      seam: 'catalog facets',
      check: async () => {
        if (!facetKey) throw new Error('the seed provides no filterable option-style attribute');
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: CHANNEL });
        expect(res.statusCode).toBe(200);
        const def = (
          res.json() as { data: Array<{ attributeKey: string; options?: Array<{ value: string; count: number }> }> }
        ).data.find((d) => d.attributeKey === facetKey);
        expect(def?.options?.find((o) => o.value === facetValue)?.count).toBe(1);
      },
    },
    {
      row: '3, 19',
      seam: 'product page by slug (and the CMS product block, which requests it)',
      check: async () => {
        const page = (s: string) => h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${s}`, headers: CHANNEL });
        const absent = await page(`s163-all-absent-${RUN}`);
        expect(absent.statusCode).toBe(404);
        const refused = await page(slug(off));
        expect(refused.statusCode).toBe(404);
        expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
        // FR-005 — an archived product the reader could otherwise see is gone, not absent.
        expect((await page(slug(archived))).statusCode).toBe(410);
        expect((await page(slug(on))).statusCode).toBe(200);
      },
    },
    {
      row: '4',
      seam: 'product links',
      check: async () => {
        const res = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slug(source)}/links`, headers: CHANNEL });
        expect(res.statusCode, res.body).toBe(200);
        const targets = (res.json() as { data: Array<{ product: { id: string } }> }).data.map((l) => l.product.id);
        expect(targets).toContain(on.id);
        expect(targets).not.toContain(off.id);
        expect(targets).not.toContain(archived.id);
      },
    },
    {
      row: '5',
      seam: 'quick search',
      check: async () => {
        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/quick-order/search?q=${encodeURIComponent(`S163-ALL-${RUN}`)}&limit=50`,
          headers: CHANNEL,
          cookies: BUYER,
        });
        expect(res.statusCode, res.body).toBe(200);
        const hits = (res.json() as { data: Array<{ productId: string }> }).data.map((hit) => hit.productId);
        expect(hits).toContain(on.id);
        expect(hits).not.toContain(off.id);
        expect(hits).not.toContain(archived.id);
      },
    },
    {
      row: '6',
      seam: 'listing free-text over the effective name',
      check: async () => {
        const find = async (name: string) => {
          const res = await listing(`q=${encodeURIComponent(name)}&limit=10`);
          expect(res.statusCode, res.body).toBe(200);
          return (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
        };
        expect(await find(`Sweep on ${RUN}`)).toContain(on.id);
        expect(await find(`Sweep off ${RUN}`)).not.toContain(off.id);
        expect(await find(`Sweep archived ${RUN}`)).not.toContain(archived.id);
      },
    },
    {
      row: '7, 8',
      seam: 'search documents — the availability projection they carry',
      check: async () => {
        const port = (h.container.cradle as never as { catalogProductAvailabilityPort: CatalogProductAvailabilityPort })
          .catalogProductAvailabilityPort;
        const described = await port.describeChannelAvailability([on.id, off.id, archived.id], retailId);
        expect(described.get(on.id)?.liveLanguages.length ?? 0).toBeGreaterThan(0);
        expect(described.get(off.id)?.liveLanguages ?? []).toEqual([]);
        expect(described.get(archived.id)?.liveLanguages ?? []).toEqual([]);
      },
    },
    {
      row: '9',
      seam: 'sitemap',
      check: async () => {
        const regen = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
          cookies: ADMIN,
          headers: CHANNEL,
        });
        expect(regen.statusCode, regen.body).toBe(200);
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml', headers: CHANNEL });
        expect(res.statusCode).toBe(200);
        expect(res.body).toContain(`/p/${slug(on)}`);
        expect(res.body).not.toContain(`/p/${slug(off)}`);
        expect(res.body).not.toContain(`/p/${slug(archived)}`);
      },
    },
    {
      row: '11',
      seam: 'product feed selection',
      check: async () => {
        const count = async () => {
          const res = await h.app.inject({
            method: 'POST',
            url: '/api/v1/admin/feed-previews/selection',
            cookies: ADMIN,
            payload: { salesChannelId: retailId, selectionRule: { kind: 'all' } },
          });
          expect(res.statusCode, res.body).toBe(200);
          return (res.json() as { data: { matchedCount: number } }).data.matchedCount;
        };
        const withOffOff = await count();
        await setChannelStatus(h.em(), off.id, channels, null);
        try {
          expect(await count()).toBe(withOffOff + 1);
        } finally {
          await setChannelStatus(h.em(), off.id, channels, 'inactive');
        }
      },
    },
    {
      row: '12',
      seam: 'comparisons — add, and the owner’s column of a product gone off',
      check: async () => {
        const add = (productId: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/comparisons/me/products',
            cookies: BUYER,
            headers: { ...CHANNEL, 'content-type': 'application/json' },
            payload: { productId },
          });
        await expectSingleNotFound(add);
        expect((await add(goes.id)).statusCode).toBe(200);
        await setChannelStatus(h.em(), goes.id, channels, 'inactive');
        const res = await h.app.inject({ method: 'GET', url: '/api/v1/comparisons/me', cookies: BUYER, headers: CHANNEL });
        expect(res.statusCode, res.body).toBe(200);
        const columns = (res.json() as { data: { products: Array<{ id: string; available: boolean }> } }).data.products;
        expect(columns.find((p) => p.id === goes.id)?.available).toBe(false);
        expect(columns.find((p) => p.id === on.id)?.available).toBe(true);
      },
    },
    {
      row: '13',
      seam: 'basket add and batch add',
      check: async () => {
        await expectSingleNotFound(addToBasket);
        await completeActiveBaskets();
        const build = (productId: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/quick-order/build',
            cookies: BUYER,
            payload: { target: 'cart', items: [{ productId, quantity: 1 }] },
          });
        await expectSingleNotFound(build);
      },
    },
    {
      row: '14',
      seam: 'placement of a basket whose line went off',
      check: async () => {
        expect((await addToBasket(goes.id)).statusCode).toBeLessThan(300);
        await setChannelStatus(h.em(), goes.id, channels, 'inactive');
        const res = await h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies: BUYER, payload: PLACEMENT });
        expect(res.statusCode, res.body).toBe(404);
        expect(errorCode(res)).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
        // ARCHIVED — the same line, on again, archived before placement.
        await clearProductScopes(h.em(), [goes.id]);
        await completeActiveBaskets();
        expect((await addToBasket(goes.id)).statusCode).toBeLessThan(300);
        await sql(`update "products" set "archived_at" = now() where "id" = ?`, [goes.id]);
        try {
          const gone = await h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies: BUYER, payload: PLACEMENT });
          expect(gone.statusCode, gone.body).toBe(404);
          expect(errorCode(gone)).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
        } finally {
          await sql(`update "products" set "archived_at" = null where "id" = ?`, [goes.id]);
        }
      },
    },
    {
      row: '16',
      seam: 'quote request — buyer refused, operator warned',
      check: async () => {
        const create = (productId: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/quote-requests',
            cookies: BUYER,
            payload: { items: [{ productId, quantity: 1 }] },
          });
        await expectSingleNotFound(create);
        const operator = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/quote-requests',
          cookies: ADMIN,
          payload: {
            organizationId: TEST_ORGANIZATION_ID,
            customerAccountId: TEST_CUSTOMER_ID,
            items: [
              { productId: on.id, quantity: 1, agreedUnitPrice: 10 },
              { productId: off.id, quantity: 1, agreedUnitPrice: 10 },
            ],
          },
        });
        expect(operator.statusCode, operator.body).toBe(201);
        expect((operator.json() as { warnings?: unknown }).warnings).toEqual([
          { productId: off.id, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' },
        ]);
      },
    },
    {
      row: '17',
      seam: 'shopping lists — save, and the conversion of a line gone off',
      check: async () => {
        const save = (productId: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/shopping-lists/default/items',
            cookies: BUYER,
            headers: CHANNEL,
            payload: { productId, quantity: 1 },
          });
        await expectSingleNotFound(save);
        const saved = await save(goes.id);
        expect(saved.statusCode, saved.body).toBe(201);
        const listId = (saved.json() as { data: { id: string } }).data.id;
        await setChannelStatus(h.em(), goes.id, channels, 'inactive');
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/shopping-lists/${listId}/convert-to-cart`,
          cookies: BUYER,
          headers: CHANNEL,
          payload: {},
        });
        expect(res.statusCode, res.body).toBeLessThan(300);
        const skipped = (res.json() as { data: { skipped: Array<{ productId: string; reason: string }> } }).data.skipped;
        expect(skipped).toContainEqual(expect.objectContaining({ productId: goes.id, reason: 'product_not_found' }));
        expect(skipped.map((s) => s.productId)).not.toContain(on.id);
      },
    },
    {
      row: '18',
      seam: 'quick order import — buyer refused, operator’s unrestricted arm unchanged',
      check: async () => {
        const csv = (...skus: string[]) => ['sku,quantity', ...skus.map((s) => `${s},1`)].join('\n');
        type ImportAnswer = { data: { recognized: Array<{ sku: string }>; rejected: Array<{ reason: string }> } };
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/quick-order/import',
          headers: CHANNEL,
          cookies: BUYER,
          payload: { csv: csv(on.sku, off.sku, `S163-ALL-${RUN}-NONE`) },
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json() as ImportAnswer;
        expect(body.data.recognized.map((r) => r.sku)).toEqual([on.sku]);
        expect(body.data.rejected.map((r) => r.reason)).toEqual(['product_not_found', 'product_not_found']);
        const operator = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/quick-order/import',
          cookies: ADMIN,
          payload: { csv: csv(off.sku) },
        });
        expect(operator.statusCode, operator.body).toBe(200);
        expect((operator.json() as ImportAnswer).data.recognized.map((r) => r.sku)).toEqual([off.sku]);
      },
    },
    {
      row: '20',
      seam: 'reorder — exempt: the line is seeded, placement still refuses it',
      check: async () => {
        expect((await addToBasket(goes.id)).statusCode).toBeLessThan(300);
        const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
        await setChannelStatus(h.em(), goes.id, channels, 'inactive');
        const reordered = await h.app.inject({ method: 'POST', url: `/api/v1/orders/${placed.id}/reorder`, cookies: BUYER });
        expect(reordered.statusCode, reordered.body).toBe(200);
        const res = await h.app.inject({ method: 'POST', url: '/api/v1/orders', cookies: BUYER, payload: PLACEMENT });
        expect(res.statusCode, res.body).toBe(404);
        expect(errorCode(res)).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      },
    },
    {
      row: '21',
      seam: 'price_lists storefront probes',
      check: async () => {
        const notRefused = (res: Res) => res.statusCode !== 404 && res.statusCode < 500;
        await expectSingleNotFound(
          (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/products/${id}/resolved-price`, headers: CHANNEL }),
          notRefused,
        );
        await expectSingleNotFound(
          (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/pricing/display-mode/${id}`, headers: CHANNEL }),
          notRefused,
        );
      },
    },
    {
      row: '22',
      seam: 'inventory stock and notify-when-available',
      check: async () => {
        const notRefused = (res: Res) => res.statusCode !== 404 && res.statusCode < 500;
        await expectSingleNotFound(
          (id) => h.app.inject({ method: 'GET', url: `/api/v1/storefront/inventory/stock/${id}`, headers: CHANNEL }),
          notRefused,
        );
        await expectSingleNotFound(
          (id) =>
            h.app.inject({
              method: 'POST',
              url: '/api/v1/storefront/inventory/notify-when-available',
              headers: CHANNEL,
              payload: { productId: id, email: `sweep-${RUN}@example.com` },
            }),
          notRefused,
        );
      },
    },
    {
      row: '23',
      seam: 'external order intake (API key)',
      check: async () => {
        const post = (sku: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/external/orders',
            headers: { authorization: `Bearer ${ordersToken}`, 'idempotency-key': randomUUID() },
            payload: { lines: [{ sku, quantity: 1 }], ...PLACEMENT },
          });
        const refused = await post(off.sku);
        expect(refused.statusCode, refused.body).toBe(404);
        expect(errorCode(refused)).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
        const admitted = await post(on.sku);
        expect(errorCode(admitted), admitted.body).not.toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      },
    },
    {
      row: '24',
      seam: 'external bulk-price probe (API key)',
      check: async () => {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/external/catalog/prices',
          headers: { authorization: `Bearer ${pricesToken}` },
          payload: { lines: [{ sku: on.sku, quantity: 1 }, { sku: off.sku, quantity: 1 }] },
        });
        expect(res.statusCode, res.body).toBe(200);
        const [onLine, offLine] = (res.json() as { data: Array<{ price: unknown; reason?: string }> }).data;
        expect(onLine?.price).not.toBeNull();
        expect(offLine?.price).toBeNull();
        expect(offLine?.reason).toBe('sku_not_in_assortment');
      },
    },
    {
      row: '26',
      seam: 'quote request — an archived product is never a line',
      check: async () => {
        const create = (productId: string) =>
          h.app.inject({
            method: 'POST',
            url: '/api/v1/quote-requests',
            cookies: BUYER,
            payload: { items: [{ productId, quantity: 1 }] },
          });
        const absent = await create(randomUUID());
        const refused = await create(archived.id);
        expect(refused.statusCode, refused.body).toBe(404);
        expect(errorBodyOf(refused)).toEqual(errorBodyOf(absent));
        const operator = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/quote-requests',
          cookies: ADMIN,
          payload: {
            organizationId: TEST_ORGANIZATION_ID,
            customerAccountId: TEST_CUSTOMER_ID,
            items: [{ productId: archived.id, quantity: 1, agreedUnitPrice: 10 }],
          },
        });
        expect(operator.statusCode, operator.body).toBe(409);
        expect(errorCode(operator)).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
        expect((await create(on.id)).statusCode).toBe(201);
      },
    },
  ];

  for (const entry of SEAMS) {
    it(`row ${entry.row} — ${entry.seam}`, entry.check);
  }

  it('covers every row of contracts/consumers.md but the ones the header names', () => {
    const covered = new Set(SEAMS.flatMap((entry) => entry.row.split(',').map((r) => Number(r.trim()))));
    const named = new Set([15, 25]);
    for (let row = 1; row <= 26; row += 1) {
      expect(covered.has(row) || named.has(row), `row ${row}`).toBe(true);
    }
  });
});
