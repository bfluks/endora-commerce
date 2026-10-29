import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newsletterStatusResponseSchema, newsletterSubscribeResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { NewsletterTokenHelper, clickDestinationHash } from '../../../../packages/modules/newsletter/src/backend/services/token.helper.js';

/** The key the test harness pins newsletter links to (`newsletterTokenSecret` in `test-server.ts`). */
const HARNESS_NEWSLETTER_TOKEN_SECRET = 'test-newsletter-secret';

/**
 * HTTP-level contract for the public newsletter routes (feature 048, US1),
 * exercised through the real Fastify server + module wiring.
 */
describe('Newsletter storefront routes (feature 048)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports module status with the per-channel opt-in mode', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/status?channel=default' });
    expect(res.statusCode).toBe(200);
    const body = newsletterStatusResponseSchema.parse(res.json().data);
    expect(body.enabled).toBe(true);
    expect(['single', 'double']).toContain(body.optInMode);
  });

  it('subscribes a valid email and returns a status', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'contract@example.com', channelCode: 'default' },
    });
    expect(res.statusCode).toBe(200);
    const body = newsletterSubscribeResponseSchema.parse(res.json().data);
    expect(['pending', 'active']).toContain(body.status);
  });

  it('rejects an unknown sales channel with 400', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/newsletter/subscribe',
      payload: { email: 'x@example.com', channelCode: 'no-such-channel' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a GIF for the open-tracking pixel even with a bad token', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/newsletter/open.gif?token=bad-token' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
  });

  it('answers a click link whose token does not verify 410, without redirecting', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/click?token=garbage&u=${encodeURIComponent('https://elsewhere.example/')}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.headers.location).toBeUndefined();
  });

  it('redirects a signed click link to its destination on the platform server', async () => {
    // A signed click token is longer than the router's default 100-character
    // path-parameter limit; carried in the query string it reaches the handler.
    const destination = 'https://shop.test/deal?utm_source=newsletter';
    const tokens = new NewsletterTokenHelper(HARNESS_NEWSLETTER_TOKEN_SECRET);
    const token = tokens.mint(
      'click',
      { id: '00000000-0000-4000-8000-000000000001', linkId: 'link-1', urlHash: clickDestinationHash(destination) },
      3600,
    );
    expect(token.length).toBeGreaterThan(100);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/newsletter/click?token=${encodeURIComponent(token)}&u=${encodeURIComponent(destination)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(destination);
  });

  it('seeds the predefined newsletter_consent CMS block linking to the privacy policy', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cms/blocks/by-code?code=newsletter_consent',
    });
    expect(res.statusCode).toBe(200);
    const block = res.json().data as { code: string; content: { data: unknown } };
    expect(block.code).toBe('newsletter_consent');
    expect(JSON.stringify(block.content.data)).toContain('/privacy-policy');
  });
});
