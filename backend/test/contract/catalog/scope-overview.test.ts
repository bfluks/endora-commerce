import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scopeOverviewResponseSchema, type ScopeOverviewResponse } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';
import { withModuleOff } from '../../helpers/off-state.js';

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

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel(['pl-PL', 'de-DE']);
    b2c = await insertChannel(['pl-PL', 'en-GB']);
    left = await insertChannel(['pl-PL']);
    await seedProductScopesAdmins(h);
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
          { channelId: b2b, status: 'inactive', minOrderQuantity: 4, languageStatuses: [{ languageCode: 'de-DE', status: 'active' }] },
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
    // Phase 11 (T080a, FR-041): `missing` on every cell of a member channel in a
    // language it offers, whatever its status; absent on every other cell.
    for (const c of data.cells) {
      const channel = data.channels.find((ch) => ch.channelId === c.channelId)!;
      if (channel.isMember && channel.languages.includes(c.languageCode)) expect(Array.isArray(c.missing)).toBe(true);
      else expect(c).not.toHaveProperty('missing');
    }

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
    expect(cell(data, b2b, 'pl-PL')).toMatchObject({ effectiveStatus: 'inactive', statusSource: 'channel', available: false });
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

  it('each kind of orphaned value override can be deleted, audited, and leaves the overview (T071a, FR-015)', async () => {
    const narrowedKey = `sov_narrow_${run}`;
    const goneKey = `sov_gone_${run}`;
    await createAttribute(narrowedKey);
    const productId = await createProduct([b2b, left]);
    await insertOverride(productId, 'name', left, 'pl-PL', 'Opuszczony'); // channel left
    await insertOverride(productId, 'name', b2b, 'fr-FR', 'Perceuse'); // language not offered
    await insertOverride(productId, narrowedKey, b2b, 'pl-PL', 'wartość'); // attribute narrowed
    await insertOverride(productId, goneKey, b2b, null, 'x'); // attribute that does not exist
    await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, productId]);
    const narrowed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${narrowedKey}`,
      ...admin,
      payload: { channelScoped: false },
    });
    expect(narrowed.statusCode).toBe(200);

    const before = await overview(productId);
    expect(before.orphans).toHaveLength(4);

    const deletes = [
      { attributeKey: 'name', channelId: left, languageCode: 'pl-PL' },
      { attributeKey: 'name', channelId: b2b, languageCode: 'fr-FR' },
      { attributeKey: narrowedKey, channelId: b2b, languageCode: 'pl-PL' },
      { attributeKey: goneKey, channelId: b2b, languageCode: null },
    ];
    // A catalogue reader cannot delete them (US4 #3).
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      ...reader,
      payload: { upserts: [], deletes },
    });
    expect(refused.statusCode).toBe(403);

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      ...admin,
      payload: { upserts: [], deletes },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { applied: { deleted: number } } }).data.applied.deleted).toBe(4);

    const after = await overview(productId);
    expect(after.orphans).toEqual([]);
    const audited = (await sql(
      `select count(*)::text as n from audit_log_entries
        where action = 'product.overrides_apply' and object_type = 'product' and object_id = ?`,
      [productId],
    )) as Array<{ n: string }>;
    expect(Number(audited[0]?.n ?? 0)).toBe(1);

    // An upsert into an orphaned slot is still refused.
    const upsert = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
      ...admin,
      payload: { upserts: [{ attributeKey: 'name', channelId: left, languageCode: 'pl-PL', value: { v: 'x' } }], deletes: [] },
    });
    expect(upsert.statusCode).toBe(422);
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

  describe('media and SEO scopes (Phase 21: T134a, T118a)', () => {
    async function seedImage(productId: string): Promise<string> {
      const assetId = randomUUID();
      await sql(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values (?, 'image', 'overview.jpg', 'image/jpeg', 1, ?, now(), now())`,
        [assetId, `https://cdn.test/${run}/${assetId}.jpg`],
      );
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${productId}/gallery`,
        ...admin,
        payload: { assetId },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    }

    it('lists gallery role / hidden overrides per channel and alt text per language, and their orphans (FR-041)', async () => {
      const productId = await createProduct([b2b, b2c, left]);
      const itemId = await seedImage(productId);
      const roles = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
        ...admin,
        payload: { channelId: b2b, roles: { baseImage: itemId } },
      });
      expect(roles.statusCode, roles.body).toBe(200);
      const patched = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`,
        ...admin,
        payload: { hiddenInChannels: [b2c, left], altText: { 'de-DE': 'Bild' } },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      // The product leaves `left`: its hidden row there stays and is an orphan.
      await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, productId]);

      const data = await overview(productId);
      expect(data.channelRows.find((r) => r.channelId === b2b)?.overriddenFields).toEqual(['media:roles']);
      expect(data.channelRows.find((r) => r.channelId === b2c)?.overriddenFields).toEqual(['media:hidden']);
      expect(data.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual(['media:altText']);
      expect(cell(data, b2b, 'de-DE').overriddenFields).toEqual(
        expect.arrayContaining([
          { field: 'media:roles', level: 'channel' },
          { field: 'media:altText', level: 'language' },
        ]),
      );
      expect(cell(data, b2c, 'pl-PL').overriddenFields).toEqual([{ field: 'media:hidden', level: 'channel' }]);
      expect(data.orphans).toEqual([{ field: 'media:hidden', channelId: left, languageCode: null, reason: 'not_a_member' }]);
    });

    it('lists attachment hidden channels and translations, packaging-unit names, and their orphans (T139a)', async () => {
      const productId = await createProduct([b2b, b2c, left]);
      const assetId = randomUUID();
      await sql(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values (?, 'pdf', 'overview.pdf', 'application/pdf', 1, ?, now(), now())`,
        [assetId, `https://cdn.test/${run}/${assetId}.pdf`],
      );
      const types = await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attachment-types', ...admin });
      const typeId = (types.json() as { data: Array<{ id: string }> }).data[0]?.id;
      expect(typeId, 'a seeded attachment type').toBeDefined();
      const attachment = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${productId}/attachments`,
        ...admin,
        payload: {
          assetId,
          attachmentTypeId: typeId,
          name: 'Data sheet',
          nameTranslations: { 'pl-PL': 'Karta katalogowa' },
          descriptionTranslations: { 'de-DE': 'Datenblatt' },
          hiddenInChannels: [b2c, left],
        },
      });
      expect(attachment.statusCode, attachment.body).toBe(201);
      const unit = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${productId}/packaging-units`,
        ...admin,
        payload: { name: 'Carton', baseQuantity: 6, nameTranslations: { 'de-DE': 'Kiste' } },
      });
      expect(unit.statusCode, unit.body).toBe(201);
      // The product leaves `left`: the attachment's hidden row there stays and is an orphan.
      await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, productId]);

      const data = await overview(productId);
      expect(data.channelRows.find((r) => r.channelId === b2c)?.overriddenFields).toEqual(['attachments:hidden']);
      expect(data.channelRows.find((r) => r.channelId === b2b)?.overriddenFields).toEqual([]);
      expect(data.languageColumns.find((c) => c.languageCode === 'pl-PL')?.overriddenFields).toEqual(['attachments:name']);
      expect(data.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual([
        'attachments:description',
        'packagingUnits:name',
      ]);
      expect(cell(data, b2c, 'pl-PL').overriddenFields).toEqual([
        { field: 'attachments:hidden', level: 'channel' },
        { field: 'attachments:name', level: 'language' },
      ]);
      expect(data.orphans).toEqual([
        { field: 'attachments:hidden', channelId: left, languageCode: null, reason: 'not_a_member' },
      ]);
    });

    it('lists an SEO override at L, C and C × L, and nothing (no error) while seo is off', async () => {
      const productId = await createProduct([b2b, b2c]);
      const put = async (payload: Record<string, unknown>): Promise<void> => {
        const res = await h.app.inject({
          method: 'PUT',
          url: `/api/v1/admin/seo/meta/product/${productId}`,
          ...admin,
          payload,
        });
        expect(res.statusCode, res.body).toBe(200);
      };
      await put({ locale: 'de-DE', title: 'Übersicht' });
      await put({ channelId: b2c, description: 'B2C' });
      await put({ channelId: b2b, locale: 'pl-PL', title: 'B2B PL', ogTitle: 'B2B PL OG' });
      try {
        const data = await overview(productId);
        expect(data.languageColumns.find((c) => c.languageCode === 'de-DE')?.overriddenFields).toEqual(['seo:title']);
        expect(data.channelRows.find((r) => r.channelId === b2c)?.overriddenFields).toEqual(['seo:description']);
        expect(cell(data, b2b, 'pl-PL').overriddenFields).toEqual([
          { field: 'seo:ogTitle', level: 'channel_language' },
          { field: 'seo:title', level: 'channel_language' },
        ]);
        expect(cell(data, b2b, 'de-DE').overriddenFields).toEqual([{ field: 'seo:title', level: 'language' }]);
        expect(cell(data, b2c, 'pl-PL').overriddenFields).toEqual([{ field: 'seo:description', level: 'channel' }]);

        await withModuleOff('seo', 'deactivated', async () => {
          const off = await overview(productId);
          expect(off.cells.flatMap((c) => c.overriddenFields.map((f) => f.field)).filter((f) => f.startsWith('seo:'))).toEqual([]);
          expect(off.languageColumns.flatMap((c) => c.overriddenFields)).toEqual([]);
        });
      } finally {
        await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
      }
    });
  });
});
