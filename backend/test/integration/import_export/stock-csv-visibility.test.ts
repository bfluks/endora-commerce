import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { call, roleWith, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 (FR-085, owner ruling 2026-11-26) — the stock CSV (`stock` entity: product SKU,
 * variant, on hand) is a whole-catalogue file of product-keyed rows, so its export and import are
 * refused `403` to an administrator whose product visibility is narrowed (restricted or no
 * category), exactly like the products CSV. Every role here holds `inventory:read` and
 * `inventory:write`, so a `403` is the visibility refusal, not the permission gate (the
 * unrestricted control holds the same codes and is answered `200`). With the module off nobody is
 * refused.
 */
describe('stock CSV export and import for a narrowed administrator (spec 193, FR-085)', () => {
  const STOCK_CODES = ['rfqs:handle', 'catalog:read', 'inventory:read', 'inventory:write'] as const;
  const HEADER_ONLY = 'product_sku,variant_id,on_hand\n';
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let restricted: TestRole;
  let noCategory: TestRole;
  let unrestricted: TestRole;

  const exportStock = (role: TestRole) => h.app.inject({ method: 'GET', url: '/api/v1/admin/export/stock.csv', cookies: role.cookies });
  const importStock = (role: TestRole) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/stock',
      headers: { 'content-type': 'text/csv' },
      cookies: role.cookies,
      payload: HEADER_ONLY,
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    restricted = await roleWith(h, STOCK_CODES, 'csr');
    const mapped = await call(h, 'PUT', `/role-mappings/${restricted.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    // Unmapped and holding `rfqs:handle`: fail-closed, no category (FR-023).
    noCategory = await roleWith(h, STOCK_CODES, 'csn');
    // Without the fail-closed code an unmapped role is unrestricted.
    unrestricted = await roleWith(h, ['catalog:read', 'inventory:read', 'inventory:write'], 'csu');
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('control: an unrestricted administrator with the same codes exports and imports stock', async () => {
    const exported = await exportStock(unrestricted);
    expect(exported.statusCode, exported.body).toBe(200);
    const imported = await importStock(unrestricted);
    expect(imported.statusCode, imported.body).toBe(200);
  });

  it('a restricted administrator is refused the stock export and import, naming nothing', async () => {
    for (const res of [await exportStock(restricted), await importStock(restricted)]) {
      expect(res.statusCode, res.body).toBe(403);
      expect(res.body).not.toContain(fx.hidden.id);
      expect(res.body).not.toContain(fx.hidden.sku);
    }
  });

  it('an administrator with no category is refused the stock export and import', async () => {
    expect((await exportStock(noCategory)).statusCode).toBe(403);
    expect((await importStock(noCategory)).statusCode).toBe(403);
  });

  it('with the module off a restricted administrator is not refused (as never installed)', async () => {
    for (const axis of ['deactivated', 'platform-unavailable'] as const) {
      const [exported, imported] = await withModuleOff('product_visibility_rules', axis, async () => [
        await exportStock(restricted),
        await importStock(restricted),
      ]);
      expect(exported.statusCode, `${axis}: ${exported.body}`).toBe(200);
      expect(imported.statusCode, `${axis}: ${imported.body}`).toBe(200);
    }
  });
});
