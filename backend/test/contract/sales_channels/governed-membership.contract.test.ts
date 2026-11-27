import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import en from '../../../../packages/modules/sales_channels/i18n/en.json' with { type: 'json' };
import pl from '../../../../packages/modules/sales_channels/i18n/pl.json' with { type: 'json' };
import {
  attachRuleBySql,
  bridgeProduct,
  clearWebsiteRules,
  createChannel,
  createProduct,
  isMember,
  membershipAudit,
} from '../../integration/product_visibility_rules/website-rule-fixtures.js';

/**
 * Spec 193 T065 (FR-054, FR-074; US4-3) — the channel-side membership routes are manual writes:
 * on a channel a website rule governs, `PUT` and `DELETE …/sales-channels/:code/product/:id`
 * answer `409 CHANNEL_MEMBERSHIP_GOVERNED` in the administrator's language, naming the rule, and
 * change nothing. On an ungoverned channel, and for any other entity type, they behave as before.
 */
const COOKIE = { cookie: 'b2b_session=stub-admin-session' };

describe('channel-side membership routes on a governed channel (spec 193, T065)', () => {
  let h: BackendServerHandle;
  let governed: string;
  let governedCode: string;
  let free: string;
  let freeCode: string;
  let rule: { name: string };
  let member: string;
  let outsider: string;
  const codeOf = async (id: string) =>
    (await h.orm.em.fork().getConnection().execute<Array<{ code: string }>>(`select "code" from "sales_channels" where "id" = ?`, [id]))[0]!.code;

  async function setPreferredLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({ method: 'PATCH', url: '/api/v1/admin/me/preferred-language', headers: COOKIE, payload: { preferredLanguage: language } });
    expect(res.statusCode).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    governed = await createChannel(h, 'gm-gov');
    free = await createChannel(h, 'gm-free');
    governedCode = await codeOf(governed);
    freeCode = await codeOf(free);
    member = await createProduct(h, { color: 'blue' });
    outsider = await createProduct(h, { color: 'red' });
    await bridgeProduct(h, governed, member);
    await bridgeProduct(h, free, member);
    await bridgeProduct(h, free, outsider);
    rule = await attachRuleBySql(h, [governed], 'Blue only "B2B"');
  }, 5 * 60_000);

  afterAll(async () => {
    await setPreferredLanguage(null);
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  const expected = (bundle: Record<string, string>) => bundle['errors.CHANNEL_MEMBERSHIP_GOVERNED']!.replace('{rule}', rule.name);

  it('PUT refuses, translated, naming the rule, and adds nothing (US4-3)', async () => {
    await setPreferredLanguage('pl');
    const res = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/${governedCode}/product/${outsider}`, headers: COOKIE });
    expect(res.statusCode, res.body).toBe(409);
    const error = (res.json() as { error: { code: string; message: string; details: unknown } }).error;
    expect(error.code).toBe(ERROR_CODES.CHANNEL_MEMBERSHIP_GOVERNED);
    expect(error.message).toBe(expected(pl));
    expect(error.details).toEqual({ channelId: governed, rule: rule.name });
    expect(await isMember(h, governed, outsider)).toBe(false);
    expect(await membershipAudit(h, governed, outsider)).toEqual([]);
  });

  it('DELETE refuses in English for an English reader, and removes nothing', async () => {
    await setPreferredLanguage('en');
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${governedCode}/product/${member}`, headers: COOKIE });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { message: string } }).error.message).toBe(expected(en));
    expect(await isMember(h, governed, member)).toBe(true);
  });

  it('an ungoverned channel behaves as before', async () => {
    const put = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/${freeCode}/product/${outsider}`, headers: COOKIE });
    expect([200, 201]).toContain(put.statusCode);
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${freeCode}/product/${member}`, headers: COOKIE });
    expect(del.statusCode, del.body).toBe(200);
    expect(await isMember(h, free, member)).toBe(false);
  });

  it('another entity type on the governed channel is written as before', async () => {
    const [category] = await h.orm.em.fork().getConnection().execute<Array<{ id: string }>>(`select "id" from "categories" order by "id" limit 1`);
    const res = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/${governedCode}/category/${category!.id}`, headers: COOKIE });
    expect([200, 201]).toContain(res.statusCode);
  });
});
