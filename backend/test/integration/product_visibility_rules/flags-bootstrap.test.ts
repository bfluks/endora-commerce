import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { clearConfiguration, clearFlags, call, flagsOf, roleWith, forgetTestRoles, scopePort, settleFlags } from './fixtures.js';
import { runFlagsJob, FLAGS_DRIFT_POLL_JOB } from '../../../../packages/modules/product_visibility_rules/src/backend/workers/catalogue-price-flags-worker.js';

/**
 * Spec 193 Phase 4 (T031) — first enable / re-enable. Every active currency gets its flag generation
 * from the bootstrap (the boot hook, and the drift poll's tick within two minutes of a re-enable);
 * until a currency's first build swaps in, its conditions are not met (fail-closed).
 */
describe('catalogue-price flags — bootstrap (spec 193, T031)', () => {
  let h: BackendServerHandle;
  const log = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearConfiguration(h);
    await clearFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearConfiguration(h);
    await clearFlags(h);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  it('a currency with no flags yet meets no condition; the tick builds every active currency', async () => {
    const category = (await call(h, 'POST', '/categories', { payload: { name: 'Boot', conditions: [{ currencyCode: 'PLN', threshold: 'gte_zero' }] } }))
      .body.data.id as string;
    const role = await roleWith(h, ['rfqs:handle']);
    await call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target: { kind: 'category', categoryId: category } } });

    const before = await scopePort(h).resolveScope(role.adminUserId);
    expect(before.kind === 'restricted' && before.conditions).toEqual([]);

    await runFlagsJob(FLAGS_DRIFT_POLL_JOB, flagsOf(h), log);
    const active = (
      await h.em().getConnection().execute<Array<{ code: string }>>(`select "code" from "currencies" where "is_active" order by "code"`)
    ).map((r) => r.code.trim());
    expect(active).toContain('PLN');
    expect(await flagsOf(h).trackedCurrencies()).toEqual(active);
    expect(await flagsOf(h).hasPendingWork()).toBe(true);
    await settleFlags(h);

    const after = await scopePort(h).resolveScope(role.adminUserId);
    expect(after.kind === 'restricted' && after.conditions.map((c) => c.currencyCode)).toEqual(['PLN']);
    // Already tracked: a second tick adds nothing.
    expect(await flagsOf(h).ensureActiveCurrencies()).toEqual([]);
  });
});
