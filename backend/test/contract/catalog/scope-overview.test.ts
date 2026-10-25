import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { scopeOverviewResponseSchema, type ScopeOverviewResponse } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';

/**
 * Feature 163, Phase 9 (T067) — `GET /api/v1/admin/catalog/products/:id/scope-overview`
 * (`specs/163-product-data-scopes/contracts/admin-scopes-api.md` §3; US4, FR-015, FR-041).
 *
 * - each cell names the fields overridden there and the level they come from, and its
 *   effective status with its source (US4 #1);
 * - the channel row and the language column carry their own overrides;
 * - orphans: a channel the product left, a language the channel no longer offers, an
 *   attribute whose scope flags were narrowed — listed, never marking a cell (FR-015);
 * - a product in no channel offers the global and language scopes only (US4 #4);
 * - `catalog:read` reads it; the writes it leads to need `catalog:write` (US4 #3).
 *
 * Every channel is this file's own (per-run code, deleted in `afterAll` — the scope rows
 * and URL keys go with it by cascade); the attribute keys are per run.
 */
describe('Scope overview — GET /admin/catalog/products/:id/scope-overview (spec 163)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-scopes-no-catalog-session' } };
  const READER_ID = '00000000-0000-4000-8000-0000000162a1';
  const NO_CATALOG_ID = '00000000-0000-4000-8000-0000000162a2';

  let b2b: string;
  let b2c: string;
  let left: string;
  const channels: string[] = [];
  const products: string[] = [];

  const url = (productId: string): string => `/api/v1/admin/catalog/products/${productId}/scope-overview`;

  async function sql(statement: string, params: unknown[] = []): Promise<unknown> {
    return h.em().getConnection().execute(statement, params);
  }

  async function insertChannel(languages: string[]): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
       values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
      [id, `sov-${run}-${channels.length}`, JSON.stringify({ 'en-US': `overview ${run}` }), languages[0], JSON.stringify(languages)],
    );
    channels.push(id);
    return id;
  }

  async function createProduct(memberOf: string[], name: Record<string, string> = { 'en-US': 'Overview probe' }): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku: `SOV-${run}-${randomUUID().slice(0, 6)}`,
        type: 'simple',
        name,
        description: { 'en-US': 'Overview probe' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    products.push(id);
    // Creation binds a product to the default channel when it has none; the
    // member set here is exactly the one each test names.
    await sql(`delete from sales_channel_products where product_id = ?`, [id]);
    for (const channelId of memberOf) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
    }
    return id;
  }

  async function createAttribute(key: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attributes',
      ...admin,
      payload: {
        key,
        label: { 'en-US': key },
        labelDefault: key,
        type: 'input',
        isSearchable: false,
        isFilterable: false,
        isVariantAxis: false,
        channelScoped: true,
        languageScoped: true,
      },
    });
    expect(res.statusCode).toBe(201);
  }

  async function insertOverride(
    productId: string,
    attributeKey: string,
    channelId: string,
    languageCode: string | null,
    v: unknown,
  ): Promise<void> {
    await sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, ?, ?, ?::jsonb, now(), now())`,
      [productId, attributeKey, channelId, languageCode, JSON.stringify({ v })],
    );
  }

  async function insertUrlKey(productId: string, languageCode: string, channelId: string | null): Promise<void> {
    await sql(
      `insert into product_url_keys (id, product_id, language_code, sales_channel_id, key) values (?, ?, ?, ?, ?)`,
      [randomUUID(), productId, languageCode, channelId, `sov-${run}-${randomUUID().slice(0, 8)}`],
    );
  }

  async function overview(productId: string, who = admin): Promise<ScopeOverviewResponse['data']> {
    const res = await h.app.inject({ method: 'GET', url: url(productId), ...who });
    expect(res.statusCode).toBe(200);
    return scopeOverviewResponseSchema.parse(res.json()).data;
  }

  function cell(data: ScopeOverviewResponse['data'], channelId: string, languageCode: string) {
    const found = data.cells.find((c) => c.channelId === channelId && c.languageCode === languageCode);
    if (!found) throw new Error(`no cell ${channelId} × ${languageCode}`);
    return found;
  }

  /**
   * `product-scopes-api.test.ts` sets up the same role and admins for the same stub
   * sessions, and contract files may run in parallel: a lost insert race is retried
   * once against the row the other file wrote (same code, same permissions).
   */
  async function once<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (!(err instanceof UniqueConstraintViolationException)) throw err;
      return write();
    }
  }

  async function ensureRole(code: string, permissions: string[]): Promise<string> {
    return once(async () => {
      const em = h.em().fork();
      let role = await em.findOne(AdminRole, { code });
      if (!role) role = em.create(AdminRole, { code, name: code, permissions });
      else role.permissions = permissions;
      await em.persistAndFlush(role);
      return role.id;
    });
  }

  async function ensureAdmin(id: string, email: string, roleId: string): Promise<void> {
    await once(async () => {
      const em = h.em().fork();
      const existing = await em.findOne(AdminUser, { id });
      if (existing) {
        existing.adminRoleId = roleId;
        existing.status = 'active';
      } else {
        em.create(AdminUser, {
          id,
          email,
          passwordHash: 'x'.repeat(60),
          firstName: 'Product',
          lastName: 'Scopes',
          adminRoleId: roleId,
          status: 'active',
        });
      }
      await em.flush();
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel(['pl-PL', 'de-DE']);
    b2c = await insertChannel(['pl-PL', 'en-GB']);
    left = await insertChannel(['pl-PL']);
    const readerRole = await ensureRole('product_scopes_catalog_reader', ['catalog:read']);
    const noCatalogRole = await ensureRole('product_scopes_no_catalog', ['orders:read']);
    await ensureAdmin(READER_ID, 'product-scopes-reader@example.com', readerRole);
    await ensureAdmin(NO_CATALOG_ID, 'product-scopes-no-catalog@example.com', noCatalogRole);
  }, 60_000);

  afterAll(async () => {
    for (const id of products) await sql(`delete from product_value_overrides where product_id = ?`, [id]);
    for (const id of channels) await sql(`delete from sales_channels where id = ?`, [id]);
    await teardownBackendServer(h);
  });

  describe('gates (US4 #3, FR-084)', () => {
    it('answers 401 without an admin and 403 without catalog:read', async () => {
      const productId = await createProduct([b2b]);
      expect((await h.app.inject({ method: 'GET', url: url(productId) })).statusCode).toBe(401);
      expect((await h.app.inject({ method: 'GET', url: url(productId), ...noCatalog })).statusCode).toBe(403);
    });

    it('a catalogue reader reads the overview; the write it leads to answers 403', async () => {
      const productId = await createProduct([b2b]);
      await overview(productId, reader);
      const reset = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}/scopes`,
        ...reader,
        payload: { channels: [{ channelId: b2b, status: null }] },
      });
      expect(reset.statusCode).toBe(403);
    });

    it('answers 404 PRODUCT_NOT_FOUND for an unknown product', async () => {
      const res = await h.app.inject({ method: 'GET', url: url(randomUUID()), ...admin });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  it('names per cell the overridden fields, their level and the status source (US4 #1)', async () => {
    const productId = await createProduct([b2b, b2c], { 'en-US': 'Overview probe', 'de-DE': 'Übersicht' });
    const scoped = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/scopes`,
      ...admin,
      payload: {
        channels: [
          { channelId: b2b, status: 'draft', minOrderQuantity: 4, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] },
        ],
      },
    });
    expect(scoped.statusCode).toBe(200);
    await insertOverride(productId, 'name', b2b, 'pl-PL', 'B2B nazwa');
    await insertOverride(productId, 'description', b2b, null, 'B2B opis');
    await insertUrlKey(productId, 'de-DE', null);
    await insertUrlKey(productId, 'en-GB', b2c);

    const data = await overview(productId);
    expect(data.channels.map((c) => c.channelId).sort()).toEqual([b2b, b2c].sort());
    expect(data.channels.every((c) => c.isMember)).toBe(true);
    expect(data.languages).toEqual(['de-DE', 'en-GB', 'pl-PL']);
    expect(data.cells).toHaveLength(6);
    for (const c of data.cells) expect(c).not.toHaveProperty('missing');

    expect(cell(data, b2b, 'de-DE')).toMatchObject({
      effectiveStatus: 'active',
      statusSource: 'channel_language',
      available: true,
    });
    expect(cell(data, b2b, 'de-DE').overriddenFields).toEqual(
      expect.arrayContaining([
        { field: 'status', level: 'channel_language' },
        { field: 'minOrderQuantity', level: 'channel' },
        { field: 'description', level: 'channel' },
        { field: 'name', level: 'language' },
        { field: 'urlKey', level: 'language' },
      ]),
    );
    expect(cell(data, b2b, 'pl-PL')).toMatchObject({ effectiveStatus: 'draft', statusSource: 'channel', available: false });
    expect(cell(data, b2b, 'pl-PL').overriddenFields).toEqual(
      expect.arrayContaining([
        { field: 'status', level: 'channel' },
        { field: 'name', level: 'channel_language' },
      ]),
    );
    expect(cell(data, b2c, 'pl-PL')).toMatchObject({
      effectiveStatus: 'active',
      statusSource: 'global',
      available: true,
      overriddenFields: [],
    });
    expect(cell(data, b2c, 'en-GB').overriddenFields).toEqual([{ field: 'urlKey', level: 'channel_language' }]);
    // A language the channel does not offer is never available.
    expect(cell(data, b2c, 'de-DE')).toMatchObject({ available: false, overriddenFields: [] });

    expect(data.channelRows.find((r) => r.channelId === b2b)?.overriddenFields).toEqual([
      'status',
      'minOrderQuantity',
      'description',
    ]);
    expect(data.channelRows.find((r) => r.channelId === b2c)?.overriddenFields).toEqual([]);
    expect(data.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual(['name', 'urlKey']);
    expect(data.orphans).toEqual([]);
  });

  it('a global status or window change leaves the overrides listed (FR-013) and a closed window is not available', async () => {
    const productId = await createProduct([b2b]);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/scopes`,
      ...admin,
      payload: {
        channels: [{ channelId: b2b, window: { from: '2099-01-01T00:00:00.000Z', until: null } }],
      },
    });
    expect(res.statusCode).toBe(200);
    const data = await overview(productId);
    expect(cell(data, b2b, 'pl-PL')).toMatchObject({ effectiveStatus: 'active', available: false });
    expect(cell(data, b2b, 'pl-PL').overriddenFields).toContainEqual({ field: 'window', level: 'channel' });
  });

  it('lists orphans — channel left, language dropped, attribute narrowed — and never marks a cell with them (FR-015)', async () => {
    const attributeKey = `sov_${run}`;
    await createAttribute(attributeKey);
    const productId = await createProduct([b2b, left]);
    const scoped = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/scopes`,
      ...admin,
      payload: { channels: [{ channelId: left, status: 'inactive' }] },
    });
    expect(scoped.statusCode).toBe(200);
    await insertOverride(productId, 'name', left, 'pl-PL', 'Opuszczony');
    await insertUrlKey(productId, 'pl-PL', left);
    await insertOverride(productId, attributeKey, b2b, 'pl-PL', 'wartość');
    // The product leaves `left`: its rows there stay and are ignored.
    await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, productId]);
    // A language row and an override for a language `b2b` does not offer (dropped after the write).
    await sql(
      `insert into product_channel_language_scopes (product_id, sales_channel_id, language_code, status) values (?, ?, 'fr-FR', 'active')`,
      [productId, b2b],
    );
    await insertOverride(productId, 'name', b2b, 'fr-FR', 'Perceuse');
    // The attribute's scope is narrowed: its channel × language row is skipped by the resolver.
    const narrowed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${attributeKey}`,
      ...admin,
      payload: { languageScoped: false },
    });
    expect(narrowed.statusCode).toBe(200);

    const data = await overview(productId);
    expect(data.channels.find((c) => c.channelId === left)).toMatchObject({ isMember: false });
    expect(data.languages).toEqual(['de-DE', 'pl-PL']);
    expect(data.orphans).toEqual(
      expect.arrayContaining([
        { field: 'status', channelId: left, languageCode: null, reason: 'not_a_member' },
        { field: 'name', channelId: left, languageCode: 'pl-PL', reason: 'not_a_member' },
        { field: 'urlKey', channelId: left, languageCode: 'pl-PL', reason: 'not_a_member' },
        { field: 'status', channelId: b2b, languageCode: 'fr-FR', reason: 'language_not_offered' },
        { field: 'name', channelId: b2b, languageCode: 'fr-FR', reason: 'language_not_offered' },
        { field: `attribute:${attributeKey}`, channelId: b2b, languageCode: 'pl-PL', reason: 'attribute_scope_changed' },
      ]),
    );
    expect(data.orphans).toHaveLength(6);
    for (const c of data.cells) {
      expect(c.overriddenFields.map((f) => f.field)).not.toContain(`attribute:${attributeKey}`);
    }
    expect(cell(data, left, 'pl-PL')).toMatchObject({ available: false, statusSource: 'global', overriddenFields: [] });
    expect(cell(data, b2b, 'pl-PL')).toMatchObject({ statusSource: 'global', overriddenFields: [] });
    expect(data.channelRows.find((r) => r.channelId === left)).toEqual({ channelId: left, overriddenFields: [] });
  });

  it('a product in no channel offers the global and language scopes only (US4 #4)', async () => {
    const productId = await createProduct([], { 'en-US': 'Overview probe', 'de-DE': 'Übersicht' });
    await insertUrlKey(productId, 'de-DE', null);
    const data = await overview(productId);
    expect(data.channels).toEqual([]);
    expect(data.cells).toEqual([]);
    expect(data.channelRows).toEqual([]);
    expect(data.orphans).toEqual([]);
    // The languages axis is every active platform language.
    expect(data.languages.length).toBeGreaterThan(0);
    expect(data.languageColumns.map((c) => c.languageCode)).toEqual(data.languages);
  });
});
