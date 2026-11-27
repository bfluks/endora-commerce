import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';

/**
 * Spec 193 FR-073 / FR-081 QA addition — the catalog assistant tools with `product_visibility_rules`
 * off. `visibility-assistant-tools.test.ts` has no off case (and `visibility-off-state.test.ts` probes
 * HTTP routes only), so nothing held "the module off => the assistant tools answer as never installed".
 * A restricted administrator's search finds the product the module would hide, and its preview is
 * not refused as a missing product; on again, both narrow.
 */
describe('catalog assistant tools — off state (spec 193, FR-073, FR-081)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  const tool = (id: string): PromptActionTool => {
    const registry = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ get(id: string): PromptActionTool | undefined }>('promptActionToolRegistry');
    const found = registry.get(id);
    if (!found) throw new Error(`no assistant tool ${id}`);
    return found;
  };
  const ctxOf = (adminUserId: string): ToolContext => ({
    adminUserId,
    requestId: `req-${randomUUID()}`,
    auditCtx: { ipAddress: null, userAgent: null, requestId: null } as ToolContext['auditCtx'],
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
  }, 5 * 60_000);
  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  const searchIds = async () =>
    ((await tool('catalog.search_products').execute({ q: fx.hidden.sku }, ctxOf(fx.restricted.adminUserId))) as Array<{ id: string }>).map((p) => p.id);
  const previewHidden = async () => {
    try {
      await tool('catalog.archive_product').preview!({ productIds: [fx.hidden.id] } as never, ctxOf(fx.restricted.adminUserId));
      return 'found';
    } catch {
      return 'refused';
    }
  };

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: search and preview see the hidden product; on again they do not', async (axis) => {
    expect(await searchIds()).toEqual([]);
    expect(await previewHidden()).toBe('refused');
    await withModuleOff('product_visibility_rules', axis, async () => {
      expect(await searchIds()).toContain(fx.hidden.id);
      expect(await previewHidden()).toBe('found');
    });
    expect(await searchIds()).toEqual([]);
  });
});
