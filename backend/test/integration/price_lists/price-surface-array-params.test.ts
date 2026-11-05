import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgArray } from '../../../../packages/modules/price_lists/src/backend/services/sql-array.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';

/**
 * Review finding 10 (release 0.108.0) — `price_lists` bound its arrays as
 * hand-built Postgres literals, and the text one escaped `"` but not `\`. An
 * attribute key with a backslash was read as another key (so its rows marked
 * nothing), and one ending in a backslash made the literal malformed, so the
 * marking failed and fell back to marking every profile stale. One shared
 * helper (`sql-array.ts`) now quotes and escapes every element.
 */
describe('price_lists — array parameters', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const staleProfiles = async () =>
    (await sql<{ n: number }>(`select count(*)::int as "n" from "price_profiles" where "stale"`))[0]!.n;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  it('round-trips every element through Postgres unchanged', async () => {
    const values = ['a\\b', 'c"d', '', 'NULL', 'x,y', '{z}', ' sp ', 'end\\'];
    const [row] = await sql<{ v: string[] }>(`select ?::text[] as "v"`, [pgArray(values)]);
    expect(row!.v).toEqual(values);
    const [withNull] = await sql<{ v: Array<string | null> }>(`select ?::numeric[]::text[] as "v"`, [pgArray(['1.5000', null])]);
    expect(withNull!.v).toEqual(['1.5000', null]);
    const [empty] = await sql<{ v: string[] }>(`select ?::uuid[] as "v"`, [pgArray([])]);
    expect(empty!.v).toEqual([]);
  });

  it('an attribute key with a backslash marks what its rows select, and one ending in a backslash marks nothing', async () => {
    const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '70' }] });
    await sql(
      `insert into "price_list_matrix_entries"
         ("id", "price_list_id", "category_id", "attribute_key", "attribute_value", "min_quantity", "price_type", "amount", "created_at", "updated_at")
       values (?, ?, ?, 'odd\\key', 'x', 1, 'fixed', 60, now(), now())`,
      [randomUUID(), book.id, f.categories.screws],
    );
    await f.pricing.orderByUnitPrice({
      context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
      direction: 'asc',
      after: null,
      limit: 1,
    });
    await settlePriceSurface(h);
    expect(await staleProfiles()).toBe(0);
    await sql(`delete from "price_profile_stale_products"`);

    await f.pricing.priceSurface.markChanged({ kind: 'attributes', attributeKeys: ['trailing\\'] });
    expect(await staleProfiles(), 'a key no row names marks nothing, rather than every profile').toBe(0);

    await f.pricing.priceSurface.markChanged({ kind: 'attributes', attributeKeys: ['odd\\key'] });
    const marks = await sql<{ product_id: string }>(`select "product_id" from "price_profile_stale_products"`);
    expect(marks.map((m) => m.product_id)).toContain(f.products.P2.id);
    expect(await staleProfiles()).toBe(0);
  });
});
