import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 22 (T135) — attachments and packaging units per scope
 * (`specs/163-product-data-scopes/contracts/seo-media-attachments.md` §3–§4; data-model
 * §8; research R16; FR-078, FR-079, US9 #4, #5).
 *
 * - an attachment hidden in B2C is neither listed on the B2C product page nor named by
 *   it (its asset url is absent); B2B still lists it (US9 #4);
 * - attachment name and description at the request language, else the global ones;
 * - a packaging unit's name at the request language on the product page, else the
 *   global name (US9 #5);
 * - writes ride the existing Commands — `product_attachment.update` and
 *   `packaging_unit.update` — one audit entry per request (no route-level row beside
 *   it), whose `before` (minus `productId`) restores the row when re-sent;
 *   `product.updated.v1` with `['attachments']` / `['packagingUnits']`; a no-op writes and
 *   announces nothing (FR-080, FR-081);
 * - a new hidden channel must be one the product is a member of (`422 SCOPE_INVALID`),
 *   clearing is always allowed (FR-014, FR-015).
 *
 * The channels, the product and the assets are this file's own (per-run codes, deleted
 * in `afterAll`; the attachment, unit and hidden rows go with the product by cascade).
 */
describe('Attachments and packaging units per scope (spec 163, T135)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const sku = `AP163-${run}`.toUpperCase();
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const channels: Array<{ id: string; code: string }> = [];
  const assets: string[] = [];
  let productId: string;
  let b2b: { id: string; code: string };
  let b2c: { id: string; code: string };
  let outside: { id: string; code: string };
  let sheet: string;
  let cert: string;
  let unit: string;
  const certUrl = `https://cdn.test/${run}/cert.pdf`;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function insertChannel(label: string): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = `ap163-${run}-${label}`;
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `163 attachments ${label}` })],
    );
    const channel = { id, code };
    channels.push(channel);
    return channel;
  }

  async function seedAsset(url: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'pdf', 'doc.pdf', 'application/pdf', 2048, ?, now(), now())`,
      [id, url],
    );
    assets.push(id);
    return id;
  }

  async function attachmentTypeId(): Promise<string> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attachment-types', ...admin });
    expect(res.statusCode).toBe(200);
    const types = (res.json() as { data: Array<{ id: string }> }).data;
    if (types.length > 0) return types[0]!.id;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attachment-types',
      ...admin,
      payload: { code: `ap163_${run.replace(/-/g, '')}`, name: { 'en-US': 'Document' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { data: { id: string } }).data.id;
  }

  async function addAttachment(assetId: string, typeId: string, name: string, description: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      ...admin,
      payload: { assetId, attachmentTypeId: typeId, name, description },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const patchAttachment = (attachmentId: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/attachments/${attachmentId}`,
      ...admin,
      payload,
    });

  const patchUnit = (unitId: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/packaging-units/${unitId}`,
      ...admin,
      payload,
    });

  type PdpAttachment = { id: string; name: string; description: string | null; asset: { url: string } };

  async function pdp(channel: { code: string }, language: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productId}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: { attachments: PdpAttachment[]; packagingUnits?: Array<{ id: string; name: string }> };
    }).data;
  }

  function captureUpdates(): { fields: () => string[][]; stop: () => void } {
    const seen: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === productId) seen.push(p.changedFields);
    });
    return { fields: () => seen, stop: off };
  }

  const auditRows = (action: string, objectType: string, objectId: string): Promise<AuditLogEntry[]> =>
    h.em().fork().find(AuditLogEntry, { action, objectType, objectId }, { orderBy: { actedAt: 'asc' } });

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel('b2b');
    b2c = await insertChannel('b2c');
    outside = await insertChannel('outside');
    productId = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, visibility, allowed_organization_ids,
                             created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', '{"en-US":"Shelf"}'::jsonb, '{"en-US":"A shelf."}'::jsonb,
               'public', '[]'::jsonb, now(), now())`,
      [productId, sku, `attachment-packaging-${run}`],
    );
    for (const channel of [b2b, b2c]) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, productId]);
    }
    const typeId = await attachmentTypeId();
    sheet = await addAttachment(await seedAsset(`https://cdn.test/${run}/sheet.pdf`), typeId, 'Data sheet', 'Specs');
    cert = await addAttachment(await seedAsset(certUrl), typeId, 'Certificate', 'CE');
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/packaging-units`,
      ...admin,
      payload: { name: 'Carton', baseQuantity: 12, nameTranslations: { 'pl-PL': 'Karton' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const createdUnit = (created.json() as { data: { id: string; nameTranslations?: Record<string, string> } }).data;
    expect(createdUnit.nameTranslations).toEqual({ 'pl-PL': 'Karton' });
    unit = createdUnit.id;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await sql(`delete from products where id = ?`, [productId]);
      for (const id of assets) await sql(`delete from assets where id = ?`, [id]);
      for (const channel of channels) await sql(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  it('with no override every channel lists every attachment with its global texts (off state)', async () => {
    for (const channel of [b2b, b2c]) {
      const page = await pdp(channel, 'pl-PL');
      expect(page.attachments.map((a) => a.id)).toEqual([sheet, cert]);
      expect(page.attachments.map((a) => a.name)).toEqual(['Data sheet', 'Certificate']);
    }
  });

  it('an attachment hidden in B2C is neither listed nor named there; B2B lists it (US9 #4)', async () => {
    const updates = captureUpdates();
    const res = await patchAttachment(cert, { hiddenInChannels: [b2c.id] });
    updates.stop();
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { hiddenInChannels: string[] } }).data.hiddenInChannels).toEqual([b2c.id]);
    expect(updates.fields()).toEqual([['attachments']]);

    const b2cPage = await pdp(b2c, 'en-US');
    expect(b2cPage.attachments.map((a) => a.id)).toEqual([sheet]);
    expect(JSON.stringify(b2cPage)).not.toContain(certUrl);
    expect((await pdp(b2b, 'en-US')).attachments.map((a) => a.id)).toEqual([sheet, cert]);
  });

  it('serves the name and description at the language, else the global ones (FR-078)', async () => {
    const res = await patchAttachment(sheet, {
      nameTranslations: { 'pl-PL': 'Karta katalogowa' },
      descriptionTranslations: { 'pl-PL': 'Specyfikacja' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { nameTranslations: Record<string, string> } }).data.nameTranslations).toEqual({
      'pl-PL': 'Karta katalogowa',
    });
    const polish = (await pdp(b2b, 'pl-PL')).attachments.find((a) => a.id === sheet)!;
    expect(polish).toMatchObject({ name: 'Karta katalogowa', description: 'Specyfikacja' });
    const english = (await pdp(b2b, 'en-US')).attachments.find((a) => a.id === sheet)!;
    expect(english).toMatchObject({ name: 'Data sheet', description: 'Specs' });
  });

  it('serves the packaging-unit name at the language, else the global name (US9 #5)', async () => {
    expect((await pdp(b2b, 'pl-PL')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('Karton');
    expect((await pdp(b2b, 'en-US')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('Carton');
  });

  it('audits an attachment write once, with a before that restores it; a no-op writes nothing (FR-080, FR-081)', async () => {
    const count = (await auditRows('product_attachment.update', 'product_attachment', sheet)).length;
    const res = await patchAttachment(sheet, { nameTranslations: { 'de-DE': 'Datenblatt', 'pl-PL': '' } });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await auditRows('product_attachment.update', 'product_attachment', sheet);
    expect(rows).toHaveLength(count + 1);
    const row = rows.at(-1)!;
    expect(row.stateBefore).toMatchObject({
      productId,
      nameTranslations: { 'de-DE': '', 'pl-PL': 'Karta katalogowa' },
      descriptionTranslations: { 'pl-PL': 'Specyfikacja' },
      hiddenInChannels: [],
    });
    expect(row.stateAfter).toMatchObject({
      productId,
      nameTranslations: { 'de-DE': 'Datenblatt', 'pl-PL': '' },
      changedFields: ['attachments'],
    });
    // One audit entry per request: no route-level row beside the Command's.
    expect(await h.em().fork().find(AuditLogEntry, { action: 'attachment.update', objectId: sheet })).toHaveLength(0);

    const { productId: _productId, ...restore } = row.stateBefore as Record<string, unknown>;
    expect((await patchAttachment(sheet, restore)).statusCode).toBe(200);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      ...admin,
    });
    const restored = (list.json() as { data: Array<{ id: string; nameTranslations: Record<string, string> }> }).data;
    expect(restored.find((a) => a.id === sheet)?.nameTranslations).toEqual({ 'pl-PL': 'Karta katalogowa' });

    const updates = captureUpdates();
    const before = (await auditRows('product_attachment.update', 'product_attachment', sheet)).length;
    expect((await patchAttachment(sheet, { nameTranslations: { 'pl-PL': 'Karta katalogowa' } })).statusCode).toBe(200);
    updates.stop();
    expect(await auditRows('product_attachment.update', 'product_attachment', sheet)).toHaveLength(before);
    expect(updates.fields()).toEqual([]);
  });

  it('audits a packaging-unit write once, with a before that restores it (FR-080, FR-081)', async () => {
    const updates = captureUpdates();
    const res = await patchUnit(unit, { nameTranslations: { 'pl-PL': 'Karton zbiorczy' } });
    updates.stop();
    expect(res.statusCode, res.body).toBe(200);
    expect(updates.fields()).toEqual([['packagingUnits']]);
    const rows = await auditRows('packaging_unit.update', 'packaging_unit', unit);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateBefore).toMatchObject({ productId, nameTranslations: { 'pl-PL': 'Karton' } });
    expect(rows[0]!.stateAfter).toMatchObject({
      productId,
      nameTranslations: { 'pl-PL': 'Karton zbiorczy' },
      changedFields: ['packagingUnits'],
    });
    expect(
      await h
        .em()
        .fork()
        .find(AuditLogEntry, { action: 'packaging_unit.update', objectType: 'product_packaging_unit', objectId: unit }),
    ).toHaveLength(0);

    const { productId: _productId, ...restore } = rows[0]!.stateBefore as Record<string, unknown>;
    expect((await patchUnit(unit, restore)).statusCode).toBe(200);
    expect((await pdp(b2b, 'pl-PL')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('Karton');
  });

  it('refuses a channel the product is not a member of, and always allows clearing (FR-014, FR-015)', async () => {
    const hide = await patchAttachment(sheet, { hiddenInChannels: [b2b.id, outside.id] });
    expect(hide.statusCode).toBe(422);
    expect(hide.json()).toMatchObject({
      error: { code: 'SCOPE_INVALID', details: { channelId: outside.id, reason: 'not_a_member' } },
    });

    await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [b2c.id, productId]);
    try {
      expect((await patchAttachment(cert, { hiddenInChannels: [] })).statusCode).toBe(200);
    } finally {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [b2c.id, productId]);
    }
  });

  it('gates the writes on catalog:write', async () => {
    const anonymous = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/attachments/${sheet}`,
      payload: { hiddenInChannels: [] },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
