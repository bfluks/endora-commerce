import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { clearConfiguration, clearFlags, flagsOf, settleFlags, waitForMark } from './fixtures.js';
import { runFlagsJob, FLAGS_DRIFT_POLL_JOB } from '../../../../packages/modules/product_visibility_rules/src/backend/workers/catalogue-price-flags-worker.js';

/**
 * Spec 193 Phase 4 (T030) — the drift poll (threat model TM-7 (5)). Every announcement the
 * subscriber handles accounts for `price_lists`' change watermark; a watermark that moved with no
 * announcement handled means one was lost, and the poll (every two minutes) asks for a whole
 * rebuild, after which the flags are right again.
 */
describe('catalogue-price flags — the drift poll (spec 193, T030)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(s: string, p: unknown[] = []) => h.em().getConnection().execute<T[]>(s, p);
  const positive = async (productId: string) =>
    (
      await sql<{ has_positive: boolean }>(
        `select p."has_positive" from "product_catalogue_prices" p join "catalogue_price_generations" g
            on g."currency_code" = p."currency_code" and g."served_generation" = p."generation"
          where p."currency_code" = 'PLN' and p."product_id" = ?`,
        [productId],
      )
    )[0]?.has_positive ?? null;
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await clearConfiguration(h);
    await clearFlags(h);
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);
    await flagsOf(h).accountWatermark();
  }, 5 * 60_000);

  afterAll(async () => {
    await clearFlags(h);
    await f.resetBase();
    await teardownBackendServer(h);
  });

  it('a handled announcement leaves nothing for the poll', async () => {
    await f.setBase(f.products.P3, { product: [{ minQuantity: 1, maxQuantity: null, amount: '31' }], variants: {} });
    await waitForMark(h, f.products.P3.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await flagsOf(h).driftPoll()).toBe(false);
    await settleFlags(h);
  });

  it('a lost announcement is corrected by the next poll and one pass', async () => {
    expect(await positive(f.products.P1.id)).toBe(true);
    // The change commits and moves the watermark; its announcement never reaches this module.
    await sql(`update "price_list_matrix_entries" set "amount" = 0
                where "product_id" = ? and "price_list_id" in (select "id" from "price_lists" where "is_system" and "currency_code" = 'PLN')`, [
      f.products.P1.id,
    ]);
    await sql(`select nextval('price_lists_catalogue_change_seq')`);
    expect(await positive(f.products.P1.id)).toBe(true);

    const started = Date.now();
    await runFlagsJob(FLAGS_DRIFT_POLL_JOB, flagsOf(h), log);
    await settleFlags(h);
    expect(Date.now() - started).toBeLessThan(150_000);
    expect(await positive(f.products.P1.id)).toBe(false);
    // Accounted for: the next poll asks nothing.
    expect(await flagsOf(h).driftPoll()).toBe(false);
  });
});
