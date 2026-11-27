import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { Product, ProductValueOverride } from '../../helpers/package-entities.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, flagsOf, settleFlags } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T047 — FR-031, threat model TM-6: no catalog admin answer counts a product hidden from
 * a restricted caller. An attribute set's `productCount` (list, detail and the "still in use"
 * refusal), an attribute's usage and its scope-change preview are counted over visible products
 * only; the platform administrator's counts are unchanged.
 *
 * The category tree carries no product count on an admin route (`catalogCategoryReadPort`'s
 * `countLiveProductsByCategory` is a system read), so there is none to narrow here.
 */
const C = '/api/v1/admin/catalog';

describe('catalog admin aggregates — counted over visible products (spec 193, T047)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let setId: string;
  const attributeKey = `vis_agg_${randomUUID().slice(0, 6)}`;

  const get = async (url: string, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    const created = await h.app.inject({
      method: 'POST',
      url: `${C}/attribute-sets`,
      cookies: ADMIN,
      payload: { code: `vis_agg_${randomUUID().slice(0, 6)}`, name: { 'en-US': 'Visibility aggregates' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    setId = created.json().data.id;
    const attribute = await h.app.inject({
      method: 'POST',
      url: `${C}/attributes`,
      cookies: ADMIN,
      payload: {
        key: attributeKey,
        label: { 'en-US': 'Visibility aggregate' },
        labelDefault: 'Visibility aggregate',
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        scopable: true,
      },
    });
    expect(attribute.statusCode, attribute.body).toBe(201);

    // Two products of the set, both holding the attribute and a channel override of it: one priced
    // (visible to the restricted role), one not.
    const em = h.em();
    const stamp = randomUUID().slice(0, 8);
    const make = (sku: string) =>
      em.create(Product, {
        sku: `${sku}-${stamp}`,
        slug: `${sku.toLowerCase()}-${stamp}`,
        type: 'simple',
        status: 'active',
        name: `${sku} ${stamp}`,
        description: sku,
        visibility: 'public',
        attributeSetId: setId,
        attributeValues: { [attributeKey]: 'x' },
      });
    const shown = make('AGV');
    const hidden = make('AGH');
    await em.persist([shown, hidden]).flush();
    for (const product of [shown, hidden]) {
      em.create(ProductValueOverride, {
        productId: product.id,
        attributeKey,
        channelId: fx.f.channels.CH1.id,
        value: { v: 'y' },
      });
    }
    await em.flush();
    await fx.f.setBase({ id: shown.id }, { product: [{ minQuantity: 1, maxQuantity: null, amount: '3' }], variants: {} });
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('an attribute set\'s productCount — list and detail', async () => {
    const countIn = async (cookies: Record<string, string>) => {
      const list = await get(`${C}/attribute-sets`, cookies);
      expect(list.status, list.raw).toBe(200);
      const row = list.body.data.find((s: { id: string }) => s.id === setId);
      const detail = await get(`${C}/attribute-sets/${setId}`, cookies);
      expect(detail.status, detail.raw).toBe(200);
      return { list: row.productCount as number, detail: detail.body.data.productCount as number };
    };
    expect(await countIn(ADMIN)).toEqual({ list: 2, detail: 2 });
    expect(await countIn(fx.restricted.cookies)).toEqual({ list: 1, detail: 1 });
    expect(await countIn(fx.noCategory.cookies)).toEqual({ list: 0, detail: 0 });
  });

  it('the "still in use" refusal counts visible products only, and still refuses', async () => {
    const restricted = await h.app.inject({ method: 'DELETE', url: `${C}/attribute-sets/${setId}`, cookies: fx.restricted.cookies });
    expect(restricted.statusCode, restricted.body).toBe(409);
    expect(restricted.json().error.details).toEqual([{ path: 'productCount', issue: '1' }]);
    expect((await get(`${C}/attribute-sets/${setId}`, ADMIN)).status).toBe(200);
  });

  it('an attribute\'s usage counts visible products only', async () => {
    const admin = await get(`${C}/attributes/${attributeKey}/usage`, ADMIN);
    const restricted = await get(`${C}/attributes/${attributeKey}/usage`, fx.restricted.cookies);
    const none = await get(`${C}/attributes/${attributeKey}/usage`, fx.noCategory.cookies);
    expect(admin.status, admin.raw).toBe(200);
    expect(admin.body.data.productValueCount).toBe(2);
    expect(restricted.body.data.productValueCount).toBe(1);
    expect(none.body.data.productValueCount).toBe(0);
  });

  it('an attribute\'s scope-change preview counts visible products\' overrides only', async () => {
    const url = `${C}/attributes/${attributeKey}/scope-change-preview?scopable=false`;
    const admin = await get(url, ADMIN);
    const restricted = await get(url, fx.restricted.cookies);
    const none = await get(url, fx.noCategory.cookies);
    expect(admin.status, admin.raw).toBe(200);
    expect(admin.body.data.orphanedOverrides).toBe(2);
    expect(restricted.body.data.orphanedOverrides).toBe(1);
    expect(none.body.data).toEqual({ orphanedOverrides: 0, byChannel: [] });
  });
});
