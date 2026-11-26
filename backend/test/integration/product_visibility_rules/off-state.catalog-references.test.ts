import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Product } from '../../helpers/package-entities.js';
import { ADMIN, call, flagsOf, roleWith, settleFlags, type TestRole } from './fixtures.js';

/**
 * Spec 193 (FR-073, QA G3 of checkpoint 1) — with `product_visibility_rules` off (deactivated, or
 * unavailable on the platform) a restricted role is answered as with the module never installed on
 * the catalog's cross-references and refusals: a grouped product's items and a bundle's options list
 * the hidden product (FR-080), a URL key a hidden product holds names its holder (FR-082), a key a
 * hidden product's redirect holds is offered as a takeover (owner ruling 2026-11-26), and a price
 * book's header counts every row (FR-094). Each case first shows the narrowing with the module on,
 * so the off answer is not vacuous.
 */
describe('off state — catalog cross-references and refusals are as never installed (spec 193, FR-073)', () => {
  const P = '/api/v1/admin/catalog/products';
  const AXES = ['deactivated', 'platform-unavailable'] as const;
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let editor: TestRole;
  let grouped: string;
  let bundle: string;
  let slotId: string;
  let hiddenSimple: { id: string; slug: string };
  let channelId: string;
  let bookId: string;

  const inject = async (method: 'GET' | 'POST' | 'PUT', url: string, cookies: Record<string, string>, payload?: unknown) => {
    const res = await h.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };
  const offEach = async <T>(work: () => Promise<T>): Promise<T[]> => {
    const out: T[] = [];
    for (const axis of AXES) out.push(await withModuleOff('product_visibility_rules', axis, work));
    return out;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    editor = await roleWith(h, ['rfqs:handle', 'catalog:read', 'catalog:write', 'price_lists:read'], 'cvg');
    const mapped = await call(h, 'PUT', `/role-mappings/${editor.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);

    const em = h.em();
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
    const g = make('OG', 'grouped');
    const b = make('OB', 'bundle');
    const s = make('OH', 'simple');
    await em.persist([g, b, s]).flush();
    grouped = g.id;
    bundle = b.id;
    hiddenSimple = { id: s.id, slug: s.slug };
    // The parents are priced (visible); the simple child is not (hidden).
    for (const id of [grouped, bundle]) await fx.f.setBase({ id }, { product: [{ minQuantity: 1, maxQuantity: null, amount: '10' }], variants: {} });
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);

    for (const child of [fx.visible.id, hiddenSimple.id]) {
      const added = await inject('POST', `${P}/${grouped}/grouped-items`, ADMIN, { childProductId: child, quantity: 1 });
      expect(added.status, added.raw).toBe(201);
    }
    const slot = await inject('POST', `${P}/${bundle}/bundle-slots`, ADMIN, { name: { 'en-US': 'Slot' }, maxQuantity: 1 });
    expect(slot.status, slot.raw).toBe(201);
    slotId = slot.body.data.id;
    for (const option of [fx.visible.id, hiddenSimple.id]) {
      const added = await inject('POST', `${P}/${bundle}/bundle-slots/${slotId}/options`, ADMIN, { optionProductId: option });
      expect(added.status, added.raw).toBe(201);
    }

    channelId = fx.f.channels.CH1.id;
    for (const productId of [fx.visible.id, fx.hidden.id]) {
      await em
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`, [channelId, productId]);
    }

    bookId = (
      await fx.f.book({
        audience: 'everyone',
        rows: [
          { product: { id: fx.visible.id }, fixed: '92' },
          { product: { id: fx.hidden.id }, fixed: '42' },
        ],
      })
    ).id;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('FR-080: grouped items and bundle options list the hidden product', async () => {
    for (const url of [`${P}/${grouped}/grouped-items`, `${P}/${bundle}/bundle-slots`]) {
      const admin = await inject('GET', url, ADMIN);
      expect(admin.status, admin.raw).toBe(200);
      expect(admin.raw).toContain(hiddenSimple.id);
      const on = await inject('GET', url, editor.cookies);
      expect(on.status, on.raw).toBe(200);
      expect(on.raw, `${url} narrowed with the module on`).not.toContain(hiddenSimple.id);
      for (const off of await offEach(() => inject('GET', url, editor.cookies))) {
        expect(off.status, off.raw).toBe(200);
        expect(off.body).toEqual(admin.body);
      }
    }
  });

  it('FR-082: a URL key a hidden product holds names its holder', async () => {
    const [row] = await h.em().getConnection().execute<Array<{ slug: string }>>(`select "slug" from "products" where "id" = ?`, [fx.hidden.id]);
    const slug = row!.slug;
    const taken = () => inject('PUT', `${P}/${fx.visible.id}/url-keys`, editor.cookies, { globalKey: slug });
    const on = await taken();
    expect(on.status, on.raw).toBe(409);
    expect(on.raw).not.toContain(fx.hidden.id);
    for (const off of await offEach(taken)) {
      expect(off.status, off.raw).toBe(409);
      expect(off.body.error.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
      expect(off.body.error.details.conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ heldByProductId: fx.hidden.id })]));
    }
  });

  it('a key a hidden product\'s redirect holds is offered as a takeover, naming the holder', async () => {
    const stamp = randomUUID().slice(0, 8);
    const oldKey = `pvr-off-old-${stamp}`;
    for (const key of [oldKey, `pvr-off-new-${stamp}`]) {
      const res = await inject('PUT', `${P}/${fx.hidden.id}/url-keys`, ADMIN, { channelKeys: [{ channelId, key }] });
      expect(res.status, res.raw).toBe(200);
    }
    const claim = () => inject('PUT', `${P}/${fx.visible.id}/url-keys`, editor.cookies, { channelKeys: [{ channelId, key: oldKey }] });
    const on = await claim();
    expect(on.status, on.raw).toBe(409);
    expect(on.body.error.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    for (const off of await offEach(claim)) {
      expect(off.status, off.raw).toBe(409);
      expect(off.body.error).toMatchObject({
        code: ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
        details: { takeovers: [expect.objectContaining({ key: oldKey, losingProductId: fx.hidden.id })] },
      });
    }
  });

  it('FR-094: a price book header counts every row', async () => {
    const header = (cookies: Record<string, string>) => inject('GET', `/api/v1/admin/price-books/${bookId}`, cookies);
    const admin = (await header(ADMIN)).body.data;
    expect(admin.rowCount).toBe(2);
    expect((await header(editor.cookies)).body.data.rowCount).toBe(1);
    for (const off of await offEach(() => header(editor.cookies))) {
      expect(off.body.data).toEqual(admin);
    }
  });
});
