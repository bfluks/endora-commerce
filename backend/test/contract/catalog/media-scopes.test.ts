import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 21 (T130) — the gallery per sales channel and its alt text per
 * language (`specs/163-product-data-scopes/contracts/seo-media-attachments.md` §2;
 * data-model §7; research R14, R15; FR-076, FR-077, US9 #1–#3).
 *
 * - a channel's own base image / thumbnail is what that channel's product page, listing
 *   card and OG image use; other channels keep the global holder (US9 #1);
 * - an image hidden in a channel is never served there — not in the page's gallery, not
 *   as the card's image, not as the legacy asset twin — and is served elsewhere (US9 #2);
 * - one holder per role per channel (FR-076);
 * - the product's alt text at the request language, else the asset's alt text (US9 #3);
 * - writes: `catalog:write`, one `product.media.update` audit row per request whose
 *   `before` restores the item, `product.updated.v1` `['media']` after commit, a no-op
 *   writes and announces nothing; a non-member channel is `422 SCOPE_INVALID`, while
 *   clearing it is always allowed (FR-014, FR-015).
 *
 * The channels and the product are this file's own (per-run codes, deleted in
 * `afterAll`; the override rows go with them by cascade).
 */
describe('Gallery per channel, alt text per language (spec 163, T130)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const sku = `MS163-${run}`.toUpperCase();
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const channels: Array<{ id: string; code: string }> = [];
  const assets: string[] = [];
  let productId: string;
  let b2b: { id: string; code: string };
  let b2c: { id: string; code: string };
  let outside: { id: string; code: string };
  const items: Record<'hero' | 'side' | 'life', string> = { hero: '', side: '', life: '' };
  const urls: Record<'hero' | 'side' | 'life', string> = {
    hero: `https://cdn.test/${run}/hero.jpg`,
    side: `https://cdn.test/${run}/side.jpg`,
    life: `https://cdn.test/${run}/life.jpg`,
  };

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function insertChannel(label: string): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = `ms163-${run}-${label}`;
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, code, JSON.stringify({ 'en-US': `163 media ${label}` })],
    );
    const channel = { id, code };
    channels.push(channel);
    return channel;
  }

  async function seedAsset(url: string, altText: Record<string, string> | null): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, alt_text, created_at, updated_at)
       values (?, 'image', 'media.jpg', 'image/jpeg', 1024, ?, ?::jsonb, now(), now())`,
      [id, url, altText === null ? null : JSON.stringify(altText)],
    );
    assets.push(id);
    return id;
  }

  async function addItem(assetId: string, labels: string[]): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      ...admin,
      payload: { assetId, labels },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  type PdpGallery = Array<{ id: string; labels: string[]; asset: { url: string }; altText?: string | null }>;

  async function pdp(channel: { code: string }, language: string) {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productId}`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as {
      data: {
        gallery: PdpGallery;
        primaryAssetUrl: string | null;
        assets: Array<{ id: string }>;
        seo: { openGraph: { imageUrl: string | null } };
      };
    }).data;
  }

  async function card(channel: { code: string }): Promise<string | null> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(sku)}&limit=50`,
      headers: { 'x-sales-channel': channel.code, 'accept-language': 'en-US' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = (res.json() as { data: Array<{ id: string; primaryAssetUrl: string | null }> }).data.find(
      (p) => p.id === productId,
    );
    expect(found, 'the product is listed in the channel').toBeDefined();
    return found!.primaryAssetUrl;
  }

  async function putRoles(payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
      ...admin,
      payload,
    });
  }

  async function patchItem(itemId: string, payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`,
      ...admin,
      payload,
    });
  }

  function captureUpdates(): { fields: () => string[][]; stop: () => void } {
    const seen: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === productId) seen.push(p.changedFields);
    });
    return { fields: () => seen, stop: off };
  }

  const mediaAuditRows = async (): Promise<AuditLogEntry[]> =>
    h.em().fork().find(
      AuditLogEntry,
      { action: 'product.media.update', objectType: 'product', objectId: productId },
      { orderBy: { actedAt: 'asc' } },
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    b2b = await insertChannel('b2b');
    b2c = await insertChannel('b2c');
    outside = await insertChannel('outside');
    productId = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, visibility, allowed_organization_ids,
                             created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', '{"en-US":"Pallet rack"}'::jsonb, '{"en-US":"A rack."}'::jsonb,
               'public', '[]'::jsonb, now(), now())`,
      [productId, sku, `media-scopes-${run}`],
    );
    for (const channel of [b2b, b2c]) {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channel.id, productId]);
    }
    const hero = await seedAsset(urls.hero, { 'en-US': 'Rack, front' });
    const side = await seedAsset(urls.side, null);
    const life = await seedAsset(urls.life, { 'en-US': 'Rack in a warehouse', 'pl-PL': 'Regał w magazynie' });
    items.hero = await addItem(hero, ['base_image', 'thumbnail']);
    items.side = await addItem(side, ['small_image']);
    items.life = await addItem(life, []);
    // The legacy twin of the side image (the demo composition mirrors each legacy row
    // into the gallery): hiding the gallery item must hide it here too.
    await sql(`insert into product_assets (product_id, asset_id, position) values (?, ?, 0)`, [productId, side]);
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await sql(`delete from products where id = ?`, [productId]);
      for (const id of assets) await sql(`delete from assets where id = ?`, [id]);
      for (const channel of channels) await sql(`delete from sales_channels where id = ?`, [channel.id]);
      await teardownBackendServer(h);
    }
  });

  it('with no override every channel shows the global gallery (off state)', async () => {
    for (const channel of [b2b, b2c]) {
      const page = await pdp(channel, 'en-US');
      expect(page.gallery.map((g) => g.id)).toEqual([items.hero, items.side, items.life]);
      expect(page.gallery[0]!.labels).toEqual(['base_image', 'thumbnail']);
      expect(page.seo.openGraph.imageUrl).toBe(urls.hero);
      expect(await card(channel)).toBe(urls.hero);
    }
  });

  it('a B2B base image and thumbnail are what B2B serves; B2C keeps the global ones (US9 #1)', async () => {
    const updates = captureUpdates();
    const res = await putRoles({ channelId: b2b.id, roles: { baseImage: items.life, thumbnail: items.life } });
    updates.stop();
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown }).data).toEqual({
      channelId: b2b.id,
      roles: { baseImage: items.life, smallImage: null, thumbnail: items.life },
    });
    expect(updates.fields()).toEqual([['media']]);

    const b2bPage = await pdp(b2b, 'en-US');
    expect(b2bPage.gallery.find((g) => g.id === items.life)?.labels).toEqual(['base_image', 'thumbnail']);
    expect(b2bPage.gallery.find((g) => g.id === items.hero)?.labels).toEqual([]);
    expect(b2bPage.seo.openGraph.imageUrl).toBe(urls.life);
    expect(await card(b2b)).toBe(urls.life);

    const b2cPage = await pdp(b2c, 'en-US');
    expect(b2cPage.gallery.find((g) => g.id === items.hero)?.labels).toEqual(['base_image', 'thumbnail']);
    expect(b2cPage.seo.openGraph.imageUrl).toBe(urls.hero);
    expect(await card(b2c)).toBe(urls.hero);
  });

  it('holds one image per role per channel, and lists the channel roles (FR-076)', async () => {
    expect((await putRoles({ channelId: b2b.id, roles: { baseImage: items.side } })).statusCode).toBe(200);
    const page = await pdp(b2b, 'en-US');
    expect(page.gallery.filter((g) => g.labels.includes('base_image')).map((g) => g.id)).toEqual([items.side]);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
      ...admin,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown }).data).toEqual([
      { channelId: b2b.id, roles: { baseImage: items.side, smallImage: null, thumbnail: items.life } },
    ]);
    // Back to the life image for the cases below.
    expect((await putRoles({ channelId: b2b.id, roles: { baseImage: items.life } })).statusCode).toBe(200);
  });

  it('an image hidden in B2B is never served there and still is in B2C (US9 #2)', async () => {
    const res = await patchItem(items.side, { hiddenInChannels: [b2b.id] });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { hiddenInChannels: string[] } }).data.hiddenInChannels).toEqual([b2b.id]);

    const b2bPage = await pdp(b2b, 'en-US');
    expect(b2bPage.gallery.map((g) => g.id)).toEqual([items.hero, items.life]);
    expect(b2bPage.gallery.flatMap((g) => g.labels)).not.toContain('small_image');
    expect(JSON.stringify(b2bPage)).not.toContain(urls.side);

    const b2cPage = await pdp(b2c, 'en-US');
    expect(b2cPage.gallery.map((g) => g.id)).toEqual([items.hero, items.side, items.life]);
  });

  it('a hidden holder leaves its role to nobody: the card moves on down its chain', async () => {
    expect((await patchItem(items.life, { hiddenInChannels: [b2b.id] })).statusCode).toBe(200);
    const page = await pdp(b2b, 'en-US');
    expect(page.gallery.map((g) => g.id)).toEqual([items.hero]);
    expect(page.gallery[0]!.labels).toEqual([]);
    // No thumbnail, no base image in B2B: the first visible item.
    expect(await card(b2b)).toBe(urls.hero);
    expect((await patchItem(items.life, { hiddenInChannels: [] })).statusCode).toBe(200);
    expect(await card(b2b)).toBe(urls.life);
  });

  it("serves the product's alt text at the language, else the asset's (US9 #3)", async () => {
    const res = await patchItem(items.hero, { altText: { 'pl-PL': 'Regał, przód' } });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { altText: Record<string, string> } }).data.altText).toEqual({
      'pl-PL': 'Regał, przód',
    });

    const polish = await pdp(b2c, 'pl-PL');
    expect(polish.gallery.find((g) => g.id === items.hero)?.altText).toBe('Regał, przód');
    const english = await pdp(b2c, 'en-US');
    expect(english.gallery.find((g) => g.id === items.hero)?.altText).toBe('Rack, front');
    // No product alt, an asset alt per language: the asset's at the language.
    expect(polish.gallery.find((g) => g.id === items.life)?.altText).toBe('Regał w magazynie');
    // Neither: none.
    expect(english.gallery.find((g) => g.id === items.side)?.altText).toBeNull();
  });

  it('audits each write once with a before that restores it, and a no-op writes nothing (FR-080, FR-081)', async () => {
    const before = (await mediaAuditRows()).length;
    const res = await patchItem(items.hero, { altText: { 'de-DE': 'Regal, vorne', 'pl-PL': '' } });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await mediaAuditRows();
    expect(rows).toHaveLength(before + 1);
    const row = rows.at(-1)!;
    expect(row.stateBefore).toMatchObject({
      itemId: items.hero,
      altText: { 'de-DE': '', 'pl-PL': 'Regał, przód' },
      hiddenInChannels: [],
    });
    expect(row.stateAfter).toMatchObject({
      itemId: items.hero,
      altText: { 'de-DE': 'Regal, vorne', 'pl-PL': '' },
      changedFields: ['media'],
    });
    // No route-level row beside the Command's (one audit entry per request).
    const routeRows = await h
      .em()
      .fork()
      .find(AuditLogEntry, { action: 'gallery.update', objectId: items.hero });
    expect(routeRows).toHaveLength(0);

    // Re-sending `before` restores the item.
    const { itemId: _itemId, ...restore } = row.stateBefore as Record<string, unknown>;
    expect((await patchItem(items.hero, restore)).statusCode).toBe(200);
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      ...admin,
    });
    const restored = (list.json() as { data: Array<{ id: string; altText: Record<string, string> }> }).data;
    expect(restored.find((item) => item.id === items.hero)?.altText).toEqual({ 'pl-PL': 'Regał, przód' });

    const updates = captureUpdates();
    const count = (await mediaAuditRows()).length;
    expect((await patchItem(items.hero, { altText: { 'pl-PL': 'Regał, przód' } })).statusCode).toBe(200);
    expect((await putRoles({ channelId: b2b.id, roles: { baseImage: items.life } })).statusCode).toBe(200);
    updates.stop();
    expect(await mediaAuditRows()).toHaveLength(count);
    expect(updates.fields()).toEqual([]);
  });

  it('audits a label change, a reorder and a delete once each, inside the Command (checkpoint F, B-1, S-4)', async () => {
    const auditRows = (action: string, objectId: string) =>
      h.em().fork().find(AuditLogEntry, { action, objectId });
    const count = (await mediaAuditRows()).length;
    const updates = captureUpdates();

    // A labels-only body is one product.media.update entry naming the labels.
    const swap = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${items.life}?replace=true`,
      ...admin,
      payload: { labels: ['small_image'] },
    });
    expect(swap.statusCode, swap.body).toBe(200);
    let rows = await mediaAuditRows();
    expect(rows).toHaveLength(count + 1);
    expect(rows.at(-1)!.stateBefore).toMatchObject({ itemId: items.life, labels: [] });
    expect(rows.at(-1)!.stateAfter).toMatchObject({ itemId: items.life, labels: ['small_image'], changedFields: ['media'] });
    expect(await auditRows('gallery_item.update', items.life)).toHaveLength(0);

    // Put the label back where it was (two more entries).
    expect((await patchItem(items.life, { labels: [] })).statusCode).toBe(200);
    expect((await patchItem(items.side, { labels: ['small_image'] })).statusCode).toBe(200);

    // A reorder is one entry with the order before and after; re-sending before restores it.
    const order = (ids: string[]) =>
      h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/products/${productId}/gallery/order`,
        ...admin,
        payload: { orderedGalleryItemIds: ids },
      });
    expect((await order([items.life, items.side, items.hero])).statusCode).toBe(204);
    rows = await mediaAuditRows();
    expect(rows).toHaveLength(count + 4);
    expect(rows.at(-1)!.stateBefore).toEqual({ orderedGalleryItemIds: [items.hero, items.side, items.life] });
    expect(rows.at(-1)!.stateAfter).toMatchObject({ orderedGalleryItemIds: [items.life, items.side, items.hero] });
    expect(await auditRows('gallery.reorder', productId)).toHaveLength(0);
    expect((await order([items.hero, items.side, items.life])).statusCode).toBe(204);
    expect((await order([items.hero, items.side, items.life])).statusCode).toBe(204);
    expect(await mediaAuditRows()).toHaveLength(count + 5);
    updates.stop();
    expect(updates.fields()).toHaveLength(5);

    // A delete is the service's one gallery_item.delete entry, with no route-level twin.
    const extra = await addItem(await seedAsset(`https://cdn.test/${run}/extra.jpg`, null), []);
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/${extra}`,
      ...admin,
    });
    expect(removed.statusCode).toBe(204);
    expect(await auditRows('gallery_item.delete', extra)).toHaveLength(1);
    expect(await auditRows('gallery.delete', extra)).toHaveLength(0);
  });

  it('refuses a channel the product is not a member of, and always allows clearing (FR-014, FR-015)', async () => {
    const hide = await patchItem(items.side, { hiddenInChannels: [b2b.id, outside.id] });
    expect(hide.statusCode).toBe(422);
    expect(hide.json()).toMatchObject({ error: { code: 'SCOPE_INVALID', details: { channelId: outside.id, reason: 'not_a_member' } } });

    const roles = await putRoles({ channelId: outside.id, roles: { baseImage: items.hero } });
    expect(roles.statusCode).toBe(422);
    expect(roles.json()).toMatchObject({ error: { code: 'SCOPE_INVALID' } });

    // An orphan (the product left B2B after B2B overrides were written) is clearable.
    await sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [b2b.id, productId]);
    try {
      expect((await putRoles({ channelId: b2b.id, roles: { thumbnail: null } })).statusCode).toBe(200);
      expect((await patchItem(items.side, { hiddenInChannels: [] })).statusCode).toBe(200);
    } finally {
      await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [b2b.id, productId]);
    }
  });

  it('refuses an item of another product and an unknown role, and gates on catalog:write', async () => {
    const foreign = await putRoles({ channelId: b2b.id, roles: { baseImage: randomUUID() } });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'GALLERY_ITEM_NOT_FOUND' } });
    expect((await putRoles({ channelId: b2b.id, roles: { hero: items.hero } })).statusCode).toBe(400);
    const anonymous = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/products/${productId}/gallery/channel-roles`,
      payload: { channelId: b2b.id, roles: {} },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
