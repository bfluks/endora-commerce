import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { ADMIN, BASE, call, clearConfiguration, forgetTestRoles, overview, roleWith } from './fixtures.js';

/**
 * `product_visibility_rules` off-state, configuration surface — Constitution XVII item 6,
 * `module-activation.md` (spec 193 T024; FR-073, FR-076, FR-077; threat model TM-4 d, TM-13).
 *
 *  * **API rejection** — every configuration route answers `MODULE_DISABLED` while off, on both
 *    axes, including the deactivated-while-platform-available case (FR-077: nothing can be
 *    prepared before the first enable);
 *  * **admin absence** — the presence projection, and the harness's permission-catalogue sweep
 *    (the two codes leave `/admin-roles` while off);
 *  * **non-editable configuration** — the module owns no ordinary setting: its activation
 *    control is its one setting and the exception, so there is no `settingWrite` to probe; its
 *    configuration is reachable only through the routes above;
 *  * **storefront** — the module has no storefront surface in this phase;
 *  * **restoration** — categories, mappings and designations written before the flip are there,
 *    unchanged, after it (off is non-destructive);
 *  * **TM-4 d / TM-13** — switching the module off and on each leaves an audit entry naming the
 *    administrator, in the platform's lifecycle ledger.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000193';

describe('product_visibility_rules off-state — configuration (spec 193, T024)', () => {
  let h: BackendServerHandle;
  let categoryId: string;
  let roleId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearConfiguration(h);
    const created = await call(h, 'POST', '/categories', {
      payload: { name: 'Kept while off', conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    categoryId = created.body.data.id;
    const role = await roleWith(h, ['rfqs:handle']);
    roleId = role.roleId;
    const mapped = await call(h, 'PUT', `/role-mappings/${roleId}`, { payload: { target: { kind: 'category', categoryId } } });
    expect(mapped.status).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearConfiguration(h);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after (FR-073, FR-077)', async () => {
    const before = await overview(h);
    await expectModuleAbsent(h, 'product_visibility_rules', {
      // Every write probe is one the module refuses or ignores while on (an empty category, an
      // unknown id, a book that does not exist, a currency with no designation), so the
      // harness's before / restored passes change nothing.
      routes: [
        { url: `${BASE}/overview`, cookies: ADMIN },
        { method: 'POST', url: `${BASE}/categories`, cookies: ADMIN, payload: { name: 'Prepared while off', conditions: [] } },
        { method: 'PATCH', url: `${BASE}/categories/${UNKNOWN}`, cookies: ADMIN, payload: { name: 'Renamed while off' } },
        { method: 'DELETE', url: `${BASE}/categories/${UNKNOWN}`, cookies: ADMIN },
        { method: 'PUT', url: `${BASE}/role-mappings/${UNKNOWN}`, cookies: ADMIN, payload: { target: null } },
        { method: 'PUT', url: `${BASE}/designations/PLN`, cookies: ADMIN, payload: { priceListId: UNKNOWN, salesChannelId: UNKNOWN } },
        { method: 'DELETE', url: `${BASE}/designations/EUR`, cookies: ADMIN },
        { url: `${BASE}/designations/PLN/options`, cookies: ADMIN },
      ],
      adminPresence: { cookies: ADMIN },
    });
    // Nothing the off state refused was written, and what was there is unchanged.
    expect(await overview(h)).toEqual(before);
  });

  it('keeps the configuration while off and serves it again after (FR-076: off changes nothing it holds)', async () => {
    const rows = async () => {
      const sql = (s: string) => h.em().getConnection().execute<Array<{ n: number }>>(s);
      return {
        categories: (await sql(`select count(*)::int as n from "visibility_categories"`))[0]!.n,
        mappings: (await sql(`select count(*)::int as n from "visibility_role_mappings"`))[0]!.n,
      };
    };
    const before = await rows();
    expect(before).toEqual({ categories: 1, mappings: 1 });
    await withModuleOff('product_visibility_rules', 'deactivated', async () => {
      expect(await rows()).toEqual(before);
      expect((await call(h, 'GET', '/overview')).body.error.code).toBe('MODULE_DISABLED');
    });
    expect(await rows()).toEqual(before);
    const view = await overview(h);
    expect(view.categories.map((c) => c.id)).toEqual([categoryId]);
    expect(view.roles.find((r) => r.roleId === roleId)).toMatchObject({ effect: 'mapped', categoryId });
  });

  it('switching the module off and on is audited with the administrator (TM-4 d, TM-13)', async () => {
    const activation = (active: boolean) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/modules/product_visibility_rules/activation',
        cookies: ADMIN,
        payload: { active },
      });
    const off = await activation(false);
    expect(off.statusCode, off.body).toBe(200);
    try {
      expect((await call(h, 'GET', '/overview')).status).toBe(503);
    } finally {
      const on = await activation(true);
      expect(on.statusCode, on.body).toBe(200);
    }
    expect((await call(h, 'GET', '/overview')).status).toBe(200);
    const entries = await h
      .em()
      .getConnection()
      .execute<Array<{ action: string; actor_admin_user_id: string | null; state_after: { active?: boolean } | null }>>(
        `select "action", "actor_admin_user_id", "state_after" from "audit_log_entries"
          where "object_id" = 'product_visibility_rules' order by "acted_at" desc, "id" desc limit 2`,
      );
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry.actor_admin_user_id).toBe(TEST_ADMIN_ID);
    expect(entries.map((e) => e.action)).toEqual([expect.stringMatching(/^module\./), expect.stringMatching(/^module\./)]);
  });
});
