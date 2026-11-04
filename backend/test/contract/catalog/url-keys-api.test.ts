import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  productUrlKeysResponseSchema,
  type ProductUrlKeysResponse,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';

/**
 * Feature 163, Phase 16 (T101) — the admin URL-key routes
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §1–§3).
 *
 * - `GET|PUT /api/v1/admin/catalog/products/:id/url-keys` and
 *   `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` behind
 *   `catalog:read` / `catalog:write`, answered 401/403 before the body is read;
 * - `URL_KEY_TAKEN` names the holder; a takeover needs `confirmTakeover` and names
 *   the loser; nothing is written by a refused request;
 * - one audit row per write (`product.url_keys.update`) whose before / after hold
 *   every key and redirect row touched, and re-sending `before` restores the keys —
 *   or is refused with `URL_KEY_TAKEN` when one was taken since (R29, Q-D → A);
 * - `DELETE …/url-redirects/:id` audits the deleted row (`product.url_redirect.delete`);
 * - `GET` lists `redirects` while `seo` is present (its omission with `seo` off is
 *   Phase 17's `url-redirects-seo-off.test.ts`, T108);
 * - `product.updated.v1` with `changedFields: ['urlKeys']` (FR-082).
 *
 * The gate sessions are the catalogue reader and the admin without `catalog:read` of
 * `product-scopes-api.test.ts` (same users, same custom roles, ensured here too).
 */
describe('Product URL keys — admin routes (spec 163, T101)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
  const noCatalog = { cookies: { b2b_session: 'stub-product-scopes-no-catalog-session' } };
  const READER_ID = '00000000-0000-4000-8000-0000000162a1';
  const NO_CATALOG_ID = '00000000-0000-4000-8000-0000000162a2';

  const channels: string[] = [];
  const products: string[] = [];
  let chA: string;
  let chB: string;

  const k = (base: string): string => `${base}-${run}`;
  const url = (productId: string): string => `/api/v1/admin/catalog/products/${productId}/url-keys`;

  interface ErrorBody {
    error: { code: string; details?: Record<string, unknown> };
  }
  interface AuditRow {
    state_before: Record<string, unknown> | null;
    state_after: Record<string, unknown> | null;
  }

  async function insertChannel(languages: string[]): Promise<string> {
    const id = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into sales_channels (id, code, name, default_language, languages, default_currency, created_at, updated_at)
         values (?, ?, ?::jsonb, ?, ?::jsonb, 'PLN', now(), now())`,
        [id, `k162-${run}-${channels.length}`, JSON.stringify({ 'en-US': `162 key api ${run}` }), languages[0], JSON.stringify(languages)],
      );
    channels.push(id);
    return id;
  }

  async function insertProduct(name: string, slug: string, memberOf: string[] = [chA, chB]): Promise<string> {
    const id = randomUUID();
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into products (id, sku, slug, type, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', ?::jsonb, '{}', now(), now())`,
      [id, `K162-${run}-${products.length}`, slug, JSON.stringify({ 'en-US': name })],
    );
    for (const channelId of memberOf) {
      await conn.execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [channelId, id]);
    }
    products.push(id);
    return id;
  }

  async function put(productId: string, payload: unknown, who = admin) {
    return h.app.inject({ method: 'PUT', url: url(productId), ...who, payload: payload as object });
  }

  async function get(productId: string, who = admin) {
    return h.app.inject({ method: 'GET', url: url(productId), ...who });
  }

  async function read(productId: string): Promise<ProductUrlKeysResponse['data']> {
    const res = await get(productId);
    expect(res.statusCode, res.body).toBe(200);
    return productUrlKeysResponseSchema.parse(res.json()).data;
  }

  async function auditRows(productId: string, action: string): Promise<AuditRow[]> {
    return h
      .em()
      .getConnection()
      .execute<AuditRow[]>(
        `select state_before, state_after from audit_log_entries
          where action = ? and object_type = 'product' and object_id = ?
          order by acted_at`,
        [action, productId],
      );
  }

  async function snapshot(productId: string): Promise<string> {
    const conn = h.em().getConnection();
    return JSON.stringify([
      await conn.execute(`select slug from products where id = ?`, [productId]),
      await conn.execute(
        `select language_code, sales_channel_id, key from product_url_keys where product_id = ? order by 1, 2 nulls first`,
        [productId],
      ),
      await conn.execute(`select id, language_code, key from product_url_redirects where product_id = ? order by id`, [productId]),
    ]);
  }

  function captureUpdates(productId: string): { fields: () => string[][]; stop: () => void } {
    const seen: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === productId) seen.push(p.changedFields);
    });
    return { fields: () => seen, stop: off };
  }

  async function ensureRole(code: string, permissions: string[]): Promise<string> {
    const em = h.em();
    let role = await em.findOne(AdminRole, { code });
    if (!role) role = em.create(AdminRole, { code, name: code, permissions });
    else role.permissions = permissions;
    await em.persistAndFlush(role);
    return role.id;
  }

  async function ensureAdmin(id: string, email: string, roleId: string): Promise<void> {
    const em = h.em();
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
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    chA = await insertChannel(['pl-PL', 'de-DE']);
    chB = await insertChannel(['en-GB', 'pl-PL']);
    const readerRole = await ensureRole('product_scopes_catalog_reader', ['catalog:read']);
    const noCatalogRole = await ensureRole('product_scopes_no_catalog', ['orders:read']);
    await ensureAdmin(READER_ID, 'product-scopes-reader@example.com', readerRole);
    await ensureAdmin(NO_CATALOG_ID, 'product-scopes-no-catalog@example.com', noCatalogRole);
  }, 60_000);

  afterAll(async () => {
    const conn = h.em().getConnection();
    for (const id of products) await conn.execute(`delete from products where id = ?`, [id]);
    for (const id of channels) await conn.execute(`delete from sales_channels where id = ?`, [id]);
    await teardownBackendServer(h);
  });

  describe('gates — before the body is read', () => {
    it('401 without an admin on all three routes', async () => {
      const p = await insertProduct('Gate', k('gate'));
      expect((await h.app.inject({ method: 'GET', url: url(p) })).statusCode).toBe(401);
      expect((await h.app.inject({ method: 'PUT', url: url(p), payload: { globalKey: 'NOT A SLUG' } })).statusCode).toBe(401);
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${p}/url-redirects/${randomUUID()}` });
      expect(del.statusCode).toBe(401);
    });

    it('403 without catalog:read; a reader reads and is refused the writes', async () => {
      const p = await insertProduct('Gate 2', k('gate-2'));
      expect((await get(p, noCatalog)).statusCode).toBe(403);
      expect((await put(p, { globalKey: 'NOT A SLUG' }, noCatalog)).statusCode).toBe(403);
      expect((await get(p, reader)).statusCode).toBe(200);
      expect((await put(p, { globalKey: k('reader-write') }, reader)).statusCode).toBe(403);
      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${p}/url-redirects/${randomUUID()}`,
        ...reader,
      });
      expect(del.statusCode).toBe(403);
      expect((await read(p)).globalKey).toBe(k('gate-2'));
    });
  });

  describe('GET', () => {
    it('lists global, language and channel keys, the effective key per member channel × language with its URL, and redirects', async () => {
      const p = await insertProduct('Reader', k('reader'));
      const before = await read(p);
      expect(before).toMatchObject({ globalKey: k('reader'), languageKeys: [], channelKeys: [], redirects: [] });
      const effectiveA = before.effective.filter((e) => e.channelId === chA);
      expect(effectiveA.map((e) => e.languageCode).sort()).toEqual(['de-DE', 'pl-PL']);
      expect(effectiveA.every((e) => e.source === 'global' && e.key === k('reader'))).toBe(true);

      const res = await put(p, {
        languageKeys: [{ languageCode: 'pl-PL', key: k('czytnik') }],
        channelKeys: [{ channelId: chB, languageCode: 'pl-PL', key: k('czytnik-b') }],
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = productUrlKeysResponseSchema.parse(res.json()).data;
      expect(data.languageKeys).toEqual([{ languageCode: 'pl-PL', key: k('czytnik') }]);
      expect(data.channelKeys).toEqual([{ channelId: chB, languageCode: 'pl-PL', key: k('czytnik-b'), orphaned: false }]);
      const at = (channelId: string, languageCode: string) =>
        data.effective.find((e) => e.channelId === channelId && e.languageCode === languageCode);
      expect(at(chA, 'pl-PL')).toEqual({
        channelId: chA,
        languageCode: 'pl-PL',
        key: k('czytnik'),
        source: 'language',
        // Feature 167 — the channel prefixes its default language (the column default), so
        // even the default language's URL carries `/pl`; never `?lang=`.
        url: `/pl/p/${k('czytnik')}`,
      });
      expect(at(chB, 'pl-PL')).toMatchObject({ key: k('czytnik-b'), source: 'channel_language', url: `/pl/p/${k('czytnik-b')}` });
      expect(at(chB, 'en-GB')).toMatchObject({ key: k('reader'), source: 'global', url: `/en/p/${k('reader')}` });
      // With the setting off the default language (chB: en-GB) is unprefixed; others stay prefixed.
      await h.em().getConnection().execute(`update sales_channels set prefix_default_language = false where id = ?`, [chB]);
      await h.salesChannels.cache.invalidateAll();
      const off = productUrlKeysResponseSchema.parse((await get(p)).json()).data;
      const atOff = (languageCode: string) => off.effective.find((e) => e.channelId === chB && e.languageCode === languageCode);
      expect(atOff('en-GB')?.url).toBe(`/p/${k('reader')}`);
      expect(atOff('pl-PL')?.url).toBe(`/pl/p/${k('czytnik-b')}`);
      await h.em().getConnection().execute(`update sales_channels set prefix_default_language = true where id = ?`, [chB]);
      await h.salesChannels.cache.invalidateAll();
      expect(data.redirects?.map((r) => `${r.languageCode}:${r.key}`)).toEqual([`pl-PL:${k('reader')}`]);
    });

    it('marks a key of a channel the product left as orphaned', async () => {
      const p = await insertProduct('Leaver', k('leaver'));
      expect((await put(p, { channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: k('weg') }] })).statusCode).toBe(200);
      await h.em().getConnection().execute(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [chA, p]);
      const data = await read(p);
      expect(data.channelKeys).toEqual([{ channelId: chA, languageCode: 'de-DE', key: k('weg'), orphaned: true }]);
      expect(data.effective.some((e) => e.channelId === chA)).toBe(false);
    });

    it('404 PRODUCT_NOT_FOUND for an unknown product', async () => {
      const res = await get(randomUUID());
      expect(res.statusCode).toBe(404);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });
  });

  describe('PUT', () => {
    it('URL_KEY_TAKEN names the holder and writes nothing', async () => {
      const holder = await insertProduct('The holder', k('holder'));
      const p = await insertProduct('Writer', k('writer'));
      expect((await put(holder, { languageKeys: [{ languageCode: 'de-DE', key: k('taken') }] })).statusCode).toBe(200);
      const before = await snapshot(p);
      const res = await put(p, { languageKeys: [{ languageCode: 'de-DE', key: k('taken') }] });
      expect(res.statusCode).toBe(409);
      expect(res.json() as ErrorBody).toMatchObject({
        error: {
          code: ERROR_CODES.URL_KEY_TAKEN,
          details: { conflicts: [{ languageCode: 'de-DE', key: k('taken'), heldByProductId: holder, heldByProductName: 'The holder' }] },
        },
      });
      expect(await snapshot(p)).toBe(before);
      expect(await auditRows(p, 'product.url_keys.update')).toEqual([]);
    });

    it('a takeover requires confirmTakeover naming the loser; confirmed, it is one audit entry holding the removed row', async () => {
      const loser = await insertProduct('The loser', k('loser'));
      const p = await insertProduct('Taker', k('taker'));
      expect((await put(loser, { languageKeys: [{ languageCode: 'pl-PL', key: k('stary') }] })).statusCode).toBe(200);
      expect((await put(loser, { languageKeys: [{ languageCode: 'pl-PL', key: k('nowy') }] })).statusCode).toBe(200);
      const loserRedirect = (await read(loser)).redirects?.find((r) => r.key === k('stary'));
      expect(loserRedirect).toBeDefined();

      const asked = await put(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('stary') }] });
      expect(asked.statusCode).toBe(409);
      expect(asked.json() as ErrorBody).toMatchObject({
        error: {
          code: ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
          details: { takeovers: [{ languageCode: 'pl-PL', key: k('stary'), losingProductId: loser, losingProductName: 'The loser' }] },
        },
      });

      const ok = await put(p, {
        languageKeys: [{ languageCode: 'pl-PL', key: k('stary') }],
        confirmTakeover: [{ languageCode: 'pl-PL', key: k('stary') }],
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await read(loser)).redirects?.some((r) => r.key === k('stary'))).toBe(false);
      const rows = await auditRows(p, 'product.url_keys.update');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state_before).toMatchObject({
        languageKeys: [{ languageCode: 'pl-PL', key: null }],
        redirects: [{ id: loserRedirect!.id, productId: loser, languageCode: 'pl-PL', key: k('stary') }],
      });
      expect(rows[0]!.state_after).toMatchObject({
        languageKeys: [{ languageCode: 'pl-PL', key: k('stary') }],
        redirects: [{ productId: p, languageCode: 'pl-PL', key: k('taker') }],
        changedFields: ['urlKeys'],
      });
    });

    it('one audit entry and one product.updated.v1 urlKeys per write; a request that changes nothing writes neither', async () => {
      const p = await insertProduct('Audited', k('audited'));
      const events = captureUpdates(p);
      try {
        const res = await put(p, {
          globalKey: k('audited-2'),
          channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: k('de-a') }],
        });
        expect(res.statusCode, res.body).toBe(200);
        const rows = await auditRows(p, 'product.url_keys.update');
        expect(rows).toHaveLength(1);
        expect(rows[0]!.state_before).toMatchObject({
          globalKey: k('audited'),
          channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: null }],
          redirects: [],
        });
        expect(rows[0]!.state_after).toMatchObject({
          globalKey: k('audited-2'),
          channelKeys: [{ channelId: chA, languageCode: 'de-DE', key: k('de-a') }],
          redirects: [{ productId: p, languageCode: null, key: k('audited') }],
        });
        expect(events.fields()).toEqual([['urlKeys']]);

        const again = await put(p, { globalKey: k('audited-2') });
        expect(again.statusCode).toBe(200);
        expect(await auditRows(p, 'product.url_keys.update')).toHaveLength(1);
        expect(events.fields()).toHaveLength(1);
      } finally {
        events.stop();
      }
    });

    it('re-sending the audit before-state restores the keys (R29); refused with URL_KEY_TAKEN when one was taken since', async () => {
      const p = await insertProduct('Restorer', k('restore'));
      expect(
        (
          await put(p, {
            languageKeys: [{ languageCode: 'pl-PL', key: k('r-pl') }],
            channelKeys: [{ channelId: chB, languageCode: 'en-GB', key: k('r-en') }],
          })
        ).statusCode,
      ).toBe(200);
      const original = await read(p);
      const res = await put(p, {
        globalKey: k('restore-2'),
        languageKeys: [{ languageCode: 'pl-PL', key: k('r-pl-2') }],
        channelKeys: [{ channelId: chB, languageCode: 'en-GB', key: null }],
      });
      expect(res.statusCode, res.body).toBe(200);
      const [, last] = await auditRows(p, 'product.url_keys.update');
      expect(last).toBeDefined();

      const restored = await put(p, last!.state_before);
      expect(restored.statusCode, restored.body).toBe(200);
      const now = await read(p);
      expect(now.globalKey).toBe(original.globalKey);
      expect(now.languageKeys).toEqual(original.languageKeys);
      expect(now.channelKeys).toEqual(original.channelKeys);
      // No redirect equals a key the product currently holds in its language.
      for (const r of now.redirects ?? []) {
        if (r.languageCode === null) continue;
        expect(now.languageKeys.some((l) => l.languageCode === r.languageCode && l.key === r.key)).toBe(false);
      }

      // Move away again, let another product take the Polish key, then re-send.
      expect((await put(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('r-pl-3') }] })).statusCode).toBe(200);
      const rows = await auditRows(p, 'product.url_keys.update');
      const moveAway = rows[rows.length - 1]!;
      const other = await insertProduct('Interloper', k('interloper'));
      const taken = await put(other, {
        languageKeys: [{ languageCode: 'pl-PL', key: k('r-pl') }],
        confirmTakeover: [{ languageCode: 'pl-PL', key: k('r-pl') }],
      });
      expect(taken.statusCode, taken.body).toBe(200);
      const before = await snapshot(p);
      const refused = await put(p, moveAway.state_before);
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as ErrorBody).error).toMatchObject({
        code: ERROR_CODES.URL_KEY_TAKEN,
        details: { conflicts: [{ heldByProductId: other }] },
      });
      expect(await snapshot(p)).toBe(before);
    });

    it('400 VALIDATION_FAILED for a key outside the slug grammar; 404 for an unknown product', async () => {
      const p = await insertProduct('Grammar', k('grammar'));
      const bad = await put(p, { globalKey: 'Not A Slug' });
      expect(bad.statusCode).toBe(400);
      expect((bad.json() as ErrorBody).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      const missing = await put(randomUUID(), { globalKey: k('ghost') });
      expect(missing.statusCode).toBe(404);
      expect((missing.json() as ErrorBody).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });
  });

  describe('DELETE …/url-redirects/:redirectId', () => {
    it('deletes the row as an audited Command with the row as before; the current key is unchanged', async () => {
      const p = await insertProduct('Deleter', k('deleter'));
      expect((await put(p, { globalKey: k('deleter-2') })).statusCode).toBe(200);
      const redirect = (await read(p)).redirects?.find((r) => r.key === k('deleter'));
      expect(redirect).toBeDefined();
      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${p}/url-redirects/${redirect!.id}`,
        ...admin,
      });
      expect(res.statusCode).toBe(204);
      const after = await read(p);
      expect(after.redirects).toEqual([]);
      expect(after.globalKey).toBe(k('deleter-2'));
      const rows = await auditRows(p, 'product.url_redirect.delete');
      expect(rows).toHaveLength(1);
      expect(rows[0]!.state_before).toMatchObject({
        id: redirect!.id,
        productId: p,
        languageCode: null,
        key: k('deleter'),
      });
    });

    it("deleting the product removes its redirects in the product.delete Command (FR-072)", async () => {
      const p = await insertProduct('Doomed', k('doomed'));
      expect((await put(p, { globalKey: k('doomed-2') })).statusCode).toBe(200);
      expect((await put(p, { languageKeys: [{ languageCode: 'pl-PL', key: k('skazany') }] })).statusCode).toBe(200);
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${p}`, ...admin });
      expect(del.statusCode, del.body).toBe(204);
      const [left] = await h
        .em()
        .getConnection()
        .execute<Array<{ n: string }>>(`select count(*)::text as n from product_url_redirects where product_id = ?`, [p]);
      expect(Number(left?.n)).toBe(0);
      // The freed old key is a new product's to take.
      const q = await insertProduct('Successor', k('successor'));
      expect((await put(q, { languageKeys: [{ languageCode: 'pl-PL', key: k('doomed') }] })).statusCode).toBe(200);
    });

    it("404 URL_REDIRECT_NOT_FOUND for another product's redirect, or an unknown id", async () => {
      const owner = await insertProduct('Owner', k('owner'));
      const p = await insertProduct('Stranger', k('stranger'));
      expect((await put(owner, { globalKey: k('owner-2') })).statusCode).toBe(200);
      const theirs = (await read(owner)).redirects![0]!;
      for (const redirectId of [theirs.id, randomUUID(), 'not-a-uuid']) {
        const res = await h.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/catalog/products/${p}/url-redirects/${redirectId}`,
          ...admin,
        });
        expect(res.statusCode, redirectId).toBe(404);
        expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.URL_REDIRECT_NOT_FOUND);
      }
      expect((await read(owner)).redirects).toHaveLength(1);
    });
  });
});
