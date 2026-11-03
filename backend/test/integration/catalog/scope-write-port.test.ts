import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductScopeWritePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 19 (T120) — `catalogProductScopeWritePort.applyScopes`, the
 * scoped write a connector or importer uses
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §5,
 * research R17; FR-091, FR-093, US7 #9).
 *
 * - only the scopes named are written: an operator's override elsewhere stays
 *   (FR-091);
 * - a URL key another product holds — as a current key or as a redirect — is not
 *   written; the product keeps its previous key there and the outcome names the
 *   language, the key and the holder; no redirect is ever taken over (FR-093);
 * - the completeness gate does not run (A-6);
 * - one audited write per kind, `product.updated.v1` with the changed fields.
 *
 * Status values are written only as the contract enumerates them; nothing here
 * depends on a particular off value.
 */
describe('catalogProductScopeWritePort (spec 163, T120)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const products: string[] = [];
  let b2b: string;
  let b2c: string;
  let port: CatalogProductScopeWritePort;

  const k = (base: string): string => `${base}-${run}`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function insertChannel(label: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'pl-PL', '["pl-PL","en-US"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, `sw163-${run}-${label}`, JSON.stringify({ 'en-US': `163 scope write ${label}` })],
    );
    return id;
  }

  async function insertProduct(slug: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', ?::jsonb, '{}'::jsonb, now(), now())`,
      [id, `SW163-${run}-${products.length}`, slug, JSON.stringify({ 'en-US': `Scope write ${slug}` })],
    );
    for (const channel of [b2b, b2c]) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel, id]);
    }
    products.push(id);
    return id;
  }

  const statusOf = async (productId: string, channelId: string): Promise<string | null> =>
    (await sql<Array<{ status: string | null }>>(
      `select status from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [productId, channelId],
    ))[0]?.status ?? null;

  const languageKeyOf = async (productId: string, languageCode: string): Promise<string | null> =>
    (await sql<Array<{ key: string }>>(
      `select key from product_url_keys where product_id = ? and language_code = ? and sales_channel_id is null`,
      [productId, languageCode],
    ))[0]?.key ?? null;

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel('b2b');
    b2c = await insertChannel('b2c');
    port = h.container.resolve('catalogProductScopeWritePort') as CatalogProductScopeWritePort;
  });

  afterAll(async () => {
    if (h) {
      if (products.length > 0) {
        const list = products.map(() => '?').join(',');
        await sql(`delete from product_channel_language_scopes where product_id in (${list})`, products);
        await sql(`delete from product_channel_scopes where product_id in (${list})`, products);
        await sql(`delete from sales_channel_products where product_id in (${list})`, products);
        await sql(`delete from products where id in (${list})`, products);
      }
      await sql(`delete from sales_channels where id in (?, ?)`, [b2b, b2c]);
      await teardownBackendServer(h);
    }
  });

  it('writes only the named scopes and keeps an operator override elsewhere (FR-091)', async () => {
    const p = await insertProduct(k('connector'));
    // The operator's override in B2C, through the admin route.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${p}/scopes`,
      ...admin,
      payload: { channels: [{ channelId: b2c, status: 'inactive' }] },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    const updates: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const event = payload as unknown as { productId: string; changedFields: string[] };
      if (event.productId === p) updates.push(event.changedFields);
    });
    try {
      const result = await port.applyScopes(
        p,
        {
          status: [{ channelId: b2b, languageCode: null, value: 'inactive' }],
          orderRules: [{ channelId: b2b, minOrderQuantity: 5 }],
        },
        { source: 'test-connector' },
      );
      expect(result).toEqual({ urlKeys: [] });
    } finally {
      off();
    }
    expect(await statusOf(p, b2b)).toBe('inactive');
    expect(await statusOf(p, b2c)).toBe('inactive');
    const [rules] = await sql<Array<{ min_order_quantity: number | null }>>(
      `select min_order_quantity from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [p, b2b],
    );
    expect(rules!.min_order_quantity).toBe(5);
    expect(updates.flat()).toEqual(expect.arrayContaining(['scopedStatus', 'orderRules']));

    // `value: null` is "use inherited" for exactly the named scope.
    await port.applyScopes(p, { status: [{ channelId: b2b, languageCode: null, value: null }] }, { source: 'test' });
    expect(await statusOf(p, b2b)).toBeNull();
    expect(await statusOf(p, b2c)).toBe('inactive');
  });

  it('does not write a key another product holds, keeps the previous key, and names the holder (FR-093, US7 #9)', async () => {
    const holder = await insertProduct(k('holder'));
    const loser = await insertProduct(k('loser'));
    const p = await insertProduct(k('importing'));
    // The holder's current pl-PL key, and the loser's pl-PL redirect.
    expect(
      (await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/products/${holder}/url-keys`,
        ...admin,
        payload: { languageKeys: [{ languageCode: 'pl-PL', key: k('wiertarka') }] },
      })).statusCode,
    ).toBe(200);
    for (const key of [k('mlotek-old'), k('mlotek-new')]) {
      expect(
        (await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/catalog/products/${loser}/url-keys`,
          ...admin,
          payload: { languageKeys: [{ languageCode: 'pl-PL', key }] },
        })).statusCode,
      ).toBe(200);
    }
    await port.applyScopes(p, { urlKeys: [{ languageCode: 'pl-PL', channelId: null, key: k('wlasny') }] }, { source: 'test' });

    const result = await port.applyScopes(
      p,
      {
        urlKeys: [
          { languageCode: 'pl-PL', channelId: null, key: k('wiertarka') },
          { languageCode: 'pl-PL', channelId: b2b, key: k('mlotek-old') },
          { languageCode: 'en-US', channelId: null, key: k('english-key') },
        ],
      },
      { source: 'test' },
    );

    expect(result.urlKeys).toEqual([
      {
        written: false,
        issue: { languageCode: 'pl-PL', channelId: null, key: k('wiertarka'), heldByProductId: holder, kind: 'current' },
      },
      {
        written: false,
        issue: { languageCode: 'pl-PL', channelId: b2b, key: k('mlotek-old'), heldByProductId: loser, kind: 'redirect' },
      },
      { written: true },
    ]);
    // The previous key stays; the other product's redirect was not taken over.
    expect(await languageKeyOf(p, 'pl-PL')).toBe(k('wlasny'));
    expect(await languageKeyOf(p, 'en-US')).toBe(k('english-key'));
    const redirects = await sql<unknown[]>(
      `select 1 from product_url_redirects where product_id = ? and key = ?`,
      [loser, k('mlotek-old')],
    );
    expect(redirects).toHaveLength(1);
  });

  it('runs no completeness gate (A-6)', async () => {
    // A product with no pl-PL name and no pl-PL key switched on at (B2B, pl-PL): an
    // operator would be warned or refused by the gate; a connector is not.
    const p = await insertProduct(k('incomplete'));
    await expect(
      port.applyScopes(p, { status: [{ channelId: b2b, languageCode: 'pl-PL', value: 'active' }] }, { source: 'test' }),
    ).resolves.toEqual({ urlKeys: [] });
    const [row] = await sql<Array<{ status: string }>>(
      `select status from product_channel_language_scopes where product_id = ? and sales_channel_id = ? and language_code = 'pl-PL'`,
      [p, b2b],
    );
    expect(row!.status).toBe('active');
  });
});
