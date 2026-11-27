import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  productFingerprint,
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { call } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T048 — FR-081 (OQ-E A), US1-17, threat model TM-3 (2): the assistant tools `catalog`
 * contributes resolve the **invoking** administrator's scope at execution — and again when a plan
 * is confirmed later — never from an ambient request. A hidden product asked through a tool is
 * not found and not written.
 */
describe('catalog assistant tools — the invoking admin\'s visibility (spec 193, T048)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;

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

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('search finds a hidden product for nobody restricted', async () => {
    const search = tool('catalog.search_products');
    const restricted = (await search.execute({ q: fx.hidden.sku }, ctxOf(fx.restricted.adminUserId))) as Array<{ id: string }>;
    expect(restricted).toEqual([]);
    const visible = (await search.execute({ q: fx.f.products.P1.sku }, ctxOf(fx.restricted.adminUserId))) as Array<{ id: string }>;
    expect(visible.map((p) => p.id)).toContain(fx.visible.id);
  });

  it.each(['catalog.archive_product', 'catalog.set_product_status', 'catalog.set_products_visibility'])(
    '%s: a hidden product previews as a missing one and is not written',
    async (id) => {
      const params = (productIds: string[]) =>
        id === 'catalog.set_product_status'
          ? { productIds, status: 'inactive' }
          : id === 'catalog.set_products_visibility'
            ? { productIds, visibility: 'logged_in_only' }
            : { productIds };
      const t = tool(id);
      const asHidden = await errorOf(() => t.preview!(params([fx.hidden.id]) as never, ctxOf(fx.restricted.adminUserId)));
      const asMissing = await errorOf(() => t.preview!(params([randomUUID()]) as never, ctxOf(fx.restricted.adminUserId)));
      expect(asHidden).not.toBeNull();
      expect(asHidden).toEqual(asMissing);
      const before = await productFingerprint(h, fx.hidden.id);
      await t.execute(params([fx.hidden.id]) as never, ctxOf(fx.restricted.adminUserId));
      expect(await productFingerprint(h, fx.hidden.id)).toEqual(before);
    },
  );

  it('a plan confirmed later re-resolves the scope: a product hidden since the preview is not written', async () => {
    const t = tool('catalog.set_products_visibility');
    const params = { productIds: [fx.visible.id], visibility: 'logged_in_only' };
    // Previewed while the product is visible to the role…
    await t.preview!(params as never, ctxOf(fx.restricted.adminUserId));
    // …then the role loses its category (unmapped, holding `rfqs:handle`: it sees nothing).
    const unmapped = await call(h, 'PUT', `/role-mappings/${fx.restricted.roleId}`, { payload: { target: null } });
    expect(unmapped.status, JSON.stringify(unmapped.body)).toBe(200);
    try {
      const before = await productFingerprint(h, fx.visible.id);
      await t.execute(params as never, ctxOf(fx.restricted.adminUserId));
      expect(await productFingerprint(h, fx.visible.id)).toEqual(before);
    } finally {
      const restored = await call(h, 'PUT', `/role-mappings/${fx.restricted.roleId}`, {
        payload: { target: { kind: 'category', categoryId: fx.categoryId } },
      });
      expect(restored.status).toBe(200);
    }
  });
});
