import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminSearchConfigurationViewSchema, type AdminSearchConfigurationView } from '@endora-commerce/contracts';
import { AuditLogEntry, Setting } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import {
  GS_COOKIES,
  GS_NO_CONFIGURE_ID,
  GS_RESTRICTED_ID,
  ensureAdminWithRole,
  runToken,
  searchIds,
  seedCustomer,
  seedOrder,
  seedOrganization,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T064 — the configuration API
 * (`contracts/admin-search-api.md` §3–§5): the `admin_search:configure` gate
 * ahead of body validation, the allow-list refusals, the version conflict, the
 * audit row, a save reaching another admin's very next search (SC-004), the
 * generic Settings API held to the same rules, and a switched-off record type's
 * entry kept and applied again when its module returns (FR-027).
 */
describe('admin global search — configuration API (spec 150)', () => {
  let h: BackendServerHandle;
  const URL = '/api/v1/admin/global-search/configuration?language=en';
  const T = runToken();
  let orderId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    await ensureAdminWithRole(h, GS_NO_CONFIGURE_ID, 'global_search_no_configure', ['orders:read', 'settings:read']);
    await ensureAdminWithRole(h, GS_RESTRICTED_ID, 'global_search_orders_reader', ['orders:read']);
    await withSystemScope('test seed: global search configuration', async () => {
      const em = h.em();
      const org = await seedOrganization(em, { name: `Cfg ${T}` });
      const customer = await seedCustomer(em, org.id, { email: `cfg-${T}@example.com` });
      orderId = (await seedOrder(em, { organizationId: org.id, customerId: customer.id, businessId: `CFG${T}-1` })).id;
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Back to the shipped value before every case. */
  beforeEach(async () => {
    const view = await getView();
    await put({ expectedVersion: view.version, entities: view.entities.map((e) => ({ entityType: e.entityType })) });
  });

  async function getView(cookies: Record<string, string> = GS_COOKIES.admin): Promise<AdminSearchConfigurationView> {
    const res = await h.app.inject({ method: 'GET', url: URL, cookies });
    expect(res.statusCode).toBe(200);
    return AdminSearchConfigurationViewSchema.parse((res.json() as { data: unknown }).data);
  }

  function put(payload: unknown, cookies: Record<string, string> = GS_COOKIES.admin) {
    return h.app.inject({ method: 'PUT', url: URL, cookies, payload: payload as Record<string, unknown> });
  }

  it('refuses GET and PUT without admin_search:configure — before validating the body (FR-024)', async () => {
    const get = await h.app.inject({ method: 'GET', url: URL, cookies: GS_COOKIES.noConfigure });
    expect(get.statusCode).toBe(403);
    const invalid = await put({ nonsense: true }, GS_COOKIES.noConfigure);
    expect(invalid.statusCode).toBe(403);
    const valid = await put({ expectedVersion: null, entities: [] }, GS_COOKIES.noConfigure);
    expect(valid.statusCode).toBe(403);
  });

  it('lists the present record types with their offered fields and defaults', async () => {
    const view = await getView();
    // The seven of this feature, then those later features contribute
    // (`specs/163-projects-and-tasks/`: Projects and Tasks).
    expect(view.entities.map((e) => e.entityType)).toEqual([
      'orders.order',
      'quote_requests.quote_request',
      'crm.opportunity',
      'organizations.organization',
      'customers.customer',
      'catalog.product',
      'catalog.category',
      'projects.project',
      'tasks.task',
    ]);
    const orders = view.entities[0]!;
    expect(orders).toMatchObject({ label: 'Orders', enabled: true, customized: false });
    expect(orders.fields.map((f) => [f.code, f.selected, f.defaultSelected])).toEqual([
      ['number', true, true],
      ['organizationName', true, true],
      ['customer', true, true],
      ['billingCompanyName', false, false],
      ['billingTaxId', false, false],
    ]);
  });

  it.each([
    ['a field the type does not offer', { entityType: 'orders.order', enabled: true, fields: ['password'] }, 'entities.0.fields.0'],
    ['an unknown record type', { entityType: 'billing.invoice', enabled: true, fields: ['number'] }, 'entities.0.entityType'],
    ['a duplicate field', { entityType: 'orders.order', enabled: true, fields: ['number', 'number'] }, 'entities.0.fields.1'],
    ['an included type with no field', { entityType: 'orders.order', enabled: true, fields: [] }, 'entities.0.fields'],
  ])('refuses %s with 422 and stores nothing (FR-020, FR-021)', async (_name, entry, path) => {
    const before = await getView();
    const res = await put({ expectedVersion: before.version, entities: [entry] });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details.map((d) => d.path)).toContain(path);
    expect((await getView()).version).toBe(before.version);
  });

  it('refuses a stale version with 409 VERSION_CONFLICT (FR-026)', async () => {
    const loaded = await getView();
    const first = await put({
      expectedVersion: loaded.version,
      entities: [{ entityType: 'orders.order', enabled: true, fields: ['number'] }],
    });
    expect(first.statusCode).toBe(200);
    const second = await put({
      expectedVersion: loaded.version,
      entities: [{ entityType: 'orders.order', enabled: true, fields: ['customer'] }],
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');
  });

  it('audits a save with the value before and after (FR-025)', async () => {
    const loaded = await getView();
    const res = await put({
      expectedVersion: loaded.version,
      entities: [{ entityType: 'catalog.category', enabled: false, fields: ['slug'] }],
    });
    expect(res.statusCode).toBe(200);
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'admin_search.entity_fields' });
    const rows = await em.find(
      AuditLogEntry,
      { action: 'setting.global_value_set', objectType: 'setting', objectId: setting.id },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(rows[0]?.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    expect((rows[0]?.stateAfter as { value?: unknown }).value).toEqual({
      version: 1,
      entities: { 'catalog.category': { enabled: false, fields: ['slug'] } },
    });
    expect(rows[0]?.stateBefore).toBeTruthy();
  });

  it("reaches another admin's very next search, with no restart (FR-023, SC-004)", async () => {
    expect(await searchIds(h, GS_COOKIES.restricted, `CFG${T}`, 'orders.order')).toEqual([orderId]);
    const loaded = await getView();
    const saved = await put({
      expectedVersion: loaded.version,
      entities: [{ entityType: 'orders.order', enabled: true, fields: ['billingTaxId'] }],
    });
    expect(saved.statusCode).toBe(200);
    expect(await searchIds(h, GS_COOKIES.restricted, `CFG${T}`, 'orders.order')).toEqual([]);
    const restored = await put({ expectedVersion: null, entities: [{ entityType: 'orders.order' }] });
    expect(restored.statusCode).toBe(200);
    expect(await searchIds(h, GS_COOKIES.restricted, `CFG${T}`, 'orders.order')).toEqual([orderId]);
  });

  it('holds a write through the generic Settings API to the same allow-list', async () => {
    const before = await getView();
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/admin_search.entity_fields/value',
      cookies: GS_COOKIES.admin,
      payload: { scope: 'all', value: { version: 1, entities: { 'orders.order': { enabled: true, fields: ['password'] } } } },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    expect((await getView()).version).toBe(before.version);
  });

  it("keeps a switched-off record type's entry across a save and applies it when the module returns (FR-027)", async () => {
    const loaded = await getView();
    await put({
      expectedVersion: loaded.version,
      entities: [{ entityType: 'crm.opportunity', enabled: true, fields: ['title'] }],
    });
    await withModuleOff('crm', 'deactivated', async () => {
      const off = await getView();
      expect(off.entities.map((e) => e.entityType)).not.toContain('crm.opportunity');
      const saved = await put({
        expectedVersion: off.version,
        entities: [{ entityType: 'orders.order', enabled: false, fields: ['number'] }],
      });
      expect(saved.statusCode).toBe(200);
    });
    const back = await getView();
    const crm = back.entities.find((e) => e.entityType === 'crm.opportunity');
    expect(crm).toMatchObject({ customized: true, enabled: true });
    expect(crm?.fields.filter((f) => f.selected).map((f) => f.code)).toEqual(['title']);
    expect(back.entities.find((e) => e.entityType === 'orders.order')).toMatchObject({ enabled: false });
  });
});
