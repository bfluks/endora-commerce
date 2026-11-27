/* eslint-disable no-console -- a conformance run: stdout is its interface. */
import { expect, test } from '@playwright/test';
import type { ChannelUrlLanguage, PublicSalesChannelResponse } from '@endora-commerce/contracts';

/**
 * The storefront language path on **served** responses
 * (`specs/167-storefront-locale-path/contracts/url-shape.md` §3, §9; SC-002, SC-003).
 *
 * The unit tests hold the decisions (`test/i18n/*.test.ts`); this holds their effect on
 * a built storefront in front of a real backend. It changes no setting: it reads the
 * channel's URL languages from the backend and asserts the rows that apply to the state
 * the channel is in, so run it once with *Prefix the default language in URLs* on and
 * once with it off. It needs a channel with at least two languages and no browser.
 *
 *     STOREFRONT_URL=http://127.0.0.1:3000 PUBLIC_API_BASE_URL=http://127.0.0.1:3001 \
 *       pnpm --filter storefront run conformance -- locale-path
 *
 * **Run it against a steady state**: the storefront holds the channel identity for up
 * to a minute after a change.
 */

const STOREFRONT_URL = process.env['STOREFRONT_URL'] ?? 'http://127.0.0.1:3000';
const BACKEND_URL = process.env['PUBLIC_API_BASE_URL'] ?? 'http://127.0.0.1:3001';
const CHANNEL = process.env['SALES_CHANNEL_CODE'];
const CHANNEL_HEADERS: Record<string, string> =
  CHANNEL !== undefined && CHANNEL !== '' ? { 'x-sales-channel': CHANNEL } : {};

const served = (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${STOREFRONT_URL}${path}`, { headers: { ...CHANNEL_HEADERS, ...headers }, redirect: 'manual' });

/** The path of a `Location` header, origin dropped. */
function locationOf(response: Response): string | null {
  const location = response.headers.get('location');
  if (location === null) return null;
  const url = new URL(location, STOREFRONT_URL);
  return `${url.pathname}${url.search}`;
}

const urlOf = (language: ChannelUrlLanguage, logical: string): string =>
  language.prefixed ? `/${language.prefix}${logical === '/' ? '' : logical}` : logical;

test.describe('language in the URL path', () => {
  let languages: ChannelUrlLanguage[] = [];
  let main: ChannelUrlLanguage;
  let other: ChannelUrlLanguage;
  let on = true;

  test.beforeAll(async () => {
    const response = await fetch(`${BACKEND_URL}/api/v1/storefront/sales-channel`, { headers: CHANNEL_HEADERS });
    expect(response.status).toBe(200);
    const body = (await response.json()) as PublicSalesChannelResponse;
    languages = body.data.urlLanguages;
    on = body.data.prefixDefaultLanguage;
    main = languages.find((l) => l.isDefault)!;
    other = languages.find((l) => !l.isDefault)!;
    console.log(`[locale-path] channel=${body.data.code} setting=${on ? 'on' : 'off'} languages=${languages.map((l) => `${l.languageCode}:${l.prefix}`).join(',')}`);
  });

  test('the channel has two languages to switch between', () => {
    expect(languages.length, 'run against a channel with at least two languages').toBeGreaterThanOrEqual(2);
  });

  test('an unprefixed page: 307 by Accept-Language with the setting on, the default language with it off', async () => {
    const response = await served('/catalog?sort=price', { 'accept-language': other.languageCode });
    if (on) {
      expect(response.status).toBe(307);
      expect(locationOf(response)).toBe(urlOf(other, '/catalog?sort=price'));
      expect(response.headers.get('vary')).toContain('Accept-Language');
      expect(response.headers.get('cache-control')).toContain('no-store');
    } else {
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(`<html lang="${main.languageCode}"`);
    }
  });

  test('the lang cookie chooses the 307 target with the setting on (OR-11), and nothing with it off', async () => {
    const response = await served('/catalog', { cookie: `lang=${other.languageCode}`, 'accept-language': main.languageCode });
    if (on) expect(locationOf(response)).toBe(urlOf(other, '/catalog'));
    else expect(response.status).toBe(200);
  });

  test('the default prefix: rendered with the setting on, 308 to the unprefixed URL with it off', async () => {
    const response = await served(`/${main.prefix}/catalog?sort=price`);
    if (on) {
      expect(response.status).toBe(200);
    } else {
      expect(response.status).toBe(308);
      expect(locationOf(response)).toBe('/catalog?sort=price');
    }
  });

  test('?lang= on an unprefixed URL moves to that language, without lang', async () => {
    const response = await served(`/catalog?lang=${other.languageCode}&sort=price`, { 'accept-language': main.languageCode });
    expect(response.status).toBe(on ? 307 : 308);
    expect(locationOf(response)).toBe(urlOf(other, '/catalog?sort=price'));
  });

  test('a mixed-case prefix answers 308 to the lower-case one', async () => {
    const response = await served(`/${other.prefix.toUpperCase()}/catalog`);
    expect(response.status).toBe(308);
    expect(locationOf(response)).toBe(`/${other.prefix}/catalog`);
  });

  test('the path language wins over the cookie and Accept-Language, and is <html lang>', async () => {
    const response = await served(`/${other.prefix}/catalog`, {
      cookie: `lang=${main.languageCode}`,
      'accept-language': main.languageCode,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`<html lang="${other.languageCode}"`);
  });

  for (const path of ['/robots.txt', '/sitemap.xml', '/manifest.webmanifest']) {
    test(`${path} is never redirected for language`, async () => {
      const response = await served(path, { 'accept-language': other.languageCode });
      expect([307, 308]).not.toContain(response.status);
    });
  }

  // SC-002 — pre-feature links reach a page in at most two redirects.
  for (const path of ['/', '/catalog', '/cart', '/search?q=a', '/login', '/catalog?lang={other}']) {
    test(`a pre-feature link ${path} reaches a 200 in at most two redirects`, async () => {
      let current = path.replace('{other}', other.languageCode);
      let hops = 0;
      for (;;) {
        const response = await served(current, { 'accept-language': other.languageCode });
        if (response.status !== 307 && response.status !== 308) {
          expect(response.status, current).toBe(200);
          break;
        }
        hops += 1;
        expect(hops, `${path} → ${current}`).toBeLessThanOrEqual(2);
        current = locationOf(response)!;
      }
    });
  }

  // SC-003 — no unprefixed internal link on a prefixed page.
  for (const logical of ['/', '/catalog', '/cart', '/search?q=a', '/login']) {
    test(`every internal link on ${logical} carries the page's prefix`, async () => {
      const url = urlOf(other, logical);
      const html = await (await served(url)).text();
      const offenders = [...html.matchAll(/<a\b[^>]*>/g)]
        .map((m) => m[0])
        // The language switcher links to the other languages on purpose.
        .filter((tag) => !/\shreflang=/i.test(tag))
        .map((tag) => /\shref="([^"]*)"/.exec(tag)?.[1] ?? '')
        .filter((href) => href.startsWith('/') && !href.startsWith('//'))
        .filter((href) => !/^\/(api|pwa|offline|_next)(\/|$)/.test(href) && !/^\/[^/?#]*\.[a-z0-9]+([?#]|$)/i.test(href))
        .filter((href) => href !== `/${other.prefix}` && !href.startsWith(`/${other.prefix}/`) && !href.startsWith(`/${other.prefix}?`));
      expect(offenders, `${url}: unprefixed internal links`).toEqual([]);
    });
  }
});
