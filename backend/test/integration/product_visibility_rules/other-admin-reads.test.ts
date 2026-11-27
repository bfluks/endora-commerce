import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import { AvailabilityNotification } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { ADMIN, call, roleWith, snapshotInventory, type TestRole } from './fixtures.js';

/**
 * Spec 193 T051 — the other admin product reads (FR-083 – FR-085, SC-009), one block per narrowed
 * or refused row of the signed-off table (OQ-H).
 */
describe('other admin product reads — narrowed by the visibility category (spec 193, T051)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let reader: TestRole;
  let bookId: string;

  const get = async (url: string, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    reader = await roleWith(h, ['rfqs:handle', 'price_lists:read', 'catalog:read', 'inventory:read'], 'cvo');
    const mapped = await call(h, 'PUT', `/role-mappings/${reader.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    const book = await fx.f.book({
      audience: 'everyone',
      rows: [
        { product: { id: fx.visible.id }, fixed: '91' },
        { product: { id: fx.hidden.id }, fixed: '41' },
      ],
    });
    bookId = book.id;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  describe('FR-084 — price history', () => {
    const history = () => `/api/v1/admin/price-books/${bookId}/price-history`;

    it('a hidden product\'s history answers as a product with none', async () => {
      const admin = await get(`${history()}/products/${fx.hidden.id}`, ADMIN);
      expect(admin.status, admin.raw).toBe(200);
      expect(admin.body.data.length).toBeGreaterThan(0);
      const hidden = await get(`${history()}/products/${fx.hidden.id}`, reader.cookies);
      const absent = await get(`${history()}/products/00000000-0000-4000-8000-0000000000ee`, reader.cookies);
      expect(hidden.status, hidden.raw).toBe(200);
      expect(hidden.body).toEqual(absent.body);
      const visible = await get(`${history()}/products/${fx.visible.id}`, reader.cookies);
      expect(visible.body.data.length).toBeGreaterThan(0);
    });

    it('a change\'s lines leave out a hidden product\'s lines', async () => {
      const changes = await get(`${history()}?limit=50`, ADMIN);
      expect(changes.status, changes.raw).toBe(200);
      const productIdsOf = (body: { data: Array<{ selection: { productId: string | null } }> }) =>
        body.data.map((l) => l.selection.productId);
      let seenHidden = false;
      for (const change of changes.body.data as Array<{ id: string }>) {
        const admin = await get(`${history()}/${change.id}/lines?limit=100`, ADMIN);
        const restricted = await get(`${history()}/${change.id}/lines?limit=100`, reader.cookies);
        expect(restricted.status, restricted.raw).toBe(200);
        if (productIdsOf(admin.body).includes(fx.hidden.id)) seenHidden = true;
        expect(productIdsOf(restricted.body)).not.toContain(fx.hidden.id);
        expect(productIdsOf(restricted.body)).toEqual(productIdsOf(admin.body).filter((id) => id !== fx.hidden.id));
      }
      expect(seenHidden, 'the fixture wrote a line for the hidden product').toBe(true);
    });

    it('off state (M3): with the module off both history reads are the platform administrator\'s', async () => {
      const changes = (await get(`${history()}?limit=50`, ADMIN)).body.data as Array<{ id: string }>;
      const urls = [`${history()}/products/${fx.hidden.id}`, ...changes.map((c) => `${history()}/${c.id}/lines?limit=100`)];
      const read = async (cookies: Record<string, string>) => {
        const out: unknown[] = [];
        for (const url of urls) out.push((await get(url, cookies)).body);
        return out;
      };
      const admin = await read(ADMIN);
      for (const axis of ['deactivated', 'platform-unavailable'] as const) {
        expect(await withModuleOff('product_visibility_rules', axis, () => read(reader.cookies))).toEqual(admin);
      }
    });
  });

  describe('FR-083, FR-081 — inventory admin lists and the set-stock assistant tool', () => {
    const INV = '/api/v1/admin/inventory';
    let warehouseId: string;
    let thresholds: Array<{ id: string; manage_stock: boolean; low_stock_threshold: number | null }>;
    let restoreInventory: (() => Promise<void>) | undefined;
    const marks = () => [fx.hidden.id, fx.hidden.sku];

    const tool = (id: string): PromptActionTool => {
      const registry = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ get(id: string): PromptActionTool | undefined }>(
        'promptActionToolRegistry',
      );
      const found = registry.get(id);
      if (!found) throw new Error(`no assistant tool ${id}`);
      return found;
    };
    const ctxOf = (adminUserId: string): ToolContext => ({
      adminUserId,
      requestId: `req-${randomUUID()}`,
      auditCtx: { ipAddress: null, userAgent: null, requestId: null } as ToolContext['auditCtx'],
    });
    const errorOf = async (work: () => Promise<unknown>) => {
      try {
        await work();
        return null;
      } catch (err) {
        const e = err as { statusCode?: number; code?: string; message?: string };
        return { statusCode: e.statusCode, code: e.code, message: e.message };
      }
    };
    const onHandOf = async (productId: string) => {
      const res = await get(`${INV}/legacy?productId=${productId}`, ADMIN);
      return (res.body.data as Array<{ warehouseId: string; onHand: number }>).find((r) => r.warehouseId === warehouseId)?.onHand ?? null;
    };

    beforeAll(async () => {
      const warehouses = await get('/api/v1/admin/warehouses', ADMIN);
      expect(warehouses.status, warehouses.raw).toBe(200);
      warehouseId = (warehouses.body.data ?? warehouses.body.items)[0].id;
      restoreInventory = await snapshotInventory(h, [fx.visible.id, fx.hidden.id]);
      for (const [productId, onHand] of [[fx.visible.id, 3], [fx.hidden.id, 2]] as const) {
        const set = await h.app.inject({ method: 'PUT', url: `${INV}/levels`, cookies: ADMIN, payload: { productId, warehouseId, onHand } });
        expect(set.statusCode, set.body).toBe(200);
      }
      // Both low on stock, so both are on the low-stock report and in the KPI counts.
      const em = h.em();
      thresholds = await em.getConnection().execute(
        `select "id", "manage_stock", "low_stock_threshold" from "products" where "id" in (?, ?)`,
        [fx.visible.id, fx.hidden.id],
      );
      await em.getConnection().execute(`update "products" set "manage_stock" = true, "low_stock_threshold" = 10 where "id" in (?, ?)`, [
        fx.visible.id,
        fx.hidden.id,
      ]);
      for (const productId of [fx.visible.id, fx.hidden.id]) {
        em.create(AvailabilityNotification, { productId, email: `t051-${randomUUID().slice(0, 8)}@example.test` });
      }
      await em.flush();
    });

    afterAll(async () => {
      await restoreInventory?.();
      for (const row of thresholds ?? []) {
        await h.em().getConnection().execute(`update "products" set "manage_stock" = ?, "low_stock_threshold" = ? where "id" = ?`, [
          row.manage_stock,
          row.low_stock_threshold,
          row.id,
        ]);
      }
    });

    it('the stock roster lists visible products only, counted and paged over them', async () => {
      const admin = await get(`${INV}/levels?pageSize=500`, ADMIN);
      expect(admin.status, admin.raw).toBe(200);
      const adminIds = (admin.body.items as Array<{ productId: string }>).map((i) => i.productId);
      expect(adminIds).toEqual(expect.arrayContaining([fx.visible.id, fx.hidden.id]));

      const res = await get(`${INV}/levels?pageSize=500`, reader.cookies);
      expect(res.status, res.raw).toBe(200);
      const ids = (res.body.items as Array<{ productId: string }>).map((i) => i.productId);
      expect(ids).toContain(fx.visible.id);
      expect(ids.every((id) => adminIds.includes(id))).toBe(true);
      expect(res.body.total).toBe(ids.length);
      expect(res.body.total).toBeLessThan(admin.body.total);
      for (const mark of marks()) expect(res.raw).not.toContain(mark);

      for (const query of [`q=${encodeURIComponent(fx.hidden.sku)}`, `productId=${fx.hidden.id}`]) {
        const narrowed = await get(`${INV}/levels?${query}`, reader.cookies);
        expect(narrowed.status, narrowed.raw).toBe(200);
        expect(narrowed.body.items).toEqual([]);
        expect(narrowed.body.total).toBe(0);
      }
      // Paged one at a time, the total holds.
      const first = await get(`${INV}/levels?pageSize=1&page=0`, reader.cookies);
      expect(first.body.total).toBe(res.body.total);
      expect(first.body.items).toHaveLength(1);
    });

    it('the low-stock report, the legacy list and the back-in-stock queue leave hidden products out', async () => {
      const lowAdmin = await get(`${INV}/low-stock`, ADMIN);
      expect((lowAdmin.body.items as Array<{ productId: string }>).map((i) => i.productId)).toEqual(
        expect.arrayContaining([fx.visible.id, fx.hidden.id]),
      );
      const low = await get(`${INV}/low-stock`, reader.cookies);
      expect(low.status, low.raw).toBe(200);
      expect((low.body.items as Array<{ productId: string }>).map((i) => i.productId)).toContain(fx.visible.id);
      for (const mark of marks()) expect(low.raw).not.toContain(mark);

      const legacy = await get(`${INV}/legacy?limit=500`, reader.cookies);
      expect(legacy.status, legacy.raw).toBe(200);
      expect((legacy.body.data as Array<{ productId: string }>).map((i) => i.productId)).toContain(fx.visible.id);
      for (const mark of marks()) expect(legacy.raw).not.toContain(mark);
      expect((await get(`${INV}/legacy?productId=${fx.hidden.id}`, reader.cookies)).body.data).toEqual([]);

      const queueAdmin = await get(`${INV}/availability-notifications?pageSize=200`, ADMIN);
      const queue = await get(`${INV}/availability-notifications?pageSize=200`, reader.cookies);
      expect(queue.status, queue.raw).toBe(200);
      const queued = (queue.body.items as Array<{ productId: string }>).map((i) => i.productId);
      expect(queued).toContain(fx.visible.id);
      expect(queue.body.total).toBe(queued.length);
      expect(queue.body.total).toBeLessThan(queueAdmin.body.total);
      for (const mark of marks()) expect(queue.raw).not.toContain(mark);
      const byHidden = await get(`${INV}/availability-notifications?productId=${fx.hidden.id}`, reader.cookies);
      expect(byHidden.body.items).toEqual([]);
      expect(byHidden.body.total).toBe(0);
    });

    it('the landing KPIs count visible products only', async () => {
      const admin = (await get(INV, ADMIN)).body.data;
      const res = await get(INV, reader.cookies);
      expect(res.status, res.raw).toBe(200);
      const kpis = res.body.data;
      expect(kpis.totalProductsTracked).toBeLessThanOrEqual(admin.totalProductsTracked - 1);
      expect(kpis.totalOnHand).toBeLessThanOrEqual(admin.totalOnHand - 2);
      expect(kpis.lowStockCount).toBeLessThanOrEqual(admin.lowStockCount - 1);
      const sum = (rows: Array<{ onHand: number }>) => rows.reduce((n, r) => n + r.onHand, 0);
      expect(sum(kpis.perWarehouseTotals)).toBe(kpis.totalOnHand);
    });

    it('the warehouse totals sum visible products only, in the list and the detail (checkpoint 1)', async () => {
      type Totals = { products: number; onHand: number; isDefaultForChannelCount: number };
      const listed = async (cookies: Record<string, string>) =>
        ((await get('/api/v1/admin/warehouses?pageSize=200', cookies)).body.items as Array<{ id: string; totals: Totals }>).find(
          (w) => w.id === warehouseId,
        )!.totals;
      const detail = async (cookies: Record<string, string>) => (await get(`/api/v1/admin/warehouses/${warehouseId}`, cookies)).body.data.totals as Totals;
      const admin = await listed(ADMIN);
      const mine = await listed(reader.cookies);
      expect(mine.products).toBeLessThanOrEqual(admin.products - 1);
      expect(mine.onHand).toBeLessThanOrEqual(admin.onHand - 2);
      expect(mine.isDefaultForChannelCount).toBe(admin.isDefaultForChannelCount);
      expect(await detail(reader.cookies)).toEqual(mine);
      expect(await detail(ADMIN)).toEqual(admin);
      // The same numbers the landing KPIs give the same caller for this warehouse.
      const kpis = (await get(INV, reader.cookies)).body.data as { perWarehouseTotals: Array<{ warehouseId: string; onHand: number }> };
      const kpi = kpis.perWarehouseTotals.find((w) => w.warehouseId === warehouseId);
      if (kpi) expect(kpi.onHand).toBe(mine.onHand);
      const none = await roleWith(h, ['rfqs:handle', 'inventory:read'], 'cvw');
      expect(await listed(none.cookies)).toEqual(expect.objectContaining({ products: 0, onHand: 0 }));
      expect(await detail(none.cookies)).toEqual(expect.objectContaining({ products: 0, onHand: 0 }));
    });

    it('a role with no category sees no stock at all', async () => {
      const none = await roleWith(h, ['rfqs:handle', 'inventory:read'], 'cvi');
      const kpis = (await get(INV, none.cookies)).body.data;
      expect(kpis).toEqual(expect.objectContaining({ totalProductsTracked: 0, totalOnHand: 0, outOfStockCount: 0, lowStockCount: 0 }));
      expect((await get(`${INV}/levels`, none.cookies)).body).toEqual(expect.objectContaining({ items: [], total: 0 }));
      expect((await get(`${INV}/low-stock`, none.cookies)).body.items).toEqual([]);
      expect((await get(`${INV}/legacy`, none.cookies)).body.data).toEqual([]);
      expect((await get(`${INV}/availability-notifications`, none.cookies)).body).toEqual(expect.objectContaining({ items: [], total: 0 }));
    });

    it('FR-081: the set-stock tool answers a hidden product as a missing one and does not write it', async () => {
      const setStock = tool('inventory.set_stock_level');
      const as = ctxOf(fx.restricted.adminUserId);
      const asHidden = await errorOf(() => setStock.preview!({ productId: fx.hidden.id, warehouseId, quantity: 7 } as never, as));
      const asMissing = await errorOf(() => setStock.preview!({ productId: randomUUID(), warehouseId, quantity: 7 } as never, as));
      expect(asHidden).not.toBeNull();
      expect(asHidden).toEqual(asMissing);
      expect(await errorOf(() => setStock.execute({ productId: fx.hidden.id, warehouseId, quantity: 7 } as never, as))).toEqual(asMissing);
      expect(await onHandOf(fx.hidden.id)).toBe(2);
      // A visible product is previewed as before.
      const visible = (await setStock.preview!({ productId: fx.visible.id, warehouseId, quantity: 3 } as never, as)) as { affectedCount: number };
      expect(visible.affectedCount).toBe(1);
    });
  });
  describe('FR-085 — products export and import', () => {
    const exportCsv = (cookies: Record<string, string>) => h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', cookies });
    const importCsv = (cookies: Record<string, string>) =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/import/products?profileId=00000000-0000-4000-8000-0000000000ef&dryRun=true`,
        cookies,
        headers: { 'content-type': 'text/csv' },
        payload: 'sku\nX\n',
      });

    it('are refused 403 for a restricted administrator, whatever the file', async () => {
      for (const cookies of [fx.restricted.cookies, fx.noCategory.cookies]) {
        const exported = await exportCsv(cookies);
        expect(exported.statusCode, exported.body).toBe(403);
        expect(exported.json().error.code).toBe('FORBIDDEN');
        const imported = await importCsv(cookies);
        expect(imported.statusCode, imported.body).toBe(403);
        expect(imported.json().error.code).toBe('FORBIDDEN');
      }
    });

    it('are the platform administrator\'s, and a restricted one\'s while the module is off', async () => {
      expect((await exportCsv(ADMIN)).statusCode).toBe(200);
      for (const axis of ['deactivated', 'platform-unavailable'] as const) {
        const off = await withModuleOff('product_visibility_rules', axis, () => exportCsv(fx.restricted.cookies));
        expect(off.statusCode, off.body).toBe(200);
      }
    });
  });
});
