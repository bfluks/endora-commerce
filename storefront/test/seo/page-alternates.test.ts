import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelUrlLanguage } from '@endora-commerce/contracts';
import type { UrlLanguageState } from '../../lib/i18n/locale-path';

/**
 * Feature 167 (US5, FR-030, url-shape §8) — every indexable page declares its canonical
 * under the current language's prefix, one `hreflang` alternate per channel language
 * and `x-default` → the unprefixed URL. Pages whose path is the same in every language
 * do it through `localizedAlternates`; the product page through the backend's `paths`
 * (`pdp-redirect.test.ts`). Cart, checkout and account pages declare none.
 *
 * Rendering each page's metadata would stand up every read it makes; the helper is
 * held here by behaviour, and the pages by their source (as `pdp-redirect.test.ts`
 * holds the product page).
 */

const server: { urlState: UrlLanguageState } = { urlState: { languages: [], aliases: [], current: 'pl-PL' } };
vi.mock('../../lib/server-context', () => ({ getServerContext: vi.fn(async () => ({ urlState: server.urlState })) }));

const { localizedAlternates } = await import('../../lib/i18n/navigation');

const plEn = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

beforeEach(() => {
  server.urlState = { languages: plEn(true), aliases: [], current: 'pl-PL' };
});

describe('localizedAlternates', () => {
  it('setting on (US5 #1)', async () => {
    expect(await localizedAlternates('/c/narzedzia')).toEqual({
      canonical: '/pl/c/narzedzia',
      languages: { 'pl-PL': '/pl/c/narzedzia', 'en-US': '/en/c/narzedzia', 'x-default': '/c/narzedzia' },
    });
  });

  it('setting off (US5 #2)', async () => {
    server.urlState = { languages: plEn(false), aliases: [], current: 'pl-PL' };
    expect(await localizedAlternates('/c/narzedzia')).toEqual({
      canonical: '/c/narzedzia',
      languages: { 'pl-PL': '/c/narzedzia', 'en-US': '/en/c/narzedzia', 'x-default': '/c/narzedzia' },
    });
  });

  it('the canonical of an English page is English', async () => {
    server.urlState = { languages: plEn(true), aliases: [], current: 'en-US' };
    expect((await localizedAlternates('/')).canonical).toBe('/en');
  });

  it('without URL languages: the logical path and no alternates', async () => {
    server.urlState = { languages: [], aliases: [], current: 'pl-PL' };
    expect(await localizedAlternates('/blog')).toEqual({ canonical: '/blog' });
  });
});

describe('which pages declare localized alternates', () => {
  const app = resolve(import.meta.dirname, '../../app');
  const source = (path: string): string => readFileSync(resolve(app, path), 'utf8');

  it.each([
    'page.tsx',
    '(catalog)/catalog/page.tsx',
    '(catalog)/c/[slug]/page.tsx',
    '(catalog)/search/page.tsx',
    '(content)/[...slug]/page.tsx',
    'blog/[[...slug]]/page.tsx',
    'kontakt/page.tsx',
  ])('%s computes its alternates with localizedAlternates', (path) => {
    const text = source(path);
    expect(text).toContain('localizedAlternates(');
    // Every canonical it declares is the localized one.
    expect(text).not.toMatch(/alternates: \{ canonical: (?!alternates\.canonical)/);
  });

  it('the product page publishes the backend x-default with its alternates', () => {
    expect(readFileSync(resolve(app, '(catalog)/p/[slug]/resolution.ts'), 'utf8')).toContain("'x-default': paths.xDefault");
  });

  it.each(['(commerce)/cart/page.tsx', '(commerce)/checkout/page.tsx', '(account)/account/page.tsx'])(
    '%s declares no alternates',
    (path) => {
      const text = source(path);
      expect(text).not.toContain('localizedAlternates(');
      expect(text).not.toMatch(/alternates:\s*\{/);
    },
  );
});
