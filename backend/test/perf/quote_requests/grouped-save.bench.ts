// perf-weight: fast — about 15 s locally (2026-10-20, one composition, 20 saves of a 200-line, 20-group quote); not yet timed on the CI runner.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/159-quote-request-item-groups/` SC-005 (T029) — saving a 200-line
 * quote arranged in 20 groups (*Save revision*: the line rewrite, the grouping
 * write, the revision, the event and the reply) must take under 1 s at the
 * 95th percentile. Through the real HTTP route, so the number is the
 * operator's, not a service call's.
 *
 * Tuning knobs (env):
 *   PERF_RUN                       — set to 'true' to run; otherwise skipped.
 *   PERF_ITERATIONS                — saves measured (default 20)
 *   PERF_GROUPED_SAVE_P95_MS       — p95 budget (default 1000)
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
const p95Budget = Number(process.env['PERF_GROUPED_SAVE_P95_MS'] ?? '1000');
const ADMIN = { b2b_session: 'stub-admin-session' };
const PRODUCTS = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID];

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

describe.skipIf(!shouldRun)('quote request — a grouped save (SC-005)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a 200-line, 20-group save: < 1 s p95', async () => {
    const groups = Array.from({ length: 20 }, (_, g) => ({ key: `g${g}`, name: `Group ${g + 1}` }));
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        groups,
        items: Array.from({ length: 200 }, (_, i) => ({
          productId: PRODUCTS[i % PRODUCTS.length]!,
          quantity: 1 + (i % 7),
          agreedUnitPrice: 10 + (i % 13),
          groupKey: `g${Math.floor(i / 10)}`,
        })),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    let quote = (created.json() as {
      data: { id: string; version: number; itemGroups: { id: string }[]; items: { id: string; productId: string }[] };
    }).data;

    const samples: number[] = [];
    for (let run = 0; run <= iterations; run += 1) {
      // Every save renames the groups, reverses their order and moves every
      // line one group on — the whole grouping rewritten each time.
      const ids = quote.itemGroups.map((group) => group.id).reverse();
      const payload = {
        groups: ids.map((id, g) => ({ key: `k${g}`, id, name: `Group ${g + 1} r${run}` })),
        items: quote.items.map((item, i) => ({
          id: item.id,
          productId: item.productId,
          quantity: 1 + (i % 7),
          agreedUnitPrice: 10 + (i % 13),
          groupKey: `k${(Math.floor(i / 10) + 1) % ids.length}`,
        })),
      };
      const started = performance.now();
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${quote.id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${quote.version}"` },
        payload,
      });
      const elapsed = performance.now() - started;
      expect(res.statusCode, res.body).toBe(200);
      quote = (res.json() as { data: typeof quote }).data;
      // The first save warms the process and is not counted.
      if (run > 0) samples.push(elapsed);
    }
    expect(quote.itemGroups).toHaveLength(20);
    expect(quote.items).toHaveLength(200);
    console.log(`[perf] grouped save, 200 lines × 20 groups: p95 ${p95(samples).toFixed(0)} ms`);
    expect(p95(samples)).toBeLessThan(p95Budget);
  }, 600_000);
});
