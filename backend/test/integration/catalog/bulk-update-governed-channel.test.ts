import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  attachRuleBySql,
  bridgeProduct,
  clearWebsiteRules,
  createChannel,
  createProduct,
  isMember,
} from '../product_visibility_rules/website-rule-fixtures.js';

/**
 * Spec 193 T067 (FR-055, FR-059, R-10, TM-10) — the bulk product update's sales-channel edit never
 * writes a membership a website rule governs: a request naming a governed channel is refused
 * before anything is applied or queued (`409 CHANNEL_MEMBERSHIP_GOVERNED`, the rule named, no
 * product named — FR-082), and each membership write passes `onGoverned: 'refuse'`, so a replace
 * that would take a product off a governed channel fails that product and leaves it there. With
 * `product_visibility_rules` off nothing is governed and the edit behaves as before (FR-073).
 */
describe('bulk update × governed sales channel (spec 193, T067)', () => {
  let h: BackendServerHandle;
  let governed: string;
  let free: string;
  const RULE = 'Bulk governed';
  const bulk = (productIds: string[], fields: object) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { productIds, fields },
    });
  const operations = async () =>
    (await h.orm.em.fork().getConnection().execute<Array<{ n: number }>>(`select count(*)::int as n from "catalog_bulk_operations"`))[0]!.n;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    governed = await createChannel(h, 'bg-gov');
    free = await createChannel(h, 'bg-free');
    await attachRuleBySql(h, [governed], RULE);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  it('an add naming a governed channel is refused before anything is applied', async () => {
    const product = await createProduct(h, { color: 'red' }, { status: 'inactive' });
    const res = await bulk([product], { status: 'active', salesChannels: { mode: 'add', channelIds: [free, governed] } });
    expect(res.statusCode, res.body).toBe(409);
    const error = (res.json() as { error: { code: string; details: Record<string, unknown> } }).error;
    expect(error.code).toBe('CHANNEL_MEMBERSHIP_GOVERNED');
    expect(error.details).toEqual({ channelId: governed, rule: RULE });
    expect(res.body).not.toContain(product);
    expect(await isMember(h, free, product)).toBe(false);
    expect(await isMember(h, governed, product)).toBe(false);
    const [row] = await h.orm.em.fork().getConnection().execute<Array<{ status: string }>>(`select "status" from "products" where "id" = ?`, [product]);
    expect(row!.status).toBe('inactive');
  });

  it('a queued selection naming a governed channel is refused at enqueue time; nothing is queued', async () => {
    const before = await operations();
    const ids = [await createProduct(h, { color: 'red' }), ...Array.from({ length: 60 }, () => randomUUID())];
    const res = await bulk(ids, { salesChannels: { mode: 'replace', channelIds: [governed] } });
    expect(res.statusCode, res.body).toBe(409);
    expect(await operations()).toBe(before);
  });

  it('a replace that would take a product off a governed channel fails that product and leaves it there', async () => {
    const product = await createProduct(h, { color: 'red' });
    await bridgeProduct(h, governed, product);
    const res = await bulk([product], { salesChannels: { mode: 'replace', channelIds: [free] } });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { summary: { failed: number } } }).data;
    expect(data.summary.failed).toBe(1);
    expect(await isMember(h, governed, product)).toBe(true);
  });

  it('an ungoverned channel is edited as before', async () => {
    const product = await createProduct(h, { color: 'red' });
    const res = await bulk([product], { salesChannels: { mode: 'add', channelIds: [free] } });
    expect(res.statusCode, res.body).toBe(200);
    expect(await isMember(h, free, product)).toBe(true);
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: nothing is governed and the add applies (FR-073)', async (axis) => {
    const product = await createProduct(h, { color: 'red' });
    await withModuleOff('product_visibility_rules', axis, async () => {
      const res = await bulk([product], { salesChannels: { mode: 'add', channelIds: [governed] } });
      expect(res.statusCode, res.body).toBe(200);
    });
    expect(await isMember(h, governed, product)).toBe(true);
  });
});
