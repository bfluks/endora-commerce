import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import {
  productFingerprint,
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, flagsOf, settleFlags } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T045 — FR-080 (OQ-D A), US1-16: a visible product's links, grouped items and bundle
 * options leave out targets hidden from a restricted caller, and naming a hidden target in a new
 * link, grouped item or bundle option answers exactly as naming a product that does not exist —
 * and writes nothing.
 */
const P = '/api/v1/admin/catalog/products';

describe('catalog cross-references — hidden targets left out (spec 193, T045)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let grouped: string;
  let bundle: string;
  let slotId: string;
  let visibleTarget: string;
  let hiddenTarget: string;

  const inject = async (method: 'GET' | 'POST', url: string, cookies: Record<string, string>, payload?: unknown) => {
    const res = await h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as never } : {}) });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };
  /** The answer with the asked id masked and the request id dropped. */
  const masked = (raw: string, id: string) => raw.split(id).join('<id>').replace(/"requestId":"[^"]+"/, '');

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
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
    const g = make('XG', 'grouped');
    const b = make('XB', 'bundle');
    const hiddenSimple = make('XH', 'simple');
    await em.persist([g, b, hiddenSimple]).flush();
    grouped = g.id;
    bundle = b.id;
    visibleTarget = fx.f.products.P3.id;
    const tier = [{ minQuantity: 1, maxQuantity: null, amount: '10' }];
    for (const id of [grouped, bundle]) await fx.f.setBase({ id }, { product: tier, variants: {} });
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);

    // As the platform administrator: links, grouped items and a bundle option to a visible and a hidden target.
    const hidden = hiddenSimple.id;
    hiddenTarget = hidden;

    const links = await inject('POST', `${P}/${fx.visible.id}/links`, ADMIN, {
      links: [
        { targetProductId: visibleTarget, kind: 'related' },
        { targetProductId: hidden, kind: 'related' },
      ],
    });
    expect(links.status, links.raw).toBe(201);
    for (const child of [fx.visible.id, hidden]) {
      const added = await inject('POST', `${P}/${grouped}/grouped-items`, ADMIN, { childProductId: child, quantity: 1 });
      expect(added.status, added.raw).toBe(201);
    }
    const slot = await inject('POST', `${P}/${bundle}/bundle-slots`, ADMIN, { name: { 'en-US': 'Slot' }, maxQuantity: 1 });
    expect(slot.status, slot.raw).toBe(201);
    slotId = slot.body.data.id;
    for (const option of [fx.visible.id, hidden]) {
      const added = await inject('POST', `${P}/${bundle}/bundle-slots/${slotId}/options`, ADMIN, { optionProductId: option });
      expect(added.status, added.raw).toBe(201);
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('links leave out a hidden target for a restricted caller; the administrator sees both', async () => {
    const restricted = await inject('GET', `${P}/${fx.visible.id}/links`, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    expect(restricted.body.data.map((l: { targetProductId: string }) => l.targetProductId)).toEqual([visibleTarget]);
    expect(restricted.raw).not.toContain(hiddenTarget);
    const admin = await inject('GET', `${P}/${fx.visible.id}/links`, ADMIN);
    expect(admin.body.data.map((l: { targetProductId: string }) => l.targetProductId).sort()).toEqual([visibleTarget, hiddenTarget].sort());
  });

  it('grouped items leave out a hidden child', async () => {
    const restricted = await inject('GET', `${P}/${grouped}/grouped-items`, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    expect(restricted.body.data.map((i: { childProductId: string }) => i.childProductId)).toEqual([fx.visible.id]);
    const admin = await inject('GET', `${P}/${grouped}/grouped-items`, ADMIN);
    expect(admin.body.data).toHaveLength(2);
  });

  it('bundle slots leave out a hidden option', async () => {
    const restricted = await inject('GET', `${P}/${bundle}/bundle-slots`, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    expect(restricted.body.data[0].options.map((o: { optionProductId: string }) => o.optionProductId)).toEqual([fx.visible.id]);
    const admin = await inject('GET', `${P}/${bundle}/bundle-slots`, ADMIN);
    expect(admin.body.data[0].options).toHaveLength(2);
  });

  it('naming a hidden target answers as naming a missing one, and writes nothing', async () => {
    const cases: Array<{ url: string; body: (id: string) => unknown; owner: string }> = [
      { url: `${P}/${fx.configurable.id}/links`, body: (id) => ({ links: [{ targetProductId: id, kind: 'cross_sell' }] }), owner: fx.configurable.id },
      { url: `${P}/${grouped}/grouped-items`, body: (id) => ({ childProductId: id, quantity: 2 }), owner: grouped },
      { url: `${P}/${bundle}/bundle-slots/${slotId}/options`, body: (id) => ({ optionProductId: id, defaultQuantity: 2 }), owner: bundle },
    ];
    for (const c of cases) {
      const before = await productFingerprint(h, c.owner);
      const target = fx.hidden.id;
      const missing = randomUUID();
      const asHidden = await inject('POST', c.url, fx.restricted.cookies, c.body(target));
      const asMissing = await inject('POST', c.url, fx.restricted.cookies, c.body(missing));
      expect(asHidden.status, `${c.url} ${asHidden.raw}`).toBe(404);
      expect(masked(asHidden.raw, target), c.url).toEqual(masked(asMissing.raw, missing));
      expect(await productFingerprint(h, c.owner), c.url).toEqual(before);
    }
  });

  it('an existing link, grouped item or bundle option to a hidden target answers as a missing one, and is not changed', async () => {
    const links = (await inject('GET', `${P}/${fx.visible.id}/links`, ADMIN)).body.data as Array<{ id: string; targetProductId: string }>;
    const hiddenLink = links.find((l) => l.targetProductId === hiddenTarget)!.id;
    const visibleLink = links.find((l) => l.targetProductId === visibleTarget)!.id;
    const items = (await inject('GET', `${P}/${grouped}/grouped-items`, ADMIN)).body.data as Array<{ id: string; childProductId: string }>;
    const hiddenItem = items.find((i) => i.childProductId === hiddenTarget)!.id;
    const slots = (await inject('GET', `${P}/${bundle}/bundle-slots`, ADMIN)).body.data as Array<{
      options: Array<{ id: string; optionProductId: string }>;
    }>;
    const hiddenOption = slots[0]!.options.find((o) => o.optionProductId === hiddenTarget)!.id;
    const cases: Array<{ method: 'PATCH' | 'PUT' | 'DELETE'; url: (id: string) => string; body?: (id: string) => unknown; owner: string; id: string }> = [
      { method: 'DELETE', url: (id) => `${P}/${fx.visible.id}/links/${id}`, owner: fx.visible.id, id: hiddenLink },
      {
        method: 'PUT',
        url: () => `${P}/${fx.visible.id}/links/related/order`,
        body: (id) => ({ linkIds: [visibleLink, id] }),
        owner: fx.visible.id,
        id: hiddenLink,
      },
      { method: 'PATCH', url: (id) => `${P}/${grouped}/grouped-items/${id}`, body: () => ({ quantity: 3 }), owner: grouped, id: hiddenItem },
      { method: 'DELETE', url: (id) => `${P}/${grouped}/grouped-items/${id}`, owner: grouped, id: hiddenItem },
      { method: 'DELETE', url: (id) => `${P}/${bundle}/bundle-slots/${slotId}/options/${id}`, owner: bundle, id: hiddenOption },
    ];
    for (const c of cases) {
      const missing = randomUUID();
      const send = async (id: string) => {
        const res = await h.app.inject({
          method: c.method,
          url: c.url(id),
          cookies: fx.restricted.cookies,
          ...(c.body ? { payload: c.body(id) as never } : {}),
        });
        return masked(res.body, id);
      };
      const before = await productFingerprint(h, c.owner);
      const rowsBefore = JSON.stringify([
        (await inject('GET', `${P}/${fx.visible.id}/links`, ADMIN)).body,
        (await inject('GET', `${P}/${grouped}/grouped-items`, ADMIN)).body,
        (await inject('GET', `${P}/${bundle}/bundle-slots`, ADMIN)).body,
      ]);
      const asHidden = await send(c.id);
      const asMissing = await send(missing);
      expect(asHidden, `${c.method} ${c.url('<id>')}`).toEqual(asMissing);
      expect(await productFingerprint(h, c.owner)).toEqual(before);
      expect(
        JSON.stringify([
          (await inject('GET', `${P}/${fx.visible.id}/links`, ADMIN)).body,
          (await inject('GET', `${P}/${grouped}/grouped-items`, ADMIN)).body,
          (await inject('GET', `${P}/${bundle}/bundle-slots`, ADMIN)).body,
        ]),
        `${c.method} ${c.url('<id>')} changed a row`,
      ).toEqual(rowsBefore);
    }
  });
});
