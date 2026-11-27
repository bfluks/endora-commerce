import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { migrations } from '@endora-commerce/mod-product-visibility-rules/migrations';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import {
  call,
  clearConfiguration,
  forgetTestRoles,
  overview,
  roleWith,
  setRolePermissions,
  type TestRole,
} from './fixtures.js';

/**
 * Spec 193 Phase 3 (T017) — the configuration backend (US2; FR-010 – FR-014, FR-020 – FR-026,
 * FR-060, FR-086; RQ-1 A, I-2, OQ-G 1): categories, role mappings and catalogue-price
 * designations through `/api/v1/admin/product-visibility`, as the platform administrator.
 * TM-4 c (a write refused to a caller who is not unrestricted) is unreachable end to end —
 * every holder of `product_visibility:manage` is unrestricted (FR-026) — and is held by the
 * routes' unit test with a stubbed scope.
 */
describe('product visibility configuration (spec 193, US2)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const PLN = [{ currencyCode: 'PLN', threshold: 'gt_zero' }];

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await clearConfiguration(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await clearConfiguration(h);
  });

  afterAll(async () => {
    await f.clearBooks();
    await h.em().getConnection().execute(`delete from "currencies" where "code" = 'USD'`);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  async function category(name: string, conditions: unknown = PLN): Promise<{ id: string; version: number }> {
    const res = await call(h, 'POST', '/categories', { payload: { name, conditions } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.data.id, version: res.body.data.version };
  }

  async function map(role: TestRole, target: unknown) {
    return call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target } });
  }

  const roleRow = async (roleId: string) => (await overview(h)).roles.find((r) => r.roleId === roleId);

  describe('categories (FR-010 – FR-014)', () => {
    it('ships no categories: no migration of the module writes one (FR-014)', async () => {
      for (const M of migrations) {
        const sqls: string[] = [];
        const m = new (M as unknown as new (...a: unknown[]) => { up(): Promise<void>; addSql(s: string): void })({}, {});
        m.addSql = (s: string) => sqls.push(s);
        await m.up();
        expect(sqls.join('\n'), M.name).not.toMatch(/insert\s+into\s+"(visibility_categories|visibility_role_mappings|catalogue_price_designations)"/i);
      }
      expect((await overview(h)).categories).toEqual([]);
    });

    it('creates, renames, replaces conditions and deletes a category; the version moves', async () => {
      const created = await call(h, 'POST', '/categories', { payload: { name: 'Wholesale', conditions: PLN } });
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"1"');
      expect(created.body.data).toMatchObject({ name: 'Wholesale', version: 1, conditions: PLN, mappedRoleIds: [] });
      const id = created.body.data.id as string;

      const renamed = await call(h, 'PATCH', `/categories/${id}`, { payload: { name: 'Wholesale B2B' }, ifMatch: '"1"' });
      expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
      expect(renamed.body.data).toMatchObject({ name: 'Wholesale B2B', version: 2 });

      const stale = await call(h, 'PATCH', `/categories/${id}`, { payload: { name: 'X' }, ifMatch: '"1"' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');

      const conditions = [
        { currencyCode: 'EUR', threshold: 'gte_zero' },
        { currencyCode: 'PLN', threshold: 'gt_zero' },
      ];
      const replaced = await call(h, 'PATCH', `/categories/${id}`, { payload: { conditions } });
      expect(replaced.body.data).toMatchObject({ version: 3, conditions });

      expect((await overview(h)).categories.map((c) => c.name)).toEqual(['Wholesale B2B']);
      expect((await call(h, 'DELETE', `/categories/${id}`)).status).toBe(204);
      expect((await overview(h)).categories).toEqual([]);
      expect((await call(h, 'DELETE', `/categories/${id}`)).status).toBe(404);
    });

    it('a category has at least one condition, and names are unique ignoring case', async () => {
      expect((await call(h, 'POST', '/categories', { payload: { name: 'Empty', conditions: [] } })).status).toBe(400);
      await category('Retail');
      const twin = await call(h, 'POST', '/categories', { payload: { name: 'retail', conditions: PLN } });
      expect(twin.status).toBe(422);
      expect(twin.body.error.details).toEqual([{ path: 'name', issue: expect.any(String) }]);
    });

    it('offers active currencies only; a currency deactivated later stays stored and is shown inactive (FR-012)', async () => {
      const sql = (s: string, p: unknown[] = []) => h.em().getConnection().execute(s, p);
      await sql(
        `insert into "currencies" ("code", "label", "symbol", "is_default", "is_active", "sort_order", "created_at", "updated_at")
         values ('USD', 'US dollar', '$', false, true, 9, now(), now()) on conflict ("code") do update set "is_active" = true`,
      );
      const usd = [{ currencyCode: 'USD', threshold: 'gt_zero' }];
      const { id } = await category('Dollar', usd);
      await sql(`update "currencies" set "is_active" = false where "code" = 'USD'`);

      const view = await overview(h);
      expect(view.categories.find((c) => c.id === id)?.conditions).toEqual(usd);
      expect(view.currencies.find((c) => c.code === 'USD')).toMatchObject({ active: false });
      expect(view.currencies.find((c) => c.code === 'PLN')).toMatchObject({ active: true });

      // A rename keeps the stored condition; adding an inactive currency anew is refused.
      expect((await call(h, 'PATCH', `/categories/${id}`, { payload: { name: 'Dollar 2' } })).status).toBe(200);
      const refused = await call(h, 'POST', '/categories', { payload: { name: 'New dollar', conditions: usd } });
      expect(refused.status).toBe(422);
      expect(refused.body.error.details).toEqual([{ path: 'conditions.0.currencyCode', issue: expect.any(String) }]);
      const kept = await call(h, 'PATCH', `/categories/${id}`, {
        payload: { conditions: [...usd, { currencyCode: 'PLN', threshold: 'gte_zero' }] },
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      const unknown = await call(h, 'POST', '/categories', {
        payload: { name: 'Unknown', conditions: [{ currencyCode: 'XTS', threshold: 'gt_zero' }] },
      });
      expect(unknown.status).toBe(422);
    });

    it('refuses to delete a category a role is mapped to, naming the roles (FR-013)', async () => {
      const { id } = await category('Mapped');
      const a = await roleWith(h, ['rfqs:handle'], 'pvr_a');
      const b = await roleWith(h, ['catalog:read'], 'pvr_b');
      expect((await map(a, { kind: 'category', categoryId: id })).status).toBe(200);
      expect((await map(b, { kind: 'category', categoryId: id })).status).toBe(200);
      const refused = await call(h, 'DELETE', `/categories/${id}`);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('VISIBILITY_CATEGORY_IN_USE');
      expect(refused.body.error.details.map((d: { issue: string }) => d.issue).sort()).toEqual([a.roleId, b.roleId].sort());
      expect((await overview(h)).categories.find((c) => c.id === id)?.mappedRoleIds.sort()).toEqual([a.roleId, b.roleId].sort());

      // A mapping left by a role that no longer exists matches nothing and does not block.
      await map(a, null);
      await h.em().getConnection().execute(`delete from "admin_users" where "id" = ?`, [b.adminUserId]);
      await h.em().getConnection().execute(`delete from "admin_roles" where "id" = ?`, [b.roleId]);
      expect((await call(h, 'DELETE', `/categories/${id}`)).status).toBe(204);
    });
  });

  describe('role mappings (FR-020 – FR-026, I-2, OQ-G 1)', () => {
    it('maps a role to a category, to unrestricted, and back to nothing (FR-020, FR-025)', async () => {
      const { id } = await category('Sales');
      const role = await roleWith(h, ['rfqs:handle']);
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'sees_no_products' });

      const mapped = await map(role, { kind: 'category', categoryId: id });
      expect(mapped.body.data).toEqual({ roleId: role.roleId, target: { kind: 'category', categoryId: id } });
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'mapped', categoryId: id });

      await map(role, { kind: 'unrestricted' });
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'mapped_unrestricted' });

      await map(role, null);
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'sees_no_products' });

      const viewer = await roleWith(h, ['catalog:read']);
      expect(await roleRow(viewer.roleId)).toMatchObject({ effect: 'unrestricted' });
      expect((await map(role, { kind: 'category', categoryId: '00000000-0000-4000-8000-000000000193' })).status).toBe(422);
    });

    it('refuses to map platform_admin (FR-022)', async () => {
      const { id } = await category('Never');
      const [admin] = await h
        .em()
        .getConnection()
        .execute<Array<{ id: string }>>(`select "id" from "admin_roles" where "code" = 'platform_admin'`);
      for (const target of [{ kind: 'category', categoryId: id }, { kind: 'unrestricted' }]) {
        const res = await call(h, 'PUT', `/role-mappings/${admin!.id}`, { payload: { target } });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ROLE_NOT_MAPPABLE');
      }
      expect(await roleRow(admin!.id)).toMatchObject({ effect: 'unmappable_unrestricted' });
    });

    it.each(['*', 'product_visibility:manage', 'platform.modules.activate', 'admin_users:manage'])(
      'refuses to map a role holding %s, to a category and to unrestricted (FR-026)',
      async (permission) => {
        const { id } = await category(`Self ${permission}`);
        const role = await roleWith(h, ['rfqs:handle', permission]);
        for (const target of [{ kind: 'category', categoryId: id }, { kind: 'unrestricted' }]) {
          const res = await map(role, target);
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('ROLE_NOT_MAPPABLE');
        }
        expect(await roleRow(role.roleId)).toMatchObject({ effect: 'unmappable_unrestricted' });
      },
    );

    it('a mapped role that later gains a self-lifting permission is flagged, from the next request (TM-4 b, FR-026, FR-060)', async () => {
      const { id } = await category('Gainer');
      const role = await roleWith(h, ['rfqs:handle']);
      await map(role, { kind: 'category', categoryId: id });
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'mapped' });
      await setRolePermissions(h, role.roleId, ['rfqs:handle', 'admin_users:manage']);
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'mapping_without_effect', categoryId: id });
      // Its stored mapping may still be cleared.
      expect((await map(role, null)).status).toBe(200);
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'unmappable_unrestricted' });
    });

    it('a change applies on the next request, with no sign-in (FR-060)', async () => {
      const a = await category('First');
      const b = await category('Second');
      const role = await roleWith(h, ['rfqs:handle']);
      await map(role, { kind: 'category', categoryId: a.id });
      expect(await roleRow(role.roleId)).toMatchObject({ categoryId: a.id });
      await map(role, { kind: 'category', categoryId: b.id });
      expect(await roleRow(role.roleId)).toMatchObject({ categoryId: b.id });
      await setRolePermissions(h, role.roleId, ['catalog:read']);
      await map(role, null);
      expect(await roleRow(role.roleId)).toMatchObject({ effect: 'unrestricted' });
    });

    it('warns on a mapped or fail-closed role holding audit_log:read, and only there (FR-086)', async () => {
      const { id } = await category('Auditors');
      const mapped = await roleWith(h, ['rfqs:handle', 'audit_log:read']);
      await map(mapped, { kind: 'category', categoryId: id });
      const failClosed = await roleWith(h, ['rfqs:handle', 'audit_log:read']);
      const unrestricted = await roleWith(h, ['catalog:read', 'audit_log:read']);
      const plain = await roleWith(h, ['rfqs:handle']);
      expect((await roleRow(mapped.roleId))?.warnings).toEqual(['audit_logs_read']);
      expect((await roleRow(failClosed.roleId))?.warnings).toEqual(['audit_logs_read']);
      expect((await roleRow(unrestricted.roleId))?.warnings).toEqual([]);
      expect((await roleRow(plain.roleId))?.warnings).toEqual([]);
    });
  });

  describe('catalogue-price designations (FR-001, RQ-1 A, US2-8)', () => {
    const designate = (body: { priceListId: string; salesChannelId: string }, currency = 'PLN') =>
      call(h, 'PUT', `/designations/${currency}`, { payload: body });

    it('accepts a live regular everyone book on its channel, and clears back to the base book', async () => {
      const book = await f.book({ audience: 'everyone' });
      const set = await designate({ priceListId: book.id, salesChannelId: f.channels.CH1.id });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(set.body.data).toMatchObject({
        currencyCode: 'PLN',
        designation: { priceListId: book.id, salesChannelId: f.channels.CH1.id },
        designationStatus: { inForce: true },
      });
      expect((await overview(h)).currencies.find((c) => c.code === 'PLN')).toMatchObject({
        designation: { priceListId: book.id },
        designationStatus: { inForce: true },
      });
      const options = await call(h, 'GET', '/designations/PLN/options');
      expect(options.body.data.items.map((i: { priceListId: string }) => i.priceListId)).toContain(book.id);

      const cleared = await call(h, 'DELETE', '/designations/PLN');
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({ designation: null, designationStatus: null });
      expect((await overview(h)).currencies.find((c) => c.code === 'PLN')).toMatchObject({ designation: null });
    });

    it('refuses a sale, a non-everyone, an unbound, another currency’s and a missing book, naming why', async () => {
      const sale = await f.book({ type: 'sale', audience: 'everyone' });
      const org = await f.book({ audience: { organizations: [f.orgs.Acme] } });
      const unbound = await f.book({ audience: 'everyone', channels: [f.channels.CH2] });
      const euro = await f.book({ audience: 'everyone', currency: 'EUR', channels: [f.channels.CH2] });
      const cases: Array<[string, string, string]> = [
        [sale.id, f.channels.CH1.id, 'not_regular'],
        [org.id, f.channels.CH1.id, 'audience_restricted'],
        [unbound.id, f.channels.CH1.id, 'not_on_channel'],
        [euro.id, f.channels.CH2.id, 'currency_mismatch'],
        ['00000000-0000-4000-8000-000000000193', f.channels.CH1.id, 'not_found'],
      ];
      for (const [priceListId, salesChannelId, reason] of cases) {
        const res = await designate({ priceListId, salesChannelId });
        expect(res.status, reason).toBe(422);
        expect(res.body.error.code, reason).toBe('DESIGNATION_INVALID');
        expect(res.body.error.details, reason).toEqual([{ path: 'priceListId', issue: reason }]);
      }
      expect((await overview(h)).currencies.find((c) => c.code === 'PLN')?.designation).toBeNull();
    });

    it('accepts a draft or scheduled book and reports it not in force', async () => {
      const draft = await f.book({ audience: 'everyone', activate: false });
      const res = await designate({ priceListId: draft.id, salesChannelId: f.channels.CH1.id });
      expect(res.status).toBe(200);
      expect(res.body.data.designationStatus).toMatchObject({ inForce: false, reason: 'not_active' });

      const scheduled = await f.book({ audience: 'everyone', startsAt: new Date(Date.now() + 86_400_000) });
      const later = await designate({ priceListId: scheduled.id, salesChannelId: f.channels.CH1.id });
      expect(later.status).toBe(200);
      expect((await overview(h)).currencies.find((c) => c.code === 'PLN')?.designationStatus).toMatchObject({
        inForce: false,
        reason: 'outside_schedule',
      });
    });
  });
});
