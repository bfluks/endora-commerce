import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ListingPriceViewerContext } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Issue #416, review of #424 — a product deleted while the price surface's
 * worker is rebuilding. `price_profile_prices.product_id` references
 * `products` (the owner kept the key, 2026-10-24), so a build that inserts a
 * row for a product deleted after the build read the catalogue fails on it.
 * That must cost the build a retry on a fresh read — never the pass: before,
 * the error aborted `rebuildStale`, and every profile after it in the pass
 * stayed stale until the job's retry, which a steady stream of deletes could
 * keep failing.
 *
 * After the pass: every profile is built, none holds a row for the deleted
 * product, and every viewer's sorted surface equals its live cards.
 */
describe('price surface — a product deleted while the worker rebuilds', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let doomed = '';
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  let viewers: Array<{ label: string; context: ListingPriceViewerContext }> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    doomed = randomUUID();
    const stamp = randomUUID().slice(0, 8);
    await sql(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "visibility", "attribute_values", "created_at", "updated_at")
       values (?, ?, ?, 'simple', 'active', '{"en-US":"Doomed"}'::jsonb, '{"en-US":"Doomed"}'::jsonb, 'public', '{"color":"red"}'::jsonb, now(), now())`,
      [doomed, `DOOMED-${stamp}`, `doomed-${stamp}`],
    );
    await f.setBase({ id: doomed }, { product: [{ minQuantity: 1, maxQuantity: null, amount: '1' }], variants: {} });
    // An all-products buyer book: the buyer's whole build reads the catalogue too.
    await f.book({ name: 'All', audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-10' }] });
    const channel = { id: f.channels.CH1.id, defaultCurrency: f.channels.CH1.defaultCurrency };
    viewers = [
      { label: 'guest', context: { salesChannel: channel } },
      { label: 'Acme', context: { salesChannel: channel, organization: f.orgs.Acme } },
    ];
    for (const viewer of viewers) {
      await f.pricing.orderByUnitPrice({ context: viewer.context, direction: 'asc', after: null, limit: 1 });
    }
    await settlePriceSurface(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  it('the pass completes, the deleted product has no row, and every sorted surface equals the live cards', async () => {
    const [{ held }] = (await sql<{ held: string }>(
      `select count(*)::text as "held" from "price_profile_prices" where "product_id" = ?`,
      [doomed],
    )) as [{ held: string }];
    expect(Number(held), 'the product is on the surfaces before the delete').toBeGreaterThan(0);

    await f.pricing.priceSurface.markStale();
    // The product is deleted while the first whole build of the pass is writing its rows.
    const driver = h.em().getDriver() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = driver.execute;
    let deleted = false;
    driver.execute = async function (this: unknown, ...args: unknown[]) {
      if (!deleted && /^\s*insert into "price_profile_prices"/.test(String(args[0]))) {
        deleted = true;
        driver.execute = original;
        await h.em().fork().getConnection().execute(`delete from "products" where "id" = ?`, [doomed]);
      }
      return original.apply(this, args);
    };
    try {
      await settlePriceSurface(h);
    } finally {
      driver.execute = original;
    }
    expect(deleted).toBe(true);

    const rows = await sql<{ n: string }>(`select count(*)::text as "n" from "price_profile_prices" where "product_id" = ?`, [doomed]);
    expect(Number(rows[0]!.n)).toBe(0);
    const pending = await sql<{ n: string }>(
      `select count(*)::text as "n" from "price_profiles" f
        where f."sales_channel_id" = ? and (f."state" = 'building' or f."stale"
              or exists (select 1 from "price_profile_stale_products" m where m."profile_id" = f."id"))`,
      [f.channels.CH1.id],
    );
    expect(Number(pending[0]!.n)).toBe(0);

    const ids = Object.values(f.products).map((p) => p.id);
    const reads = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{
      findByIds(ids: readonly string[]): Promise<Array<{ id: string; attributeValues: Record<string, unknown> }>>;
    }>('catalogProductReadPort');
    for (const viewer of viewers) {
      const sorted = (
        await f.pricing.orderByUnitPrice({ context: viewer.context, direction: 'asc', after: null, limit: 50, restrictToProductIds: ids })
      ).rows.map((r) => ({ productId: r.productId, amount: r.amount }));
      const listing = await f.pricing.resolveListingPrices({ products: await reads.findByIds(ids), context: viewer.context });
      const cards = [...listing]
        .flatMap(([productId, price]) => (price.source === 'price_list' ? [{ productId, amount: price.amount }] : []))
        .sort((a, b) => Number(a.amount) - Number(b.amount) || (a.productId < b.productId ? -1 : 1));
      expect(sorted, viewer.label).toEqual(cards);
    }
  });
});
