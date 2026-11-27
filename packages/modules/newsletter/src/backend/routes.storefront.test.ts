import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerNewsletterStorefrontRoutes, type NewsletterStorefrontDeps } from './routes.storefront.js';
import { NewsletterTokenHelper, clickDestinationHash } from './services/token.helper.js';
import { applyEngagementTracking, newsletterTrackingLinks } from './services/engagement-tracking.js';
import type { NewsletterTrackingService } from './services/tracking.service.js';

/**
 * `GET /api/v1/newsletter/click?token=<token>&u=<url>` — the click tracker. It
 * redirects only when the token verifies, and only to the `u` destination
 * whose digest the token was minted with.
 *
 * Every instance here is a Fastify instance with **default** options: the
 * token travels in the query string, so the router's 100-character
 * path-parameter limit never applies to it.
 */
const STOREFRONT = 'https://shop.test';
const DEAL = 'https://shop.test/deal?utm_source=newsletter';
const ELSEWHERE = 'https://elsewhere.example/';
const tokens = new NewsletterTokenHelper('click-route-secret');

const API = 'https://api.shop.test';

interface RecordedClick {
  id: string;
  linkId: string | null;
  url: string | null;
}

let app: FastifyInstance | null = null;

async function appWith(clicks: RecordedClick[], opens: string[] = []): Promise<FastifyInstance> {
  const instance = Fastify();
  const tracking = {
    recordOpen: async (id: string) => {
      opens.push(id);
    },
    recordClick: async (id: string, linkId: string | null, url: string | null) => {
      clicks.push({ id, linkId, url });
    },
  } as unknown as NewsletterTrackingService;
  await registerNewsletterStorefrontRoutes(instance, {
    subscribers: {} as NewsletterStorefrontDeps['subscribers'],
    optIn: {} as NewsletterStorefrontDeps['optIn'],
    tokens,
    tracking,
    resolveChannelIdByCode: async () => null,
    resolveDefaultChannelId: async () => null,
    storefrontBaseUrl: STOREFRONT,
  });
  app = instance;
  return instance;
}

function clickUrl(token: string, u?: string): string {
  return `/api/v1/newsletter/click?token=${encodeURIComponent(token)}${u === undefined ? '' : `&u=${encodeURIComponent(u)}`}`;
}

afterEach(async () => {
  await app?.close();
  app = null;
});

describe('newsletter click tracker', () => {
  it('redirects to the destination bound to a valid token and records the click', async () => {
    const clicks: RecordedClick[] = [];
    const server = await appWith(clicks);
    const token = tokens.mint('click', { id: 'rec-1', linkId: 'cta', urlHash: clickDestinationHash(DEAL) }, 3600);
    const res = await server.inject({ method: 'GET', url: clickUrl(token, DEAL) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(DEAL);
    expect(clicks).toEqual([{ id: 'rec-1', linkId: 'cta', url: DEAL }]);
  });

  it('sends a valid token with a different destination to the storefront home', async () => {
    const clicks: RecordedClick[] = [];
    const server = await appWith(clicks);
    const token = tokens.mint('click', { id: 'rec-1', urlHash: clickDestinationHash(DEAL) }, 3600);
    const res = await server.inject({ method: 'GET', url: clickUrl(token, ELSEWHERE) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${STOREFRONT}/`);
    expect(clicks).toEqual([{ id: 'rec-1', linkId: null, url: null }]);
  });

  it('answers 410 without redirecting when the token does not verify', async () => {
    const clicks: RecordedClick[] = [];
    const server = await appWith(clicks);
    const res = await server.inject({ method: 'GET', url: clickUrl('garbage', ELSEWHERE) });
    expect(res.statusCode).toBe(410);
    expect(res.headers.location).toBeUndefined();
    expect(clicks).toEqual([]);
  });

  it('answers 410 when the link carries no token', async () => {
    const server = await appWith([]);
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/newsletter/click?u=${encodeURIComponent(ELSEWHERE)}`,
    });
    expect(res.statusCode).toBe(410);
    expect(res.headers.location).toBeUndefined();
  });

  it('answers 410 for a token minted for another purpose', async () => {
    const server = await appWith([]);
    const token = tokens.mint('open', { id: 'rec-1' }, 3600);
    const res = await server.inject({ method: 'GET', url: clickUrl(token, ELSEWHERE) });
    expect(res.statusCode).toBe(410);
  });

  it('sends a valid token that binds no destination to the storefront home, not to u', async () => {
    const clicks: RecordedClick[] = [];
    const server = await appWith(clicks);
    const token = tokens.mint('click', { id: 'rec-2', linkId: 'old' }, 3600);
    const res = await server.inject({ method: 'GET', url: clickUrl(token, ELSEWHERE) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${STOREFRONT}/`);
    expect(clicks).toEqual([{ id: 'rec-2', linkId: 'old', url: null }]);
  });

  it('does not redirect to a bound destination that is not http(s)', async () => {
    const server = await appWith([]);
    const script = 'javascript:alert(1)';
    const token = tokens.mint('click', { id: 'rec-3', urlHash: clickDestinationHash(script) }, 3600);
    const res = await server.inject({ method: 'GET', url: clickUrl(token, script) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${STOREFRONT}/`);
  });
});

describe('newsletter trackers reached from a sent e-mail', () => {
  const links = newsletterTrackingLinks(API);

  function sent(html: string): string {
    return applyEngagementTracking(html, { sendRecordId: 'rec-9', opens: true, clicks: true, tokens, links });
  }

  function pathOf(absolute: string): string {
    const url = new URL(absolute.replace(/&amp;/g, '&'));
    expect(url.origin).toBe(API);
    return `${url.pathname}${url.search}`;
  }

  it('redirects a rewritten link to its destination and records the click', async () => {
    const clicks: RecordedClick[] = [];
    const server = await appWith(clicks);
    const html = sent(`<html><body><a href="${DEAL.replace(/&/g, '&amp;')}">Deal</a></body></html>`);
    const href = /<a href="([^"]+)"/.exec(html)?.[1] ?? '';
    const res = await server.inject({ method: 'GET', url: pathOf(href) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(DEAL);
    expect(clicks).toEqual([{ id: 'rec-9', linkId: 'link-1', url: DEAL }]);
  });

  it('serves the open pixel for its minted token and records the open', async () => {
    const opens: string[] = [];
    const server = await appWith([], opens);
    const html = sent('<html><body><p>Hi</p></body></html>');
    const src = /<img src="([^"]+)"/.exec(html)?.[1] ?? '';
    const res = await server.inject({ method: 'GET', url: pathOf(src) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    expect(opens).toEqual(['rec-9']);
  });

  it('serves the pixel without recording anything for a token that does not verify', async () => {
    const opens: string[] = [];
    const server = await appWith([], opens);
    const res = await server.inject({ method: 'GET', url: '/api/v1/newsletter/open.gif?token=garbage' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/gif');
    expect(opens).toEqual([]);
  });
});
