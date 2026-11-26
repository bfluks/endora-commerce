import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import en from '../../../../packages/modules/sales_channels/i18n/en.json' with { type: 'json' };
import pl from '../../../../packages/modules/sales_channels/i18n/pl.json' with { type: 'json' };
import {
  attachRuleBySql,
  clearWebsiteRules,
  createChannel,
  isMember,
} from '../product_visibility_rules/website-rule-fixtures.js';

/**
 * Spec 193 T100 [real DB] — FR-059 / TM-10: deleting a channel with `fallbackToDefault=true`
 * rebinds its orphans to the system default straight in the bridge tables. When the default is
 * governed for products by a website rule, that rebind would admit products the rule never
 * admitted, so it is no fallback (R-10): the delete is refused with
 * `ENTITY_WOULD_HAVE_ZERO_CHANNELS` before any write, naming the rule and a count — never a
 * product id (FR-082). Non-product bridges are never governed and rebind as before.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('channel delete onto a governed default (spec 193, T100)', () => {
  let h: BackendServerHandle;
  let defaultId: string;
  const sql = <T = Record<string, unknown>>(s: string, params: unknown[] = []) =>
    h.orm.em.fork().getConnection().execute<T[]>(s, params);

  async function channelCode(id: string): Promise<string> {
    const [row] = await sql<{ code: string }>(`select "code" from "sales_channels" where "id" = ?`, [id]);
    return row!.code;
  }

  async function channelExists(id: string): Promise<boolean> {
    return (await sql(`select 1 from "sales_channels" where "id" = ?`, [id])).length > 0;
  }

  /** A product whose only channel is `channelId`. */
  async function productOnlyOn(channelId: string, keep = false): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `select p."id" from "products" p where p."deleted_at" is null and not (p."id" = any(?::uuid[])) order by p."id" limit 1`,
      [`{${usedProducts.join(',')}}`],
    );
    // Products left on a channel this file keeps (case 1) are not taken again.
    if (keep) usedProducts.push(row!.id);
    await sql(`delete from "sales_channel_products" where "product_id" = ?`, [row!.id]);
    await sql(`insert into "sales_channel_products" ("sales_channel_id", "product_id") values (?, ?)`, [channelId, row!.id]);
    return row!.id;
  }
  const usedProducts: string[] = [];

  /** A category whose only channel is `channelId`. */
  async function categoryOnlyOn(channelId: string): Promise<string> {
    const [row] = await sql<{ id: string }>(`select "id" from "categories" order by "id" limit 1 offset ?`, [categoryOffset++]);
    await sql(`delete from "sales_channel_categories" where "category_id" = ?`, [row!.id]);
    await sql(`insert into "sales_channel_categories" ("sales_channel_id", "category_id") values (?, ?)`, [channelId, row!.id]);
    return row!.id;
  }
  let categoryOffset = 0;

  /** Every bridge row touching `channelIds`, per table — compared before and after. */
  async function bridgeSnapshot(channelIds: readonly string[]): Promise<Record<string, number>> {
    const tables = await sql<{ table_name: string }>(
      `select distinct "table_name" from information_schema.columns ` +
        `where "table_schema" = current_schema() and "column_name" = 'sales_channel_id' and "table_name" like 'sales\\_channel\\_%' order by 1`,
    );
    const out: Record<string, number> = {};
    for (const table of tables.map((t) => t.table_name)) {
      const [row] = await sql<{ n: number }>(
        `select count(*)::int as n from "${table}" where "sales_channel_id" = any(?::uuid[])`,
        [`{${channelIds.join(',')}}`],
      );
      out[table] = row!.n;
    }
    return out;
  }

  async function auditCount(): Promise<number> {
    const [row] = await sql<{ n: number }>(`select count(*)::int as n from "audit_log_entries"`);
    return row!.n;
  }

  async function deleteChannel(id: string, fallbackToDefault: boolean) {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sales-channels/${await channelCode(id)}${fallbackToDefault ? '?fallbackToDefault=true' : ''}`,
      cookies: ADMIN,
    });
    return { status: res.statusCode, body: res.body ? (res.json() as any) : null, raw: res.body }; // eslint-disable-line @typescript-eslint/no-explicit-any -- the envelope as answered
  }

  async function setPreferredLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({ method: 'PATCH', url: '/api/v1/admin/me/preferred-language', cookies: ADMIN, payload: { preferredLanguage: language } });
    expect(res.statusCode).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await setPreferredLanguage('en');
    const [row] = await sql<{ id: string }>(`select "id" from "sales_channels" where "system_default" = true`);
    defaultId = row!.id;
  }, 5 * 60_000);

  beforeEach(async () => {
    await clearWebsiteRules(h);
  });

  afterAll(async () => {
    await setPreferredLanguage(null);
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  it('(1) refuses before any write when product orphans would land on a governed default', async () => {
    const rule = await attachRuleBySql(h, [defaultId], 'Default rule "PLN"');
    const doomed = await createChannel(h, 'del-gov');
    const p1 = await productOnlyOn(doomed, true);
    const p2 = await productOnlyOn(doomed, true);
    await categoryOnlyOn(doomed);
    const bridgesBefore = await bridgeSnapshot([doomed, defaultId]);
    const auditBefore = await auditCount();

    const res = await deleteChannel(doomed, true);

    expect(res.status, res.raw).toBe(422);
    expect(res.body.error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    expect(res.body.error.details).toEqual({ code: 'default_channel_governed', entityType: 'product', count: 2, rule: rule.name });
    expect(res.body.error.message).toBe(
      en['errors.ENTITY_WOULD_HAVE_ZERO_CHANNELS.default_channel_governed'].replace('{count}', '2').replace('{rule}', rule.name),
    );
    expect(res.body.error.message).not.toMatch(/fallbackToDefault/);
    await setPreferredLanguage('pl');
    try {
      const polish = await deleteChannel(doomed, true);
      expect(polish.body.error.message).toBe(
        pl['errors.ENTITY_WOULD_HAVE_ZERO_CHANNELS.default_channel_governed'].replace('{count}', '2').replace('{rule}', rule.name),
      );
    } finally {
      await setPreferredLanguage(null);
    }
    expect(res.raw).not.toContain(p1);
    expect(res.raw).not.toContain(p2);
    expect(await channelExists(doomed)).toBe(true);
    expect(await bridgeSnapshot([doomed, defaultId])).toEqual(bridgesBefore);
    expect(await isMember(h, defaultId, p1)).toBe(false);
    expect(await auditCount()).toBe(auditBefore);
  });

  it('(2) rebinds as today when the orphans on a governed default are not products', async () => {
    await attachRuleBySql(h, [defaultId]);
    const doomed = await createChannel(h, 'del-cat');
    const category = await categoryOnlyOn(doomed);

    const res = await deleteChannel(doomed, true);

    expect(res.status, res.raw).toBe(204);
    expect(await channelExists(doomed)).toBe(false);
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as n from "sales_channel_categories" where "sales_channel_id" = ? and "category_id" = ?`,
      [defaultId, category],
    );
    expect(row!.n).toBe(1);
  });

  it('(3) rebinds product orphans as today when the default is not governed', async () => {
    const doomed = await createChannel(h, 'del-free');
    const product = await productOnlyOn(doomed);

    const res = await deleteChannel(doomed, true);

    expect(res.status, res.raw).toBe(204);
    expect(await isMember(h, defaultId, product)).toBe(true);
  });

  it('(4) rebinds as today when the deleted channel is governed and the default is not', async () => {
    const doomed = await createChannel(h, 'del-govd');
    await attachRuleBySql(h, [doomed]);
    const product = await productOnlyOn(doomed);

    const res = await deleteChannel(doomed, true);

    expect(res.status, res.raw).toBe(204);
    expect(await isMember(h, defaultId, product)).toBe(true);
  });

  it('names no product in the plain refusal without fallback either — a count per entity type (FR-082)', async () => {
    const doomed = await createChannel(h, 'del-plain');
    const product = await productOnlyOn(doomed);

    const res = await deleteChannel(doomed, false);

    expect(res.status, res.raw).toBe(422);
    expect(res.body.error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    expect(res.body.error.details).toEqual([{ path: 'product', issue: '1' }]);
    expect(res.raw).not.toContain(product);
    await sql(`delete from "sales_channel_products" where "sales_channel_id" = ?`, [doomed]);
  });
});
