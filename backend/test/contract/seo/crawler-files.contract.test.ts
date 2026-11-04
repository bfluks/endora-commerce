import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CRAWLER_TEXT_MAX_BYTES,
  storefrontCrawlerFilesResponseSchema,
} from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setChannelAnonymousAccess } from '../../helpers/sales-channel-access.js';

/**
 * `GET /api/v1/storefront/seo/crawler-files`
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2).
 *
 * What the storefront builds a sales channel's `robots.txt` from. Three things
 * are held, and they are the three the storefront depends on:
 *
 *  * the body is the contract schema, and the operator's text in it is **what
 *    was stored, character for character** — the backend rewrites no line
 *    break and trims nothing; what a served file does with the text is the
 *    storefront's, in one function both sides share;
 *  * no shared cache may keep the answer — the storefront is the cache;
 *  * it needs no session.
 *
 * And one thing it must never do: answer `200` as if it had read something it
 * could not. Stored `robots.txt` instructions it cannot stand behind are a
 * `500` — an empty text at `200` would be a file without the operator's rules,
 * called current. A default robots value or `llms.txt` content it cannot read
 * is **named** in the answer instead, so that it costs the channel its
 * `llms.txt` and never its `robots.txt`.
 */
describe('GET /api/v1/storefront/seo/crawler-files', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const URL = '/api/v1/storefront/seo/crawler-files';
  const CODES = [
    'seo.robots_txt_custom',
    'seo.llms_txt_additional',
    'seo.default_robots',
    'shop.name',
  ];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterEach(async () => {
    for (const code of CODES) {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/${code}/values`,
        cookies: admin,
      });
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const store = async (code: string, value: string): Promise<void> => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${code}/value`,
      cookies: admin,
      payload: { scope: 'all', value },
    });
    expect(res.statusCode, `storing ${code} must be accepted: ${res.body}`).toBe(200);
  };

  it('answers no custom text and no restriction on an instance nobody configured', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    const body = storefrontCrawlerFilesResponseSchema.parse(res.json());
    expect(body.data).toMatchObject({
      index: true,
      follow: true,
      robotsTxtCustom: '',
      llmsTxtAdditional: '',
    });
    expect(typeof body.data.shop.name).toBe('string');
  });

  it('answers the schema, and sends exactly the members it names', async () => {
    await store('seo.robots_txt_custom', 'User-agent: GPTBot\nDisallow: /\n');
    await store('seo.llms_txt_additional', '## About\n\nWe sell bolts.\n');
    await store('seo.default_robots', 'NOINDEX, FOLLOW');
    await store('shop.name', 'Endora Demo');

    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(storefrontCrawlerFilesResponseSchema.parse(res.json())).toEqual({
      data: {
        index: false,
        follow: true,
        robotsTxtCustom: 'User-agent: GPTBot\nDisallow: /\n',
        llmsTxtAdditional: '## About\n\nWe sell bolts.\n',
        shop: { name: 'Endora Demo' },
        anonymousAccess: true,
      },
    });
    // The schema drops what it does not know, so it cannot see an extra member.
    const raw = res.json() as { data: Record<string, unknown> & { shop: Record<string, unknown> } };
    expect(Object.keys(raw)).toEqual(['data']);
    expect(Object.keys(raw.data).sort()).toEqual([
      'anonymousAccess',
      'follow',
      'index',
      'llmsTxtAdditional',
      'robotsTxtCustom',
      'shop',
    ]);
    expect(Object.keys(raw.data.shop)).toEqual(['name']);
    // The stored spelling of the robots choice stays the module's own.
    expect(res.body).not.toContain('NOINDEX');
  });

  it.each([
    ['line feeds', 'User-agent: a\nDisallow: /x\n\nUser-agent: b\nDisallow: /y\n'],
    ['CRLF, as an API client may send it', 'User-agent: a\r\nDisallow: /x\r\n\r\nUser-agent: b\r\n'],
    ['leading and trailing whitespace', '\n\n  \t# indented comment   \n\n\n'],
    ['text outside ASCII', '# Zażółć gęślą jaźń 🤖\nDisallow: /zażółć\n'],
    ['what would be markup or a header anywhere else', '<script>alert(1)</script>\r\nSet-Cookie: a=b\r\n\r\n{"json":true}'],
  ])('returns the text exactly as stored: %s', async (_label, text) => {
    await store('seo.robots_txt_custom', text);
    await store('seo.llms_txt_additional', `# llms\n${text}`);
    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { robotsTxtCustom: string; llmsTxtAdditional: string } }).data;
    expect(data.robotsTxtCustom).toBe(text);
    expect(data.llmsTxtAdditional).toBe(`# llms\n${text}`);
    // It travels as a JSON string and as nothing else.
    expect(String(res.headers['content-type'])).toContain('application/json');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('forbids any cache from keeping the answer', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('needs no session, and answers the same with one', async () => {
    await store('seo.robots_txt_custom', 'Disallow: /private');
    const anonymous = await h.app.inject({ method: 'GET', url: URL });
    const signedIn = await h.app.inject({ method: 'GET', url: URL, cookies: admin });
    expect(anonymous.statusCode).toBe(200);
    expect(signedIn.statusCode).toBe(200);
    expect(anonymous.json()).toEqual(signedIn.json());
  });

  /**
   * `specs/154-sales-channel-access/`: a store closed to anonymous visitors
   * refuses their reads with `SALES_CHANNEL_SIGN_IN_REQUIRED` — but its
   * crawler files are still served, built for a store with nothing public, so
   * this read is open and says which kind of store the channel is.
   */
  describe('on a store closed to anonymous visitors', () => {
    afterEach(async () => {
      await setChannelAnonymousAccess(h, 'default', true);
    });

    it('answers an anonymous read on an open channel, saying it is open', async () => {
      const res = await h.app.inject({ method: 'GET', url: URL });
      expect(res.statusCode, res.body).toBe(200);
      expect(storefrontCrawlerFilesResponseSchema.parse(res.json()).data.anonymousAccess).toBe(true);
    });

    it('answers an anonymous read on a closed channel, saying it is closed', async () => {
      await store('seo.robots_txt_custom', 'User-agent: GPTBot\nAllow: /\n');
      await store('shop.name', 'Endora Trade');
      await setChannelAnonymousAccess(h, 'default', false);

      for (const headers of [{}, { 'x-sales-channel': 'default' }]) {
        const res = await h.app.inject({ method: 'GET', url: URL, headers });
        expect(res.statusCode, res.body).toBe(200);
        const body = storefrontCrawlerFilesResponseSchema.parse(res.json());
        expect(body.data.anonymousAccess).toBe(false);
        // What the operator configured is answered as stored; what a closed
        // store's files do with it is the storefront's to say.
        expect(body.data.robotsTxtCustom).toBe('User-agent: GPTBot\nAllow: /\n');
        expect(body.data.shop.name).toBe('Endora Trade');
        expect(res.headers['cache-control']).toBe('no-store');
      }
    });

    it('leaves a closed channel’s other anonymous reads refused', async () => {
      // The control: the channel really is closed, and only this read is open.
      await setChannelAnonymousAccess(h, 'default', false);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/sitemap.xml' });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        'SALES_CHANNEL_SIGN_IN_REQUIRED',
      );
    });
  });

  /**
   * Rows written around the settings API, which refuses both: straight into a
   * channel's own row. Each case uses a channel nothing in this file has read
   * before it — a write around the API drops no cache, so a channel already
   * read would answer from before the row existed.
   */
  describe('a stored value this module cannot stand behind', () => {
    const plant = async (code: string, channel: string, value: string): Promise<void> => {
      const em = h.em();
      const setting = await em.findOneOrFail(Setting, { code });
      const salesChannel = await em.findOneOrFail(SalesChannel, { code: channel });
      em.create(SettingValue, { setting, salesChannel, value });
      await em.flush();
    };
    // Through the API, so the settings cache is dropped with the row.
    const unplant = async (code: string, channel: string): Promise<void> => {
      const reset = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/settings/${code}/values?salesChannelCodes=${channel}`,
        cookies: admin,
      });
      expect(reset.statusCode, reset.body).toBe(200);
    };

    it('answers 500, not a truncated or empty text, for a stored text over the limit', async () => {
      const CHANNEL = 'pl_retail';
      await plant('seo.robots_txt_custom', CHANNEL, 'a'.repeat(CRAWLER_TEXT_MAX_BYTES + 1));
      try {
        const res = await h.app.inject({
          method: 'GET',
          url: URL,
          headers: { 'x-sales-channel': CHANNEL },
        });
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toContain('robotsTxtCustom');
        expect(res.body.length).toBeLessThan(2_000);
        // The neighbours are untouched: the failure is that channel's.
        expect((await h.app.inject({ method: 'GET', url: URL })).statusCode).toBe(200);
      } finally {
        await unplant('seo.robots_txt_custom', CHANNEL);
      }
    });

    /**
     * The parts of the answer fail apart (`contracts/crawler-policy.md` §2.2).
     * `robots.txt` reads the texts and never the policy, so a default robots
     * row nobody can interpret answers `200` with the texts and **names** the
     * policy unreadable — and `llms.txt`, which needs it, is not served.
     */
    it('answers the texts and names the policy unreadable for a stored robots value outside the four choices', async () => {
      const CHANNEL = 'pl_b2b_vip';
      await store('seo.robots_txt_custom', 'User-agent: GPTBot\nDisallow: /\n');
      await plant('seo.default_robots', CHANNEL, 'NOINDEX');
      try {
        const res = await h.app.inject({
          method: 'GET',
          url: URL,
          headers: { 'x-sales-channel': CHANNEL },
        });
        expect(res.statusCode, res.body).toBe(200);
        const body = storefrontCrawlerFilesResponseSchema.parse(res.json());
        expect(body.data.unreadable).toEqual(['policy']);
        expect(body.data.robotsTxtCustom).toBe('User-agent: GPTBot\nDisallow: /\n');
        // Never "no restriction": the restrictive pair, for a reader that does
        // not know `unreadable`.
        expect(body.data.index).toBe(false);
        expect(body.data.follow).toBe(false);
        // The stored spelling still does not travel.
        expect(res.body).not.toContain('NOINDEX');
        // The neighbours say nothing of the kind.
        const neighbour = await h.app.inject({ method: 'GET', url: URL });
        expect(neighbour.statusCode).toBe(200);
        expect(neighbour.json()).not.toHaveProperty('data.unreadable');
        // The policy's own endpoint keeps answering `500` for the row: the
        // storefront's pages keep the directive they last knew.
        const policy = await h.app.inject({
          method: 'GET',
          url: '/api/v1/storefront/seo/robots-policy',
          headers: { 'x-sales-channel': CHANNEL },
        });
        expect(policy.statusCode).toBe(500);
      } finally {
        await unplant('seo.default_robots', CHANNEL);
      }
    });

    it('answers robots.txt its text and names the llms.txt content unreadable when that is over the limit', async () => {
      // `pl_retail`'s content has not been read in this file: the case above
      // it on that channel stops at the robots text.
      const CHANNEL = 'pl_retail';
      await store('seo.robots_txt_custom', 'Disallow: /private\n');
      await plant('seo.llms_txt_additional', CHANNEL, 'a'.repeat(CRAWLER_TEXT_MAX_BYTES + 1));
      try {
        const res = await h.app.inject({
          method: 'GET',
          url: URL,
          headers: { 'x-sales-channel': CHANNEL },
        });
        expect(res.statusCode, res.body.slice(0, 500)).toBe(200);
        const body = storefrontCrawlerFilesResponseSchema.parse(res.json());
        expect(body.data.unreadable).toEqual(['llmsTxtAdditional']);
        expect(body.data.llmsTxtAdditional).toBe('');
        expect(body.data.robotsTxtCustom).toBe('Disallow: /private\n');
        expect(body.data.index).toBe(true);
        expect(res.body.length).toBeLessThan(2_000);
      } finally {
        await unplant('seo.llms_txt_additional', CHANNEL);
      }
    });
  });
});
