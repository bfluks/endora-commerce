import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGUE_PRICES_CHANGED_EVENT } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { ADMIN, BASE, clearConfiguration, clearFlags, flagsOf, settleFlags } from './fixtures.js';

/**
 * `product_visibility_rules` off-state — the flags and the admin scope (spec 193 T031, analyze M3;
 * FR-073). While the module is off, on either axis:
 *
 *  * the change-feed subscriber does not run (`ctx.subscribe`): an announcement marks nothing;
 *  * `adminProductVisibilityPort` refuses with `MODULE_DISABLED` (`providePort`), which consumers
 *    declaring `degrades-without` read as "not narrowed" by probing presence first;
 *  * the flags worker, its drift poll and nightly reconcile are attached with `ctx.worker`, so a job
 *    waits — the platform's worker gate, held by its own tests; the shared harness runs no worker;
 *  * the flag tables are kept; once back, the next tick builds what is missing.
 */
describe('product_visibility_rules off-state — flags and scope (spec 193, T031)', () => {
  let h: BackendServerHandle;
  const sql = <T>(s: string) => h.em().getConnection().execute<T[]>(s);
  const count = async (table: string) => (await sql<{ n: number }>(`select count(*)::int as n from "${table}"`))[0]!.n;
  const resolvePort = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ systemScope(): unknown }>('adminProductVisibilityPort');

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearConfiguration(h);
    await clearFlags(h);
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearFlags(h);
    await teardownBackendServer(h);
  });

  it('is absent on both axes and restored after', async () => {
    await expectModuleAbsent(h, 'product_visibility_rules', {
      routes: [{ url: `${BASE}/overview`, cookies: ADMIN }],
      adminPresence: { cookies: ADMIN },
    });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: no marks, the port refuses, the tables are kept', async (axis) => {
    const rows = await count('product_catalogue_prices');
    expect(rows).toBeGreaterThan(0);
    await withModuleOff('product_visibility_rules', axis, async () => {
      h.eventBus.emit(CATALOGUE_PRICES_CHANGED_EVENT as never, { eventId: 'x', occurredAt: new Date().toISOString(), change: { kind: 'all' } } as never);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect((await sql<{ whole_stale: boolean }>(`select "whole_stale" from "catalogue_price_generations"`)).every((r) => !r.whole_stale)).toBe(true);
      expect(() => resolvePort().systemScope()).toThrow(/disabled|MODULE_DISABLED/i);
      expect(await count('product_catalogue_prices')).toBe(rows);
    });
    expect(resolvePort().systemScope()).toEqual({ kind: 'system' });
    expect(await count('product_catalogue_prices')).toBe(rows);
  });
});
