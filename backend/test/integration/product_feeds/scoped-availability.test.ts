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
 * Feature 163, Phase 7 (T049) — a product feed's eligibility floor is effective
 * availability at the feed's channel and language for the anonymous reader, now
 * (`contracts/consumers.md` row 11). Asserted through the selection preview,
 * whose count is the number the next run considers.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('163 — product feeds select only available products [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  let product: MinimumProductFixture;

  async function previewCount(): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/feed-previews/selection',
      ...ADMIN,
      payload: { salesChannelId: channelId, selectionRule: { kind: 'all' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { matchedCount: number } }).data.matchedCount;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    product = await createMinimumProduct(em, {
      sku: `S163-FEED-${RUN}`,
      nameEn: 'Feed',
      namePl: 'Feed',
      channelIds: [channelId],
    });
  });

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [product.id]);
    await teardownBackendServer(h);
  });

  it('drops a product switched off in the channel, keeps one on only there, and honours the window', async () => {
    const em = h.em();
    const withProduct = await previewCount();

    await setChannelStatus(em, product.id, [channelId], 'inactive');
    expect(await previewCount()).toBe(withProduct - 1);

    // Off globally, on in this channel: selected.
    await em.getConnection().execute(`update products set status = 'inactive' where id = ?`, [product.id]);
    await setChannelStatus(em, product.id, [channelId], 'active');
    expect(await previewCount()).toBe(withProduct);

    // Outside its publication window: not selected.
    await setGlobalWindow(em, product.id, { from: new Date(Date.now() + 60 * 60 * 1000), until: null });
    expect(await previewCount()).toBe(withProduct - 1);
  });
});
