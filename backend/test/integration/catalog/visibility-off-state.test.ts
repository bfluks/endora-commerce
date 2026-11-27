import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminProductVisibilityPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, scopePort } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T050 — the catalog's narrowing off-state (Principle XVII, analyze M3; threat model
 * TM-3 (4)). With `product_visibility_rules` off, on either axis, every catalog read and write a
 * restricted administrator makes answers what the platform administrator's answers — the module
 * behaves as never installed; switched back on, the narrowing is back; and present but failing,
 * the request answers 5xx — never unfiltered.
 */
const C = '/api/v1/admin/catalog';

describe('catalog visibility narrowing — off state (spec 193, T050)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;

  const probes = (): Array<{ method: 'GET' | 'POST'; url: string; payload?: unknown }> => [
    { method: 'GET', url: `${C}/products?pageSize=50&archived=include` },
    { method: 'POST', url: `${C}/products/resolve-ids`, payload: {} },
    { method: 'POST', url: `${C}/products/batch-by-id`, payload: { ids: [fx.visible.id, fx.hidden.id, fx.configurable.id] } },
    { method: 'GET', url: `${C}/products/${fx.hidden.id}` },
    { method: 'GET', url: `${C}/products/${fx.hidden.id}/variants` },
    { method: 'GET', url: `${C}/products/${fx.configurable.id}/variants` },
    { method: 'GET', url: `${C}/products/${fx.visible.id}/links` },
    { method: 'GET', url: `${C}/attribute-sets` },
    { method: 'GET', url: `${C}/bulk-operations?limit=100` },
    { method: 'GET', url: `/api/v1/admin/global-search?q=${encodeURIComponent(fx.hidden.sku)}&entityTypes=catalog.product&language=en` },
  ];
  const answers = async (cookies: Record<string, string>) => {
    const out: Array<{ url: string; status: number; body: unknown }> = [];
    for (const probe of probes()) {
      const res = await h.app.inject({ method: probe.method, url: probe.url, cookies, ...(probe.payload ? { payload: probe.payload as never } : {}) });
      const body = res.json() as Record<string, unknown>;
      // Timing is not an answer.
      if (body && typeof body === 'object' && 'meta' in body) delete (body['meta'] as Record<string, unknown>)['tookMs'];
      out.push({ url: probe.url, status: res.statusCode, body });
    }
    return out;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: a restricted administrator reads what the platform administrator reads', async (axis) => {
    const admin = await answers(ADMIN);
    const off = await withModuleOff('product_visibility_rules', axis, () => answers(fx.restricted.cookies));
    expect(off).toEqual(admin);
    const noCategory = await withModuleOff('product_visibility_rules', axis, () => answers(fx.noCategory.cookies));
    expect(noCategory).toEqual(admin);
  });

  it('while off, a write through a hidden product is not refused; on again, it is', async () => {
    const write = () =>
      h.app.inject({ method: 'PATCH', url: `${C}/products/${fx.hidden.id}`, cookies: fx.restricted.cookies, payload: { description: 'off-state write' } });
    const off = await withModuleOff('product_visibility_rules', 'deactivated', write);
    expect(off.statusCode, off.body).toBe(200);
    const on = await write();
    expect(on.statusCode).toBe(404);
    expect(on.json().error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('on again: the narrowing is back', async () => {
    const list = await h.app.inject({ method: 'GET', url: `${C}/products?pageSize=200`, cookies: fx.restricted.cookies });
    expect(list.json().visibility).toMatchObject({ restricted: true });
    expect(list.json().data.map((p: { id: string }) => p.id)).not.toContain(fx.hidden.id);
  });

  it('TM-3 (4): present but failing, the request answers 5xx — never unfiltered', async () => {
    const port = scopePort(h) as AdminProductVisibilityPort & { resolveScope: AdminProductVisibilityPort['resolveScope'] };
    const original = port.resolveScope;
    port.resolveScope = async () => {
      throw new Error('visibility scope unreadable (test)');
    };
    try {
      for (const probe of probes().slice(0, 4)) {
        const res = await h.app.inject({
          method: probe.method,
          url: probe.url,
          cookies: fx.restricted.cookies,
          ...(probe.payload ? { payload: probe.payload as never } : {}),
        });
        expect(res.statusCode, `${probe.url} ${res.body}`).toBeGreaterThanOrEqual(500);
      }
    } finally {
      port.resolveScope = original;
    }
  });
});
