// perf-weight: heavy — a 50 000-product catalogue with 150 000 variants in three currencies; minutes of fixture and builds.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminProductVisibilityScope, PriceBookWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ensureBaseBookSql } from '../../helpers/price-book-sql.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  clearConfiguration,
  clearFlags,
  flagsOf,
  forgetTestRoles,
  roleWith,
  scopePort,
  settleFlags,
  waitForMark,
} from '../../integration/product_visibility_rules/fixtures.js';

/**
 * Spec 193 T035 (research R-5, R-16; SC-007, SC-008) — the catalogue-price flags at scale.
 *
 * Measures, on `PERF_PRODUCTS` products (default 50 000) of which every third is configurable
 * with `PERF_VARIANTS_PER` variants (default 9: 150 000 variants), base-priced in PLN, EUR and
 * USD (the variants inherit), with one product in seven unpriced and one in five at zero:
 *
 *  * a whole rebuild per currency (budget ≤ 150 s, FR-062 / SC-008);
 *  * a targeted price change, from the write to the flags reflecting it (budget ≤ 60 s);
 *  * the predicate in isolation: count and first page of `products` unrestricted vs restricted,
 *    p95 (budget: restricted ≤ unrestricted + 50 ms and ≤ 300 ms, R-16);
 *  * SC-008's other half: while a currency rebuilds after a designation change, no product that
 *    qualifies only through that currency is visible (the scope drops it).
 *
 * Recorded, not run in CI (`PERF_RUN=true`). Numbers go to research.md R-5 / R-16.
 */
const shouldRun = process.env['PERF_RUN'] === 'true';
const productCount = Number(process.env['PERF_PRODUCTS'] ?? '50000');
const variantsPer = Number(process.env['PERF_VARIANTS_PER'] ?? '9');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '30');
const CURRENCIES = ['PLN', 'EUR', 'USD'] as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

describe.skipIf(!shouldRun)('product visibility — flags and predicate at scale (spec 193, T035)', () => {
  let h: BackendServerHandle;
  let productIds: string[];
  const sql = <T>(s: string, p: unknown[] = []) => h.em().getConnection().execute<T[]>(s, p);
  const results: Record<string, number> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearConfiguration(h);
    await clearFlags(h);
    const stamp = Date.now();
    await sql(
      `insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
       values ('USD', 'US dollar', '$', false, true, 9, now(), now()) on conflict ("code") do update set "is_active" = true`,
    );
    await sql(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "visibility", "attribute_values", "created_at", "updated_at")
       select gen_random_uuid(), 'PVR-' || ? || '-' || g, 'pvr-' || ? || '-' || g,
              case when g % 3 = 0 then 'configurable' else 'simple' end, 'active', 'x', 'x', 'public', '{}'::jsonb, now(), now()
         from generate_series(1, ?) g`,
      [stamp, stamp, productCount],
    );
    productIds = (await sql<{ id: string }>(`select "id" from "products" where "sku" like ? order by "sku"`, [`PVR-${stamp}-%`])).map((r) => r.id);
    await sql(
      `insert into "product_variants" ("id", "parent_product_id", "sku", "variant_attribute_values", "created_at", "updated_at")
       select gen_random_uuid(), p."id", p."sku" || '-v' || v, '{}'::jsonb, now(), now()
         from "products" p cross join generate_series(1, ?) v
        where p."sku" like ? and p."type" = 'configurable'`,
      [variantsPer, `PVR-${stamp}-%`],
    );
    for (const [i, code] of CURRENCIES.entries()) {
      const base = await ensureBaseBookSql(h.em(), code);
      // Every product priced except one in seven; one in five at zero.
      await sql(
        `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
         select gen_random_uuid(), ?, p, 1, 'fixed',
                case when n % 5 = ? then 0 else (10 + random() * 990)::numeric(14,4) end, now(), now()
           from unnest(?::uuid[]) with ordinality as t(p, n) where n % 7 <> ?`,
        [base, i, `{${productIds.join(',')}}`, i],
      );
    }
  }, 60 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console -- a benchmark reports what it measured.
    console.log('[pvr-bench]', JSON.stringify({ productCount, variantsPer, ...results }));
    await clearConfiguration(h);
    await clearFlags(h);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  it('builds each currency inside the rebuild bound (≤ 150 s)', async () => {
    await flagsOf(h).requestRebuild([...CURRENCIES]);
    for (const code of CURRENCIES) {
      const started = Date.now();
      expect(await flagsOf(h).rebuildCurrency(code)).toBe(true);
      results[`rebuild_${code}_ms`] = Date.now() - started;
      expect(results[`rebuild_${code}_ms`]).toBeLessThan(150_000);
    }
  }, 30 * 60_000);

  it('reflects a targeted price change inside the targeted bound (≤ 60 s)', async () => {
    const target = productIds[1]!;
    const write = (h.container as unknown as { resolve<T>(n: string): T }).resolve<PriceBookWritePort>('priceBookWritePort');
    const started = Date.now();
    await withSystemScope('pvr bench: targeted price change', () =>
      write.replaceBasePrices(target, { byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '0' }], variants: {} } } }),
    );
    await waitForMark(h, target);
    await settleFlags(h);
    results['targeted_ms'] = Date.now() - started;
    const [row] = await sql<{ has_positive: boolean }>(
      `select p."has_positive" from "product_catalogue_prices" p join "catalogue_price_generations" g
          on g."currency_code" = p."currency_code" and g."served_generation" = p."generation"
        where p."currency_code" = 'PLN' and p."product_id" = ?`,
      [target],
    );
    expect(row?.has_positive).toBe(false);
    expect(results['targeted_ms']).toBeLessThan(60_000);
  }, 10 * 60_000);

  it('the predicate costs the restricted list little (R-16)', async () => {
    const restricted: AdminProductVisibilityScope = {
      kind: 'restricted',
      roleId: 'bench',
      category: { id: 'bench', name: 'bench' },
      conditions: [],
    };
    const gens = await sql<{ currency_code: string; served_generation: number }>(`select "currency_code", "served_generation" from "catalogue_price_generations"`);
    const scope: AdminProductVisibilityScope = {
      ...restricted,
      conditions: gens
        .filter((g) => ['PLN', 'EUR'].includes(g.currency_code.trim()))
        .map((g) => ({ currencyCode: g.currency_code.trim(), threshold: g.currency_code.trim() === 'PLN' ? ('gt_zero' as const) : ('gte_zero' as const), generation: g.served_generation })),
    } as AdminProductVisibilityScope;
    const predicate = scopePort(h).productPredicate(scope, { productId: '"p"."id"' });
    if (predicate.kind !== 'sql') throw new Error('expected a sql predicate');
    const time = async (statement: string, params: unknown[]) => {
      const samples: number[] = [];
      for (let i = 0; i < iterations; i += 1) {
        const started = performance.now();
        await sql(statement, params);
        samples.push(performance.now() - started);
      }
      return p95(samples);
    };
    const where = `p."deleted_at" is null`;
    results['count_unrestricted_p95_ms'] = await time(`select count(*) from "products" p where ${where}`, []);
    results['count_restricted_p95_ms'] = await time(`select count(*) from "products" p where ${where} and (${predicate.fragment.sql})`, predicate.fragment.params);
    results['page_unrestricted_p95_ms'] = await time(`select p."id" from "products" p where ${where} order by p."id" limit 50 offset 20000`, []);
    results['page_restricted_p95_ms'] = await time(
      `select p."id" from "products" p where ${where} and (${predicate.fragment.sql}) order by p."id" limit 50 offset 20000`,
      predicate.fragment.params,
    );
    for (const kind of ['count', 'page']) {
      const r = results[`${kind}_restricted_p95_ms`]!;
      const u = results[`${kind}_unrestricted_p95_ms`]!;
      expect(r, kind).toBeLessThanOrEqual(Math.max(u + 50, 0));
      expect(r, kind).toBeLessThanOrEqual(300);
    }
  }, 10 * 60_000);

  it('SC-008 — during a designation rebuild nothing qualifies only through the rebuilding currency', async () => {
    const book = await ensureBaseBookSql(h.em(), 'USD');
    const [channel] = await sql<{ id: string }>(`select "id" from "sales_channels" limit 1`);
    // A designation the served USD flags were not built for: until the swap, USD meets nothing.
    await sql(
      `insert into "catalogue_price_designations" ("currency_code", "price_list_id", "sales_channel_id", "updated_at") values ('USD', ?, ?, now())`,
      [book, channel!.id],
    );
    const category = await sql<{ id: string }>(
      `insert into "visibility_categories" ("id", "name", "version", "created_at", "updated_at") values (gen_random_uuid(), 'USD only', 1, now(), now()) returning "id"`,
    );
    await sql(
      `insert into "visibility_category_conditions" ("id", "visibility_category_id", "currency_code", "threshold") values (gen_random_uuid(), ?, 'USD', 'gte_zero')`,
      [category[0]!.id],
    );
    const role = await roleWith(h, ['rfqs:handle']);
    await sql(`insert into "visibility_role_mappings" ("admin_role_id", "target", "visibility_category_id", "updated_at") values (?, 'category', ?, now())`, [
      role.roleId,
      category[0]!.id,
    ]);
    const scope = await scopePort(h).resolveScope(role.adminUserId);
    expect(scopePort(h).productPredicate(scope, { productId: '"p"."id"' })).toEqual({ kind: 'deny' });
  });
});
