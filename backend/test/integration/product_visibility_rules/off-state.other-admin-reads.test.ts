import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AvailabilityNotification } from '../../helpers/package-entities.js';
import { ADMIN, call, roleWith, snapshotInventory, type TestRole } from './fixtures.js';

/**
 * Spec 193 T051 — analyze M3 for Phase 5c: with `product_visibility_rules` off (deactivated, or
 * unavailable on the platform) every surface it narrows or refuses here — the inventory admin
 * lists and the set-stock tool (FR-083, FR-081), price history (FR-084), the products export
 * and import (FR-085) and the price-book row export (FR-094) — answers a restricted role exactly
 * as it answers with the module never installed: no narrowing, no `403`.
 */
describe('off state — the other admin reads with the module off are as never installed (spec 193, T051)', () => {
  const INV = '/api/v1/admin/inventory';
  const BOOKS = '/api/v1/admin/price-books';
  const AXES = ['deactivated', 'platform-unavailable'] as const;
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let reader: TestRole;
  let bookId: string;
  let warehouseId: string;
  let restoreInventory: (() => Promise<void>) | undefined;

  const get = async (url: string, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };
  const tool = (id: string): PromptActionTool => {
    const registry = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ get(id: string): PromptActionTool | undefined }>(
      'promptActionToolRegistry',
    );
    const found = registry.get(id);
    if (!found) throw new Error(`no assistant tool ${id}`);
    return found;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    reader = await roleWith(h, ['rfqs:handle', 'catalog:read', 'price_lists:read', 'inventory:read'], 'cvf');
    const mapped = await call(h, 'PUT', `/role-mappings/${reader.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    bookId = (
      await fx.f.book({
        audience: 'everyone',
        rows: [
          { product: { id: fx.visible.id }, fixed: '93' },
          { product: { id: fx.hidden.id }, fixed: '44' },
        ],
      })
    ).id;
    warehouseId = (await get('/api/v1/admin/warehouses', ADMIN)).body.items[0].id;
    restoreInventory = await snapshotInventory(h, [fx.visible.id, fx.hidden.id]);
    const em = h.em();
    for (const productId of [fx.visible.id, fx.hidden.id]) {
      const set = await h.app.inject({ method: 'PUT', url: `${INV}/levels`, cookies: ADMIN, payload: { productId, warehouseId, onHand: 4 } });
      expect(set.statusCode, set.body).toBe(200);
      em.create(AvailabilityNotification, { productId, email: `off-${randomUUID().slice(0, 8)}@example.test` });
    }
    await em.flush();
  }, 5 * 60_000);

  afterAll(async () => {
    await restoreInventory?.();
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('the inventory lists, price history and the row export answer the restricted role as the platform administrator', async () => {
    const changes = (await get(`${BOOKS}/${bookId}/price-history?limit=50`, ADMIN)).body.data as Array<{ id: string }>;
    const urls = [
      INV,
      `${INV}/levels?pageSize=500`,
      `${INV}/levels?productId=${fx.hidden.id}`,
      `${INV}/low-stock`,
      `${INV}/legacy?limit=500`,
      `${INV}/availability-notifications?pageSize=200`,
      `${BOOKS}/${bookId}/rows?pageSize=1000`,
      `${BOOKS}/${bookId}/price-history/products/${fx.hidden.id}`,
      ...changes.map((c) => `${BOOKS}/${bookId}/price-history/${c.id}/lines?limit=100`),
    ];
    const read = async (cookies: Record<string, string>) => {
      const out: unknown[] = [];
      for (const url of urls) {
        const res = await get(url, cookies);
        expect(res.status, `${url}: ${res.raw}`).toBe(200);
        out.push(res.body);
      }
      return out;
    };
    const admin = await read(ADMIN);
    expect(JSON.stringify(admin)).toContain(fx.hidden.id);
    for (const axis of AXES) {
      expect(await withModuleOff('product_visibility_rules', axis, () => read(reader.cookies))).toEqual(admin);
    }
  });

  it('the set-stock tool previews a product the module would hide', async () => {
    const preview = (as: string) =>
      tool('inventory.set_stock_level').preview!({ productId: fx.hidden.id, warehouseId, quantity: 5 } as never, {
        adminUserId: as,
        requestId: `req-${randomUUID()}`,
        auditCtx: { ipAddress: null, userAgent: null, requestId: null } as ToolContext['auditCtx'],
      });
    for (const axis of AXES) {
      const off = (await withModuleOff('product_visibility_rules', axis, () => preview(fx.restricted.adminUserId))) as { affectedCount: number };
      expect(off.affectedCount).toBe(1);
    }
  });

  it('the products export is not refused', async () => {
    for (const axis of AXES) {
      const off = await withModuleOff('product_visibility_rules', axis, () =>
        h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', cookies: fx.restricted.cookies }),
      );
      expect(off.statusCode, off.body).toBe(200);
    }
  });
});
