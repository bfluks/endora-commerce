import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { call, clearConfiguration, forgetTestRoles, overview, roleWith } from './fixtures.js';

/**
 * Spec 193 Phase 3 (T018) — every configuration write is one Command and one audit entry
 * naming the actor, with before and after (FR-070, `specs/conventions/audit-state.md`; the rows
 * are platform-global configuration, so values may be recorded). A holder of
 * `product_visibility:read` sees the configuration and cannot change it (US2-4).
 */
describe('product visibility configuration — audit and permissions (spec 193, FR-070, US2-4)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await clearConfiguration(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearConfiguration(h);
    await f.clearBooks();
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  async function entries(objectId: string) {
    return h
      .em()
      .getConnection()
      .execute<
        Array<{ action: string; object_type: string; actor_admin_user_id: string | null; state_before: unknown; state_after: unknown }>
      >(
        `select "action", "object_type", "actor_admin_user_id", "state_before", "state_after"
           from "audit_log_entries" where "object_id" = ? and "action" like 'product_visibility.%' order by "acted_at", "id"`,
        [objectId],
      );
  }

  it('records one entry per category write, with the actor, before and after', async () => {
    const created = await call(h, 'POST', '/categories', {
      payload: { name: 'Audited', conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] },
    });
    const id = created.body.data.id as string;
    await call(h, 'PATCH', `/categories/${id}`, { payload: { name: 'Audited 2' } });
    // A write that changes nothing records nothing.
    await call(h, 'PATCH', `/categories/${id}`, { payload: { name: 'Audited 2' } });
    await call(h, 'DELETE', `/categories/${id}`);

    const rows = await entries(id);
    expect(rows.map((r) => r.action)).toEqual([
      'product_visibility.category.create',
      'product_visibility.category.update',
      'product_visibility.category.delete',
    ]);
    for (const row of rows) {
      expect(row.object_type).toBe('visibility_category');
      expect(row.actor_admin_user_id).toBe(TEST_ADMIN_ID);
    }
    expect(rows[0]!.state_before).toBeNull();
    expect(rows[0]!.state_after).toMatchObject({ name: 'Audited', conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] });
    expect(rows[1]!.state_before).toMatchObject({ name: 'Audited' });
    expect(rows[1]!.state_after).toMatchObject({ name: 'Audited 2', changedFields: ['name'] });
    expect(rows[2]!.state_before).toMatchObject({ name: 'Audited 2' });
    expect(rows[2]!.state_after).toBeNull();
  });

  it('records a role mapping change and a designation set and clear', async () => {
    const created = await call(h, 'POST', '/categories', {
      payload: { name: 'Mapping audit', conditions: [{ currencyCode: 'EUR', threshold: 'gte_zero' }] },
    });
    const role = await roleWith(h, ['rfqs:handle']);
    await call(h, 'PUT', `/role-mappings/${role.roleId}`, {
      payload: { target: { kind: 'category', categoryId: created.body.data.id } },
    });
    await call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target: null } });
    const mapping = await entries(role.roleId);
    expect(mapping.map((r) => r.action)).toEqual(['product_visibility.role_mapping.set', 'product_visibility.role_mapping.set']);
    expect(mapping[0]).toMatchObject({
      object_type: 'admin_role',
      actor_admin_user_id: TEST_ADMIN_ID,
      state_before: { target: null },
      state_after: { target: { kind: 'category', categoryId: created.body.data.id } },
    });
    expect(mapping[1]!.state_after).toEqual({ target: null });

    const book = await f.book({ audience: 'everyone' });
    await call(h, 'PUT', '/designations/PLN', { payload: { priceListId: book.id, salesChannelId: f.channels.CH1.id } });
    await call(h, 'DELETE', '/designations/PLN');
    const designation = await entries('PLN');
    expect(designation.map((r) => r.action)).toEqual(['product_visibility.designation.set', 'product_visibility.designation.clear']);
    expect(designation[0]).toMatchObject({
      object_type: 'catalogue_price_designation',
      actor_admin_user_id: TEST_ADMIN_ID,
      state_before: null,
      state_after: { priceListId: book.id, salesChannelId: f.channels.CH1.id },
    });
    expect(designation[1]).toMatchObject({ state_before: { priceListId: book.id }, state_after: null });
  });

  it('a holder of read sees the configuration and is refused every write (US2-4)', async () => {
    const reader = await roleWith(h, ['product_visibility:read']);
    const view = await overview(h, reader.cookies);
    expect(view.roles.some((r) => r.roleId === reader.roleId)).toBe(true);
    expect((await call(h, 'GET', '/designations/PLN/options', { cookies: reader.cookies })).status).toBe(200);
    const writes: Array<[method: 'POST' | 'PUT' | 'DELETE', path: string, payload?: unknown]> = [
      ['POST', '/categories', { name: 'Nope', conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] }],
      ['PUT', `/role-mappings/${reader.roleId}`, { target: null }],
      ['PUT', '/designations/PLN', { priceListId: reader.roleId, salesChannelId: reader.roleId }],
      ['DELETE', '/designations/PLN'],
    ];
    for (const [method, path, payload] of writes) {
      const res = await call(h, method, path, { cookies: reader.cookies, ...(payload ? { payload } : {}) });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    const nobody = await roleWith(h, ['catalog:read']);
    expect((await call(h, 'GET', '/overview', { cookies: nobody.cookies })).status).toBe(403);
  });
});
