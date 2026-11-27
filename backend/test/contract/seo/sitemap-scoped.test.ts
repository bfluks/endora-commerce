import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import {
  clearProductScopes,
  setChannelStatus,
  setGlobalWindow,
} from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 7 (T049) — the sitemap lists what an anonymous crawler may
 * open in the channel, now (`contracts/consumers.md` row 9): a product switched
 * off in the channel is left out, a product off globally but on in the channel
 * is listed, and the publication window is evaluated at generation time.
 */

const RETAIL = 'pl_retail';
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 — the sitemap honours scoped availability [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelOff: MinimumProductFixture;
  let channelOn: MinimumProductFixture;
  let ended: MinimumProductFixture;
  let plain: MinimumProductFixture;

  const slug = (p: MinimumProductFixture) => p.sku.toLowerCase();

  async function sitemap(): Promise<string> {
    const regen = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/sitemap/${RETAIL}/regenerate`,
      cookies: ADMIN,
      headers: { 'x-sales-channel': RETAIL },
    });
    expect(regen.statusCode, regen.body).toBe(200);
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml', headers: { 'x-sales-channel': RETAIL } });
    expect(res.statusCode).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: RETAIL });
    const create = (label: string) =>
      createMinimumProduct(em, { sku: `S163-SM-${label}-${RUN}`, nameEn: label, namePl: label, channelIds: [channel.id] });
    channelOff = await create('OFF');
    channelOn = await create('ON');
    ended = await create('ENDED');
    plain = await create('PLAIN');
    await setChannelStatus(em, channelOff.id, [channel.id], 'inactive');
    await em.getConnection().execute(`update products set status = 'inactive' where id = ?`, [channelOn.id]);
    await setChannelStatus(em, channelOn.id, [channel.id], 'active');
    await setGlobalWindow(em, ended.id, { from: null, until: new Date(Date.now() - 1000) });
  });

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [channelOff.id, channelOn.id, ended.id, plain.id]);
    await teardownBackendServer(h);
  });

  it('lists what is available in the channel and nothing else', async () => {
    const body = await sitemap();
    expect(body).toContain(`/p/${slug(plain)}`);
    expect(body).toContain(`/p/${slug(channelOn)}`);
    expect(body).not.toContain(`/p/${slug(channelOff)}`);
    expect(body).not.toContain(`/p/${slug(ended)}`);
  });
});
