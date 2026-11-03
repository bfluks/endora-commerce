import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 163, Phase 18 (T114) — SEO overrides per sales channel × language
 * (`specs/163-product-data-scopes/data-model.md` §6, `contracts/seo-media-attachments.md`
 * §1, research R13; FR-014, FR-015, FR-075, US8 #2).
 *
 * - a row is a language (L), channel (C) or channel × language (C×L) row; each
 *   field resolves C×L → C → L → the derived value, independently;
 * - a row written the pre-163 way (locale only) is an L row, unchanged;
 * - one row per address: writing the same address twice updates it;
 * - only products take a channel (`422 VALIDATION_FAILED` for any other entity);
 * - a channel the product is not in, or a language the channel does not offer, is
 *   `422 SCOPE_INVALID` on PUT — and allowed on DELETE (removing an orphan).
 */
describe('SEO meta overrides per channel × language (spec 163, T114)', () => {
  let h: BackendServerHandle;
  const run = randomUUID().slice(0, 8);
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  let productId: string;
  let member: string;
  let stranger: string;

  async function sql<T = unknown[]>(query: string, params: unknown[] = []): Promise<T> {
    return h.em().getConnection().execute(query, params) as Promise<T>;
  }

  async function insertChannel(label: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into sales_channels (id, code, name, default_language, languages, currencies, default_currency,
                                   active, created_at, updated_at)
       values (?, ?, ?::jsonb, 'en-US', '["en-US","pl-PL"]'::jsonb, '["PLN"]'::jsonb, 'PLN', true, now(), now())`,
      [id, `ms163-${run}-${label}`, JSON.stringify({ 'en-US': `163 meta ${label}` })],
    );
    return id;
  }

  const url = (query = ''): string => `/api/v1/admin/seo/meta/product/${productId}${query}`;
  const put = (payload: Record<string, unknown>) => h.app.inject({ method: 'PUT', url: url(), ...admin, payload });

  async function resolved(query: string): Promise<{ title: string; description: string; source: string }> {
    const res = await h.app.inject({ method: 'GET', url: url(query), ...admin });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { resolved: { title: string; description: string; source: string } } }).data.resolved;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    member = await insertChannel('member');
    stranger = await insertChannel('stranger');
    productId = randomUUID();
    await sql(
      `insert into products (id, sku, slug, type, status, name, description, created_at, updated_at)
       values (?, ?, ?, 'simple', 'active', '{"en-US":"Derived name","pl-PL":"Nazwa"}'::jsonb,
               '{"en-US":"Derived description"}'::jsonb, now(), now())`,
      [productId, `MS163-${run}`, `meta-scope-${run}`],
    );
    await sql(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [member, productId]);
  });

  afterAll(async () => {
    if (h) {
      await sql(`delete from seo_meta_overrides where entity_id = ?`, [productId]);
      await sql(`delete from sales_channel_products where product_id = ?`, [productId]);
      await sql(`delete from products where id = ?`, [productId]);
      await sql(`delete from sales_channels where id in (?, ?)`, [member, stranger]);
      await teardownBackendServer(h);
    }
  });

  it('keeps a pre-163 row as the language scope, unchanged (US8 #2)', async () => {
    // The shape every row had before the migration: a locale, no channel.
    await sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, locale, title, created_at, updated_at)
       values (?, 'product', ?, 'pl-PL', 'Legacy PL title', now(), now())`,
      [randomUUID(), productId],
    );
    expect(await resolved('?locale=pl-PL')).toMatchObject({ title: 'Legacy PL title', source: 'override' });
    expect(await resolved(`?channelId=${member}&locale=pl-PL`)).toMatchObject({ title: 'Legacy PL title' });
  });

  it('walks C×L → C → L → derived per field', async () => {
    expect((await put({ channelId: member, title: 'C title', description: 'C description' })).statusCode).toBe(200);
    expect((await put({ channelId: member, locale: 'pl-PL', title: 'CxL title' })).statusCode).toBe(200);

    // (member, pl-PL): title from C×L, description from C.
    expect(await resolved(`?channelId=${member}&locale=pl-PL`)).toMatchObject({
      title: 'CxL title',
      description: 'C description',
    });
    // (member, en-US): no C×L row and no en-US L row — the C row for both.
    expect(await resolved(`?channelId=${member}&locale=en-US`)).toMatchObject({
      title: 'C title',
      description: 'C description',
    });
    // The admin editor shows, per field, the scope each value came from (T126).
    const answer = await h.app.inject({ method: 'GET', url: url(`?channelId=${member}&locale=pl-PL`), ...admin });
    expect((answer.json() as { data: { sources: Record<string, string> } }).data.sources).toEqual({
      title: 'channel_language',
      description: 'channel',
      ogTitle: 'derived',
      ogDescription: 'derived',
      ogImageUrl: 'derived',
    });
    // Language only: the L row, then derived.
    expect(await resolved('?locale=pl-PL')).toMatchObject({ title: 'Legacy PL title', description: 'Derived description' });
    expect(await resolved('?locale=en-US')).toMatchObject({ title: 'Derived name', source: 'rule' });
  });

  it('keeps one row per address', async () => {
    expect((await put({ channelId: member, locale: 'pl-PL', title: 'CxL title 2' })).statusCode).toBe(200);
    const rows = await sql<Array<{ n: string }>>(
      `select count(*)::text as n from seo_meta_overrides
        where entity_id = ? and sales_channel_id = ? and locale = 'pl-PL'`,
      [productId, member],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('refuses a channel on any entity but a product', async () => {
    const [category] = await sql<Array<{ id: string }>>(`select id from categories where deleted_at is null limit 1`);
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/seo/meta/category/${category!.id}`,
      ...admin,
      payload: { channelId: member, title: 'Nope' },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses a non-member channel or an unoffered language on PUT, and allows removing it', async () => {
    const notMember = await put({ channelId: stranger, title: 'Stranger' });
    expect(notMember.statusCode).toBe(422);
    expect((notMember.json() as { error: { code: string; details: { reason: string } } }).error).toMatchObject({
      code: ERROR_CODES.SCOPE_INVALID,
      details: { reason: 'not_a_member' },
    });
    const unoffered = await put({ channelId: member, locale: 'de-DE', title: 'Deutsch' });
    expect(unoffered.statusCode).toBe(422);
    expect((unoffered.json() as { error: { code: string; details: { reason: string } } }).error).toMatchObject({
      code: ERROR_CODES.SCOPE_INVALID,
      details: { reason: 'language_not_offered' },
    });

    // An orphan — a row whose channel the product left — is always removable (FR-015).
    await sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, sales_channel_id, title, created_at, updated_at)
       values (?, 'product', ?, ?, 'Orphan', now(), now())`,
      [randomUUID(), productId, stranger],
    );
    const removed = await h.app.inject({ method: 'DELETE', url: url(`?channelId=${stranger}`), ...admin });
    expect(removed.statusCode, removed.body).toBe(204);
    const left = await sql<unknown[]>(
      `select 1 from seo_meta_overrides where entity_id = ? and sales_channel_id = ?`,
      [productId, stranger],
    );
    expect(left).toHaveLength(0);
  });

  it('refuses a second row at one address at the database too', async () => {
    await expect(
      sql(
        `insert into seo_meta_overrides (id, entity_type, entity_id, sales_channel_id, title, created_at, updated_at)
         values (?, 'product', ?, ?, 'Duplicate C', now(), now())`,
        [randomUUID(), productId, member],
      ),
    ).rejects.toThrow();
    await expect(
      sql(
        `insert into seo_meta_overrides (id, entity_type, entity_id, title, created_at, updated_at)
         values (?, 'product', ?, 'Neither', now(), now())`,
        [randomUUID(), productId],
      ),
    ).rejects.toThrow();
  });
});
