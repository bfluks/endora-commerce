import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductScopeWritePort, FieldPath } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { attachRuleBySql, clearWebsiteRules, isMember, websiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 T070 — FR-093 (I-4, N6, R-11): values written for a **governed** channel the product
 * is not on yet — because the rule has not admitted it — are stored by every writer (connector
 * `applyScopes`, the products CSV import, the admin save, copy to channels, the scopes update and
 * the URL-key write) and never put the product on the channel. An unrestricted admin reads them at
 * that scope; on admission the product appears on the channel with those values. A channel that is
 * neither a member nor governed is still `SCOPE_INVALID`, as today.
 */
describe('values pending admission on a governed channel (spec 193, T070, FR-093)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let home: string;
  let governed: string;
  let governedCode: string;
  let free: string;
  let colour: string;
  let product: string;
  let sku: string;
  const PL = 'pl-PL';
  const port = () => (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
  const inject = (method: 'PUT' | 'PATCH' | 'POST', path: string, payload: object) =>
    h.app.inject({ method, url: `/api/v1/admin/catalog/products/${product}${path}`, ...ADMIN, payload });

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    fx = scopedValuesFixture(() => h);
    colour = await fx.attribute({ key: 'pav_colour', valueType: 'select', options: ['red', 'blue'] });
    home = await fx.channel([PL]);
    governed = await fx.channel([PL]);
    free = await fx.channel([PL]);
    governedCode = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [governed]))[0]!.code;
    // Not meeting the rule yet: the product waits for admission to `governed`.
    product = await fx.product({ channels: [home], attributeValues: { [colour]: 'blue' } });
    sku = (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [product]))[0]!.sku;
    await attachRuleBySql(h, [governed], `Pending ${fx.run}`, {
      match: 'all',
      conditions: [{ kind: 'attribute_choice', attributeKey: colour, optionKeys: ['red'] }],
    });
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await fx.cleanup();
    await teardownBackendServer(h);
  });

  it('connector applyScopes stores the value and adds no membership', async () => {
    const result = await port().applyScopes(
      product,
      { cells: [{ scope: { level: 'channel_language', channelId: governed, languageCode: PL }, field: 'name' as FieldPath, op: { op: 'set', value: 'Connector name' } }] },
      { source: 'pim_connector' },
    );
    expect(result.refused).toEqual([]);
    expect(result.applied).toBe(1);
    expect(await isMember(h, governed, product)).toBe(false);
  });

  it('an unrestricted admin reads the pending value at the governed scope (R-11)', async () => {
    const data = await fx.read(product, { channelId: governed, languageCode: PL });
    expect(data.fields.name.value).toBe('Connector name');
    expect(data.fields.name.source).toBe('set');
  });

  it('the admin save stores the value and adds no membership', async () => {
    const res = await fx.put(product, { channelId: governed, languageCode: PL }, { description: 'Pending description' }, { version: (await fx.read(product)).version });
    expect(res.statusCode, res.body).toBe(200);
    expect(await isMember(h, governed, product)).toBe(false);
    expect((await fx.read(product, { channelId: governed, languageCode: PL })).fields.description.value).toBe('Pending description');
  });

  it('copy to channels writes the governed target and adds no membership', async () => {
    await fx.save(product, { channelId: home, languageCode: PL }, { name: 'Home name' });
    const res = await inject('POST', '/scoped-values/copy', {
      field: 'name',
      from: { channelId: home, languageCode: PL },
      toChannelIds: [governed],
      version: (await fx.read(product)).version,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await isMember(h, governed, product)).toBe(false);
    expect((await fx.read(product, { channelId: governed, languageCode: PL })).fields.name.value).toBe('Home name');
  });

  it('the scopes update stores a channel-scoped value and adds no membership', async () => {
    const res = await inject('PATCH', '/scopes', { channels: [{ channelId: governed, minOrderQuantity: 5 }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(await isMember(h, governed, product)).toBe(false);
    const [row] = await fx.sql<{ n: number }>(
      `select count(*)::int as n from product_channel_scopes where product_id = ? and sales_channel_id = ? and min_order_quantity is not null`,
      [product, governed],
    );
    expect(row!.n).toBe(1);
  });

  it('the URL-key write stores a key on the governed channel and adds no membership', async () => {
    const key = `pending-${fx.run}`;
    const res = await inject('PUT', '/url-keys', { channelKeys: [{ channelId: governed, languageCode: PL, key }] });
    expect(res.statusCode, res.body).toBe(200);
    expect(await isMember(h, governed, product)).toBe(false);
    const rows = await fx.sql(`select 1 from product_url_keys where product_id = ? and sales_channel_id = ? and key = ?`, [product, governed, key]);
    expect(rows).toHaveLength(1);
  });

  it('the products CSV import stores a scoped status and adds no membership', async () => {
    const profileId = await createImportProfile(h);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: [`sku,status,visibility,name,description,status@${governedCode}`, `${sku},,,,,inactive`].join('\n'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { imported: number; fieldErrors?: unknown[] } }).data;
    expect(data.fieldErrors ?? []).toEqual([]);
    expect(data.imported).toBe(1);
    expect(await isMember(h, governed, product)).toBe(false);
    const [row] = await fx.sql<{ status: string | null }>(
      `select status from product_channel_scopes where product_id = ? and sales_channel_id = ?`,
      [product, governed],
    );
    expect(row?.status).toBe('inactive');
  });

  it('a channel neither a member nor governed is still SCOPE_INVALID (FR-073)', async () => {
    const result = await port().applyScopes(
      product,
      { cells: [{ scope: { level: 'channel', channelId: free }, field: 'name' as FieldPath, op: { op: 'set', value: 'Nope' } }] },
      { source: 'pim_connector' },
    );
    expect(result.applied).toBe(0);
    expect(result.refused.map((r) => r.code)).toEqual(['SCOPE_INVALID']);
    const patch = await inject('PATCH', '/scopes', { channels: [{ channelId: free, minOrderQuantity: 5 }] });
    expect(patch.statusCode, patch.body).toBe(422);
    const read = await fx.readRaw(product, { channelId: free });
    expect(read.statusCode, read.body).toBe(422);
    expect(await isMember(h, free, product)).toBe(false);
  });

  it('on admission the product appears on the channel with the pending values (US4-6)', async () => {
    await fx.sql(`update products set attribute_values = jsonb_build_object(?::text, 'red') where id = ?`, [colour, product]);
    await websiteRules(h).reconcileAll();
    expect(await isMember(h, governed, product)).toBe(true);
    const data = await fx.read(product, { channelId: governed, languageCode: PL });
    expect(data.fields.name.value).toBe('Home name');
    expect(data.fields.description.value).toBe('Pending description');
    expect(data.validScopes.channels.map((c) => c.channelId)).toContain(governed);
  });
});
