import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, call, roleWith, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T043 / T044 — the price book grid for a restricted administrator (FR-030 "the price
 * book grid", FR-038, US1-10, US1-12).
 *
 * The grid's product lines are cut by `catalog`'s `pageProductsByAdminName` with the caller's
 * scope inside its statement — page and total — and a visible configurable product's variant
 * lines keep only its qualifying variants. Row **edits** stay unrestricted (FR-038). With the
 * module off the grid's pages and counts are the platform administrator's (analyze M3).
 */
describe('price book lines — narrowed by the visibility category (spec 193, T043, T044)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let grid: TestRole;
  let bookId: string;

  const lines = async (cookies: Record<string, string>, query = 'pageSize=100') => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/price-books/${bookId}/lines?${query}`, cookies });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };
  const productLines = (body: { data: Array<{ selection: { productId: string | null }; variants?: Array<{ selection: { variantId: string } }> }> }) =>
    body.data.filter((line) => line.selection.productId !== null);

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    grid = await roleWith(h, ['rfqs:handle', 'catalog:read', 'price_lists:read', 'price_lists:write'], 'cvp');
    const mapped = await call(h, 'PUT', `/role-mappings/${grid.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    const book = await fx.f.book({
      audience: 'everyone',
      rows: [
        { product: { id: fx.visible.id }, fixed: '90' },
        { product: { id: fx.hidden.id }, fixed: '40' },
        { product: { id: fx.configurable.id }, variant: fx.configurable.visibleVariant, fixed: '45' },
        { product: { id: fx.configurable.id }, variant: fx.configurable.hiddenVariant, fixed: '46' },
      ],
    });
    bookId = book.id;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('the platform administrator sees every line', async () => {
    const res = await lines(ADMIN);
    expect(res.status, res.raw).toBe(200);
    const ids = productLines(res.body).map((l) => l.selection.productId);
    expect(ids).toEqual(expect.arrayContaining([fx.visible.id, fx.hidden.id, fx.configurable.id]));
    expect(res.body.meta.totalLines).toBe(3);
  });

  it('a restricted administrator sees visible products only, counted in the same statement', async () => {
    const res = await lines(grid.cookies);
    expect(res.status, res.raw).toBe(200);
    const ids = productLines(res.body).map((l) => l.selection.productId);
    expect(ids.sort()).toEqual([fx.visible.id, fx.configurable.id].sort());
    expect(res.body.meta.totalLines).toBe(2);
    expect(res.raw).not.toContain(fx.hidden.id);
    // Paged one at a time, the total holds and no page is short but the last.
    const first = await lines(grid.cookies, 'pageSize=1&page=1');
    const second = await lines(grid.cookies, 'pageSize=1&page=2');
    const third = await lines(grid.cookies, 'pageSize=1&page=3');
    expect(first.body.meta.totalLines).toBe(2);
    expect(productLines(first.body)).toHaveLength(1);
    expect(productLines(second.body)).toHaveLength(1);
    expect(productLines(third.body)).toHaveLength(0);
  });

  it('a searched page is narrowed too', async () => {
    const res = await lines(grid.cookies, `search=${encodeURIComponent(fx.hidden.sku)}`);
    expect(res.status, res.raw).toBe(200);
    expect(productLines(res.body)).toEqual([]);
    expect(res.body.meta.totalLines).toBe(0);
  });

  it('US1-12: a visible configurable product keeps its qualifying variant line only', async () => {
    const res = await lines(grid.cookies);
    const configurable = productLines(res.body).find((l) => l.selection.productId === fx.configurable.id)!;
    expect(configurable.variants!.map((v) => v.selection.variantId)).toEqual([fx.configurable.visibleVariant]);
    const admin = productLines((await lines(ADMIN)).body).find((l) => l.selection.productId === fx.configurable.id)!;
    expect(admin.variants!.map((v) => v.selection.variantId).sort()).toEqual(
      [fx.configurable.visibleVariant, fx.configurable.hiddenVariant].sort(),
    );
  });

  it('a role with no category sees no product line', async () => {
    const none = await roleWith(h, ['rfqs:handle', 'price_lists:read'], 'cvq');
    const res = await lines(none.cookies);
    expect(res.status, res.raw).toBe(200);
    expect(productLines(res.body)).toEqual([]);
    expect(res.body.meta.totalLines).toBe(0);
  });

  it('FR-038, US1-10: reading and editing a hidden product\'s price-book rows is not refused', async () => {
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-books/base-prices?productId=${fx.hidden.id}`,
      cookies: grid.cookies,
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = await h.app.inject({ method: 'GET', url: `/api/v1/admin/price-books/${bookId}/rows`, cookies: grid.cookies });
    expect(rows.statusCode, rows.body).toBe(200);
  });

  it('off state (M3): with the module off the grid is the platform administrator\'s, pages and counts', async () => {
    const admin = await lines(ADMIN);
    for (const axis of ['deactivated', 'platform-unavailable'] as const) {
      const off = await withModuleOff('product_visibility_rules', axis, () => lines(grid.cookies));
      expect(off.status, off.raw).toBe(200);
      expect(off.body).toEqual(admin.body);
    }
  });
});
