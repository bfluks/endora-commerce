import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { FeedRunIssue } from '../../helpers/package-entities.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Issue #430 — a sub-cent unit price, end to end through a feed run.
 *
 * The three seeded products cost 0.0125 PLN each on the channel. A Google feed
 * publishes each as a multipack of 100 at 1.25 PLN — exact, nothing rounded —
 * and a Meta feed, whose template has no pack-size field, leaves them out and
 * says why on the run, per product.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('product feeds — a sub-cent price [integration]', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let templates: Array<{ id: string; systemCode: string | null }>;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_sub_cent', amount: '0.0125' });
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
    templates = (res.json() as { data: typeof templates }).data;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createFeed(systemCode: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Sub-cent ${systemCode} ${Math.random().toString(36).slice(2, 8)}`,
        slug: `sub-cent-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templates.find((t) => t.systemCode === systemCode)!.id,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { feed: { id: string } } }).data.feed.id;
  }

  it('Google publishes each as a multipack of 100 at 1.25 PLN, with the pack as the unit-pricing base', async () => {
    const feedId = await createFeed('google_merchant_v1');
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
    expect(run.skippedCount).toBe(0);

    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/product-feeds/${feedId}/artefact`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    const items = res.body.split('<item>').slice(1);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const item of items) {
      expect(item).toContain('<g:price>1.25 PLN</g:price>');
      expect(item).toContain('<g:multipack>100</g:multipack>');
      expect(item).toContain('<g:unit_pricing_measure>100ct</g:unit_pricing_measure>');
      expect(item).toContain('<g:unit_pricing_base_measure>100ct</g:unit_pricing_base_measure>');
    }
    expect(res.body).not.toContain('0.01 PLN');
  });

  it('Meta, with no pack-size field, skips each and records why on the run', async () => {
    const feedId = await createFeed('meta_catalog_v1');
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(run.emittedCount).toBe(0);
    expect(run.skippedCount).toBeGreaterThanOrEqual(3);

    const em = h.em();
    em.clear();
    const issues = await em.find(FeedRunIssue, { feedRunId: run.id, reason: 'sub_cent_price_without_pack_field' });
    expect(issues.length).toBe(run.skippedCount);
    for (const issue of issues) {
      expect(issue.severity).toBe('skip');
      expect(issue.outputName).toBe('g:price');
      expect(issue.detail).toContain('0.0125 PLN');
      expect(issue.detail).toContain('pack of 100');
    }
  });
});
