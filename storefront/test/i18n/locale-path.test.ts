import { describe, expect, it } from 'vitest';
import type { ChannelUrlLanguage, ChannelUrlLanguageAlias } from '@endora-commerce/contracts';
import {
  localizePath,
  pageAlternates,
  parseLocalePath,
  stripLocalePrefix,
  type UrlLanguageState,
} from '../../lib/i18n/locale-path';

/**
 * Feature 167 — the pure core of the storefront's language-in-the-path handling
 * (`specs/167-storefront-locale-path/contracts/url-shape.md` §3, §5, §8, §9;
 * `contracts/storefront-navigation.md` §1–§2). The middleware is a thin shell over
 * `parseLocalePath`; every link goes through `localizePath`.
 */

const plEn = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

const plEnUsGb = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en-us', prefixed: true, isDefault: false },
  { languageCode: 'en-GB', prefix: 'en-gb', prefixed: true, isDefault: false },
];
const EN_ALIAS: ChannelUrlLanguageAlias[] = [{ alias: 'en', languageCodes: ['en-US', 'en-GB'] }];

function parse(
  pathname: string,
  opts: {
    on: boolean;
    search?: string;
    acceptLanguage?: string | null;
    langCookie?: string | null;
    languages?: ChannelUrlLanguage[];
    aliases?: ChannelUrlLanguageAlias[];
  },
) {
  return parseLocalePath({
    pathname,
    search: opts.search ?? '',
    acceptLanguage: opts.acceptLanguage ?? null,
    langCookie: opts.langCookie ?? null,
    languages: opts.languages ?? plEn(opts.on),
    aliases: opts.aliases ?? [],
  });
}

const render = (languageCode: string, prefix: string, logicalPath: string) => ({
  kind: 'render',
  languageCode,
  prefix,
  logicalPath,
});
const r307 = (location: string) => ({ kind: 'redirect', status: 307, location, varyOnLanguageInputs: true });
const r308 = (location: string) => ({ kind: 'redirect', status: 308, location, varyOnLanguageInputs: false });

describe('parseLocalePath — url-shape §9 worked examples (pl-PL default, en-US)', () => {
  it.each([
    // [request, search, accept-language, cookie, on, off]
    ['/', '', 'en', null, r307('/en'), render('pl-PL', '', '/')],
    ['/', '', 'pl', 'en-US', r307('/en'), render('pl-PL', '', '/')],
    ['/de/o-nas', '', null, null, r307('/pl/de/o-nas'), render('pl-PL', '', '/de/o-nas')],
    ['/pl', '', null, null, render('pl-PL', 'pl', '/'), r308('/')],
    ['/en/p/drill', '', 'pl', null, render('en-US', 'en', '/p/drill'), render('en-US', 'en', '/p/drill')],
    ['/p/wiertarka', '?variant=A', 'en', null, r307('/en/p/wiertarka?variant=A'), render('pl-PL', '', '/p/wiertarka')],
    ['/p/drill', '?lang=en-US', 'pl', null, r307('/en/p/drill'), r308('/en/p/drill')],
    ['/EN/c/narzedzia', '', null, null, r308('/en/c/narzedzia'), r308('/en/c/narzedzia')],
  ] as const)('%s%s (Accept-Language %s, cookie %s)', (pathname, search, acceptLanguage, langCookie, on, off) => {
    expect(parse(pathname, { on: true, search, acceptLanguage, langCookie })).toEqual(on);
    expect(parse(pathname, { on: false, search, acceptLanguage, langCookie })).toEqual(off);
  });
});

describe('parseLocalePath — §3 row 1: a channel prefix', () => {
  it('renders the path language whatever ?lang=, the cookie and Accept-Language say (OR-4)', () => {
    expect(parse('/en/c/x', { on: true, search: '?lang=pl-PL', acceptLanguage: 'pl', langCookie: 'pl-PL' })).toEqual(
      render('en-US', 'en', '/c/x'),
    );
  });

  it('treats /<prefix>/ as the home page', () => {
    expect(parse('/en/', { on: true })).toEqual(render('en-US', 'en', '/'));
  });

  it('setting off: the default prefix answers 308 to the unprefixed URL, query preserved (OR-3)', () => {
    expect(parse('/pl/p/wiertarka', { on: false, search: '?variant=X' })).toEqual(r308('/p/wiertarka?variant=X'));
  });
});

describe('parseLocalePath — §3 row 3: a split alias (FR-015)', () => {
  const opts = (on: boolean) => ({ on, languages: plEnUsGb(on), aliases: EN_ALIAS });

  it('picks the variant by the lang cookie, then Accept-Language, else the first, in both states', () => {
    for (const on of [true, false]) {
      expect(parse('/en/p/drill', { ...opts(on), langCookie: 'en-GB', acceptLanguage: 'en-US' })).toEqual(
        r307('/en-gb/p/drill'),
      );
      expect(parse('/en/p/drill', { ...opts(on), acceptLanguage: 'en-GB,en;q=0.5' })).toEqual(r307('/en-gb/p/drill'));
      expect(parse('/en', { ...opts(on), acceptLanguage: 'de' })).toEqual(r307('/en-us'));
    }
  });

  it('a full-tag prefix renders its language', () => {
    expect(parse('/en-gb/c/x', opts(true))).toEqual(render('en-GB', 'en-gb', '/c/x'));
  });

  it('a mixed-case full tag answers 308 to the lower-case prefix', () => {
    expect(parse('/en-GB/c/x', opts(true))).toEqual(r308('/en-gb/c/x'));
  });
});

describe('parseLocalePath — §3 row 4 / §5: no prefix', () => {
  it('setting on: ?lang= → cookie → Accept-Language → default; lang removed, the rest kept in order (OR-2, OR-11)', () => {
    expect(parse('/c/narzedzia', { on: true, langCookie: 'en-US', acceptLanguage: 'pl' })).toEqual(r307('/en/c/narzedzia'));
    expect(
      parse('/c/narzedzia', { on: true, search: '?lang=pl-PL', langCookie: 'en-US', acceptLanguage: 'en' }),
    ).toEqual(r307('/pl/c/narzedzia'));
    expect(parse('/p/x', { on: true, search: '?a=1&lang=en&b=2&lang=pl', acceptLanguage: 'pl' })).toEqual(
      r307('/en/p/x?a=1&b=2'),
    );
    expect(parse('/p/x', { on: true, acceptLanguage: 'en-GB;q=0.8,pl;q=0.9' })).toEqual(r307('/pl/p/x'));
    expect(parse('/p/x', { on: true, acceptLanguage: 'en-GB' })).toEqual(r307('/en/p/x'));
    expect(parse('/p/x', { on: true })).toEqual(r307('/pl/p/x'));
  });

  it('setting on: values naming a language the channel does not serve are skipped', () => {
    expect(parse('/p/x', { on: true, search: '?lang=de-DE', langCookie: 'fr-FR', acceptLanguage: 'en' })).toEqual(
      r307('/en/p/x'),
    );
  });

  it('setting off: the cookie and Accept-Language decide nothing (OR-3)', () => {
    expect(parse('/c/x', { on: false, langCookie: 'en-US', acceptLanguage: 'en' })).toEqual(render('pl-PL', '', '/c/x'));
  });

  it('setting off: ?lang=<non-default> answers 308 to its prefixed URL; ?lang=<default> 308 without lang (OR-13)', () => {
    expect(parse('/p/bohrer', { on: false, search: '?lang=en-US&variant=X' })).toEqual(r308('/en/p/bohrer?variant=X'));
    expect(parse('/p/x', { on: false, search: '?variant=X&lang=pl-PL' })).toEqual(r308('/p/x?variant=X'));
  });

  it('setting off: an unknown ?lang= is ignored and the default renders', () => {
    expect(parse('/p/x', { on: false, search: '?lang=de-DE' })).toEqual(render('pl-PL', '', '/p/x'));
  });

  it('a prefix of a platform language the channel does not serve is an ordinary path (OR-12)', () => {
    expect(parse('/de/p/x', { on: true, acceptLanguage: 'pl' })).toEqual(r307('/pl/de/p/x'));
    expect(parse('/de/p/x', { on: false })).toEqual(render('pl-PL', '', '/de/p/x'));
  });

  it('a channel with one language and the setting off changes no URL; /pl answers 308', () => {
    const one: ChannelUrlLanguage[] = [{ languageCode: 'pl-PL', prefix: 'pl', prefixed: false, isDefault: true }];
    expect(parse('/c/x', { on: false, languages: one })).toEqual(render('pl-PL', '', '/c/x'));
    expect(parse('/pl/c/x', { on: false, languages: one })).toEqual(r308('/c/x'));
  });
});

const state = (current: string, on = true): UrlLanguageState => ({ languages: plEn(on), aliases: [], current });

describe('localizePath — storefront-navigation §2', () => {
  it.each([
    ['', ''],
    ['#top', '#top'],
    ['?q=1', '?q=1'],
    ['mailto:a@b.c', 'mailto:a@b.c'],
    ['tel:+48', 'tel:+48'],
    ['https://example.com/x', 'https://example.com/x'],
    ['//cdn.example.com/x', '//cdn.example.com/x'],
    ['/en/p/drill', '/en/p/drill'],
    ['/pl', '/pl'],
    ['/api/v1/x', '/api/v1/x'],
    ['/offline', '/offline'],
    ['/robots.txt', '/robots.txt'],
    ['/', '/en'],
    ['/?q=1', '/en?q=1'],
    ['/c/x?sort=price#top', '/en/c/x?sort=price#top'],
  ])('%s → %s under /en', (input, output) => {
    expect(localizePath(input, state('en-US'))).toBe(output);
  });

  it('leaves the unprefixed default language unprefixed', () => {
    expect(localizePath('/c/x', state('pl-PL', false))).toBe('/c/x');
    expect(localizePath('/', state('pl-PL', false))).toBe('/');
  });

  it('localizes for another language when one is named', () => {
    expect(localizePath('/c/x', state('pl-PL', false), 'en-US')).toBe('/en/c/x');
    expect(localizePath('/c/x', state('en-US', true), 'pl-PL')).toBe('/pl/c/x');
  });

  it('is idempotent on an alias as well as a prefix', () => {
    const s: UrlLanguageState = { languages: plEnUsGb(true), aliases: EN_ALIAS, current: 'en-GB' };
    expect(localizePath('/en/p/x', s)).toBe('/en/p/x');
    expect(localizePath('/p/x', s)).toBe('/en-gb/p/x');
  });

  it('answers the path unchanged when the state has no URL languages (identity unknown)', () => {
    expect(localizePath('/c/x', { languages: [], aliases: [], current: 'pl-PL' })).toBe('/c/x');
  });
});

describe('stripLocalePrefix', () => {
  it('removes a channel prefix and keeps everything else', () => {
    expect(stripLocalePrefix('/en/p/drill', state('en-US'))).toBe('/p/drill');
    expect(stripLocalePrefix('/en', state('en-US'))).toBe('/');
    expect(stripLocalePrefix('/c/x', state('pl-PL', false))).toBe('/c/x');
    expect(stripLocalePrefix('/de/x', state('pl-PL'))).toBe('/de/x');
  });
});

describe('pageAlternates — url-shape §8', () => {
  it('setting on: prefixed canonical, one alternate per channel language, unprefixed x-default', () => {
    expect(pageAlternates('/c/narzedzia', state('pl-PL', true))).toEqual({
      canonical: '/pl/c/narzedzia',
      languages: { 'pl-PL': '/pl/c/narzedzia', 'en-US': '/en/c/narzedzia', 'x-default': '/c/narzedzia' },
    });
  });

  it('setting off: the default language is unprefixed', () => {
    expect(pageAlternates('/c/narzedzia', state('pl-PL', false))).toEqual({
      canonical: '/c/narzedzia',
      languages: { 'pl-PL': '/c/narzedzia', 'en-US': '/en/c/narzedzia', 'x-default': '/c/narzedzia' },
    });
  });

  it('home page canonical carries no trailing slash', () => {
    expect(pageAlternates('/', state('en-US', true)).canonical).toBe('/en');
  });
});
