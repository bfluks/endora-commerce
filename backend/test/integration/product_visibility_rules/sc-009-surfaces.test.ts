import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PromptActionTool, ToolContext } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { AvailabilityNotification, Product } from '../../helpers/package-entities.js';
import { ADMIN, call, flagsOf, roleWith, settleFlags, snapshotInventory, type TestRole } from './fixtures.js';

/**
 * Spec 193 T051 — the SC-009 sweep: for a restricted administrator every surface of FR-080 –
 * FR-085 (and the price-book row export of FR-094) returns or acts on zero hidden products, and no
 * error answer names a hidden product other than the one the caller addressed (FR-082). The
 * component tests (T045, T046, T048, T052 – T054, T102) hold each surface's behaviour; this one
 * sweeps them together over one fixture.
 */
describe('SC-009 — no surface of FR-080 – FR-085 gives a restricted administrator a hidden product (spec 193, T051)', () => {
  const P = '/api/v1/admin/catalog/products';
  const INV = '/api/v1/admin/inventory';
  const BOOKS = '/api/v1/admin/price-books';
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let sweeper: TestRole;
  let grouped: string;
  let bundle: string;
  let bookId: string;
  let warehouseId: string;
  let restoreInventory: (() => Promise<void>) | undefined;
  let hiddenSimple: { id: string; sku: string; name: string };
  let hidden: { slug: string; name: string };

  const inject = async (method: 'GET' | 'POST' | 'PUT', url: string, cookies: Record<string, string>, payload?: unknown) => {
    const res = await h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as never } : {}) });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };
  /** Every string that names a hidden product: ids, SKUs, names. */
  const marks = () => [fx.hidden.id, fx.hidden.variantId, fx.hidden.sku, hidden.name, hiddenSimple.id, hiddenSimple.sku, hiddenSimple.name];
  const expectClean = (raw: string, what: string) => {
    for (const mark of marks()) expect(raw, `${what} names ${mark}`).not.toContain(mark);
  };
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
    sweeper = await roleWith(
      h,
      ['rfqs:handle', 'catalog:read', 'catalog:write', 'price_lists:read', 'price_lists:write', 'inventory:read'],
      'cvs',
    );
    const mapped = await call(h, 'PUT', `/role-mappings/${sweeper.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);

    const em = h.em();
    const [row] = await em
      .getConnection()
      .execute<Array<{ slug: string; name: string }>>(`select "slug", "name" from "products" where "id" = ?`, [fx.hidden.id]);
    hidden = row!;
    const stamp = randomUUID().slice(0, 8);
    const make = (sku: string, type: 'simple' | 'grouped' | 'bundle') =>
      em.create(Product, {
        sku: `${sku}-${stamp}`,
        slug: `${sku.toLowerCase()}-${stamp}`,
        type,
        status: 'active',
        name: `${sku} ${stamp}`,
        description: sku,
        visibility: 'public',
        attributeValues: {},
      });
    const g = make('SG', 'grouped');
    const b = make('SB', 'bundle');
    const s = make('SH', 'simple');
    await em.persist([g, b, s]).flush();
    grouped = g.id;
    bundle = b.id;
    hiddenSimple = { id: s.id, sku: s.sku, name: `SH ${stamp}` };
    const tier = [{ minQuantity: 1, maxQuantity: null, amount: '10' }];
    for (const id of [grouped, bundle]) await fx.f.setBase({ id }, { product: tier, variants: {} });
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);

    // FR-080 — links, grouped items and bundle options to a visible and a hidden target.
    const links = await inject('POST', `${P}/${fx.visible.id}/links`, ADMIN, {
      links: [
        { targetProductId: fx.f.products.P3.id, kind: 'related' },
        { targetProductId: hiddenSimple.id, kind: 'related' },
      ],
    });
    expect(links.status, links.raw).toBe(201);
    for (const child of [fx.visible.id, hiddenSimple.id]) {
      const added = await inject('POST', `${P}/${grouped}/grouped-items`, ADMIN, { childProductId: child, quantity: 1 });
      expect(added.status, added.raw).toBe(201);
    }
    const slot = await inject('POST', `${P}/${bundle}/bundle-slots`, ADMIN, { name: { 'en-US': 'Slot' }, maxQuantity: 1 });
    expect(slot.status, slot.raw).toBe(201);
    for (const option of [fx.visible.id, hiddenSimple.id]) {
      const added = await inject('POST', `${P}/${bundle}/bundle-slots/${slot.body.data.id}/options`, ADMIN, { optionProductId: option });
      expect(added.status, added.raw).toBe(201);
    }

    // FR-084, FR-094 — a book with rows of both, so its history names both.
    bookId = (
      await fx.f.book({
        audience: 'everyone',
        rows: [
          { product: { id: fx.visible.id }, fixed: '92' },
          { product: { id: fx.hidden.id }, fixed: '42' },
          { product: { id: fx.hidden.id }, variant: fx.hidden.variantId, fixed: '43' },
        ],
      })
    ).id;

    // FR-083 — stock and a back-in-stock request for both.
    const warehouses = await inject('GET', '/api/v1/admin/warehouses', ADMIN);
    warehouseId = warehouses.body.items[0].id;
    restoreInventory = await snapshotInventory(h, [fx.visible.id, fx.hidden.id]);
    for (const productId of [fx.visible.id, fx.hidden.id]) {
      const set = await inject('PUT', `${INV}/levels`, ADMIN, { productId, warehouseId, onHand: 1 });
      expect(set.status, set.raw).toBe(200);
      em.create(AvailabilityNotification, { productId, email: `sc009-${randomUUID().slice(0, 8)}@example.test` });
    }
    await em.flush();
  }, 5 * 60_000);

  afterAll(async () => {
    await restoreInventory?.();
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('every read lists no hidden product (FR-080, FR-083, FR-084, FR-094)', async () => {
    const changes = await inject('GET', `${BOOKS}/${bookId}/price-history?limit=50`, ADMIN);
    expect(changes.status, changes.raw).toBe(200);
    const urls = [
      `${P}/${fx.visible.id}/links`,
      `${P}/${grouped}/grouped-items`,
      `${P}/${bundle}/bundle-slots`,
      INV,
      `${INV}/levels?pageSize=500`,
      `${INV}/levels?q=${encodeURIComponent(fx.hidden.sku)}`,
      `${INV}/low-stock`,
      `${INV}/legacy?limit=500`,
      `${INV}/availability-notifications?pageSize=200`,
      `${BOOKS}/${bookId}/rows?pageSize=1000`,
      `${BOOKS}/${bookId}/lines?pageSize=100`,
      `${BOOKS}/${bookId}/price-history/products/${fx.hidden.id}`,
      ...(changes.body.data as Array<{ id: string }>).map((c) => `${BOOKS}/${bookId}/price-history/${c.id}/lines?limit=100`),
    ];
    let adminSawHidden = 0;
    for (const url of urls) {
      const admin = await inject('GET', url, ADMIN);
      if (marks().some((m) => admin.raw.includes(m))) adminSawHidden += 1;
      const res = await inject('GET', url, sweeper.cookies);
      expect(res.status, `${url}: ${res.raw}`).toBe(200);
      expectClean(res.raw, url);
    }
    // The sweep is not vacuous: the platform administrator is shown hidden products on most of them.
    expect(adminSawHidden).toBeGreaterThanOrEqual(10);
  });

  it('the products export and import are refused, naming nothing (FR-085)', async () => {
    const exported = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', cookies: fx.restricted.cookies });
    expect(exported.statusCode, exported.body).toBe(403);
    expectClean(exported.body, 'products export');
  });

  it('no error answer names a hidden product the caller did not address (FR-082)', async () => {
    // A URL key a hidden product holds: refused by key only.
    const taken = await inject('PUT', `${P}/${fx.visible.id}/url-keys`, fx.restricted.cookies, { globalKey: hidden.slug });
    expect(taken.status, taken.raw).toBe(409);
    expectClean(taken.raw, 'URL_KEY_TAKEN');

    // An overlap with a hidden product's price-book row: refused without naming the row.
    const hiddenRow = (await inject('GET', `${BOOKS}/${bookId}/rows?pageSize=1000`, ADMIN)).body.data.find(
      (r: { selection: { productId: string | null; variantId: string | null } }) =>
        r.selection.productId === fx.hidden.id && r.selection.variantId === null,
    ) as { id: string };
    const overlap = await inject('PUT', `${BOOKS}/${bookId}/rows?dryRun=true`, sweeper.cookies, {
      mode: 'merge',
      upsert: [{ selection: { productId: fx.hidden.id }, minQuantity: 5, maxQuantity: null, price: { type: 'fixed', amount: '1' } }],
    });
    expect(overlap.status, overlap.raw).toBe(200);
    expect(overlap.raw).not.toContain(hiddenRow.id);

    // A cross-reference to a hidden target answers as one to a missing product.
    const masked = (raw: string, id: string) => raw.split(id).join('<id>').replace(/"requestId":"[^"]+"/, '');
    const link = async (id: string) =>
      inject('POST', `${P}/${fx.visible.id}/links`, sweeper.cookies, { links: [{ targetProductId: id, kind: 'cross_sell' }] });
    const toHidden = await link(hiddenSimple.id);
    const missing = randomUUID();
    const toMissing = await link(missing);
    expect(toHidden.status).toBe(toMissing.status);
    expect(masked(toHidden.raw, hiddenSimple.id)).toBe(masked(toMissing.raw, missing));
  });

  it('assistant tools find and write no hidden product (FR-081)', async () => {
    const as = ctxOf(fx.restricted.adminUserId);
    const found = (await tool('catalog.search_products').execute({ q: fx.hidden.sku }, as)) as unknown[];
    expect(found).toEqual([]);
    const setStock = tool('inventory.set_stock_level');
    const asHidden = await errorOf(() => setStock.preview!({ productId: fx.hidden.id, warehouseId, quantity: 9 } as never, as));
    const asMissing = await errorOf(() => setStock.preview!({ productId: randomUUID(), warehouseId, quantity: 9 } as never, as));
    expect(asHidden).not.toBeNull();
    expect(asHidden).toEqual(asMissing);
    expect(await errorOf(() => setStock.execute({ productId: fx.hidden.id, warehouseId, quantity: 9 } as never, as))).toEqual(asMissing);
    const legacy = await inject('GET', `${INV}/legacy?productId=${fx.hidden.id}`, ADMIN);
    expect((legacy.body.data as Array<{ warehouseId: string; onHand: number }>).find((r) => r.warehouseId === warehouseId)?.onHand).toBe(1);
  });
});
