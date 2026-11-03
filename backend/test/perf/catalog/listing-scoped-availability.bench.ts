// perf-weight: fast — not yet measured on the CI runner; written for the fork's ci-pg run.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 163, Phase 8 (T065, SC-004) — what product data scopes cost the
 * storefront listing.
 *
 * One corpus on `pl_retail`, measured twice through the HTTP listing:
 *
 *  1. **unscoped** — no scope row, no override: every product inherits, which
 *     is every instance the day this feature deploys (R21);
 *  2. **scoped** — 20 % of the products carry a channel row (status, window
 *     override, audience override), half of those a channel × language row,
 *     and a channel Name override — the shape `availabilityCondition` and
 *     `effectiveTextSql` were written for.
 *
 * Scenarios: the default ordering and `sort=name` (the effective-name keyset,
 * D6), first page and the page after it. Each request is repeated
 * `PERF_REPEATS` times; the median is compared. **The gate:** the scoped median
 * may exceed the unscoped one by at most `PERF_MAX_REGRESSION` (default 0.10)
 * for each scenario — beyond that the block stops and goes back to the
 * architect (R1 fallback).
 *
 * The before/after of the code itself is the other half of T065:
 * `listing-filtered-page.bench.ts` and `catalog-list.bench.ts` run on
 * `origin/master` and on this branch, same runner, same corpus size, numbers
 * recorded in the PR.
 *
 * Run: `cd backend && PERF_RUN=true pnpm exec vitest run test/perf/catalog/listing-scoped-availability.bench.ts`
 * (needs Postgres; read `specs/conventions/backend-test-suite.md` § serial project first).
 */

const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '20000');
const repeats = Number(process.env['PERF_REPEATS'] ?? '7');
const maxRegression = Number(process.env['PERF_MAX_REGRESSION'] ?? '0.10');
const shouldRun = process.env['PERF_RUN'] === 'true';

const PAGE_LIMIT = 24;
const SKU_PREFIX = 'S163P-';

interface Scenario {
  name: string;
  query: string;
  secondPage: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'default ordering, first page', query: '', secondPage: false },
  { name: 'default ordering, second page', query: '', secondPage: true },
  { name: 'sort=name, first page', query: 'sort=name', secondPage: false },
  { name: 'sort=name, second page', query: 'sort=name', secondPage: true },
  { name: 'free text, first page', query: `q=${encodeURIComponent('Perf scoped 1')}`, secondPage: false },
];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

describe.skipIf(!shouldRun)('catalog list — the cost of product data scopes (163 T065)', () => {
  let h: BackendServerHandle;
  let retailId = '';
  let defaultLanguage = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const conn = em.getConnection();
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    retailId = retail.id;
    defaultLanguage = retail.defaultLanguage;
    await conn.execute(
      `insert into products
         (id, sku, slug, type, status, name, description, visibility,
          attribute_values, allowed_organization_ids, created_at, updated_at)
       select gen_random_uuid(),
              ? || lpad(g::text, 7, '0'),
              lower(?) || lpad(g::text, 7, '0'),
              'simple', 'active',
              jsonb_build_object('en-US', 'Perf scoped ' || g),
              jsonb_build_object('en-US', 'Synthetic product for the scoped listing bench.'),
              'public', '{}'::jsonb, '[]'::jsonb,
              timestamptz '2031-01-01 00:00:00+00' - make_interval(secs => g),
              now()
         from generate_series(0, ? - 1) as g`,
      [SKU_PREFIX, SKU_PREFIX, corpusSize],
    );
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       select ?::uuid, id from products where sku like ?`,
      [retailId, `${SKU_PREFIX}%`],
    );
    await conn.execute('analyze products');
    await conn.execute('analyze sales_channel_products');
  }, 10 * 60_000);

  afterAll(async () => {
    if (h) await teardownBackendServer(h);
  });

  async function measure(scenario: Scenario): Promise<number> {
    const base = `/api/v1/catalog/products?limit=${PAGE_LIMIT}${scenario.query ? `&${scenario.query}` : ''}`;
    let url = base;
    if (scenario.secondPage) {
      const first = await h.app.inject({ method: 'GET', url: base, headers: { 'x-sales-channel': 'pl_retail' } });
      const cursor = (first.json() as { pagination: { cursor: string | null } }).pagination.cursor;
      if (cursor) url = `${base}&cursor=${encodeURIComponent(cursor)}`;
    }
    const times: number[] = [];
    for (let i = 0; i < repeats; i++) {
      const start = performance.now();
      const res = await h.app.inject({ method: 'GET', url, headers: { 'x-sales-channel': 'pl_retail' } });
      times.push(performance.now() - start);
      expect(res.statusCode, url).toBe(200);
    }
    return median(times);
  }

  async function scope(): Promise<void> {
    const conn = h.em().getConnection();
    const ordinal = `substring(p.sku from ${SKU_PREFIX.length + 1})::int`;
    // 20 % carry a channel row: a status, an overridden window (open now) and an audience override.
    await conn.execute(
      `insert into product_channel_scopes
         (product_id, sales_channel_id, status, window_overridden, publish_from, publish_until,
          visibility, allowed_organization_ids, created_at, updated_at)
       select p.id, ?::uuid,
              case when ${ordinal} % 10 = 0 then 'inactive' else 'active' end,
              true, now() - interval '1 day', now() + interval '30 days',
              'public', '[]'::jsonb, now(), now()
         from products p where p.sku like ? and ${ordinal} % 5 = 0`,
      [retailId, `${SKU_PREFIX}%`],
    );
    // Half of those a channel × language row in the default language.
    await conn.execute(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status, created_at, updated_at)
       select p.id, ?::uuid, ?, 'active', now(), now()
         from products p where p.sku like ? and ${ordinal} % 10 = 5`,
      [retailId, defaultLanguage, `${SKU_PREFIX}%`],
    );
    // And a channel Name override, so the effective-name walk has rows to read.
    await conn.execute(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       select gen_random_uuid(), p.id, 'name', ?::uuid, null, jsonb_build_object('v', 'Scoped name ' || ${ordinal}), now(), now()
         from products p where p.sku like ? and ${ordinal} % 5 = 0`,
      [retailId, `${SKU_PREFIX}%`],
    );
    await conn.execute('analyze product_channel_scopes');
    await conn.execute('analyze product_channel_language_scopes');
    await conn.execute('analyze product_value_overrides');
  }

  it(`stays within ${Math.round(maxRegression * 100)} % of the unscoped listing`, async () => {
    const unscoped = new Map<string, number>();
    for (const scenario of SCENARIOS) unscoped.set(scenario.name, await measure(scenario));
    await scope();
    const rows: string[] = [];
    const over: string[] = [];
    for (const scenario of SCENARIOS) {
      const scoped = await measure(scenario);
      const before = unscoped.get(scenario.name)!;
      const ratio = scoped / before;
      rows.push(`${scenario.name}: unscoped ${before.toFixed(1)} ms, scoped ${scoped.toFixed(1)} ms, ×${ratio.toFixed(3)}`);
      if (ratio > 1 + maxRegression) over.push(scenario.name);
    }
    // eslint-disable-next-line no-console -- the bench's report is its output
    console.log(`[listing-scoped-availability] corpus=${corpusSize} repeats=${repeats}\n${rows.join('\n')}`);
    expect(over, `scenarios over the ${maxRegression * 100} % budget`).toEqual([]);
  }, 10 * 60_000);
});
