import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ChannelUrlLanguage } from '@endora-commerce/contracts';
import { MESSAGES } from '../../lib/i18n/messages';

/**
 * Feature 167 (US4, FR-023, OR-6, OR-11) — the header language switcher is a list of
 * real links, one per **channel** language, to the current page in that language. It
 * works without JavaScript; with it, a product page's option is upgraded to the
 * product's own key in that language (the `hreflang` alternates in the head), and
 * following an option also writes the `lang` cookie so the next unprefixed visit lands
 * in the chosen language.
 */

let currentPath = '/pl/search';
let currentSearch = 'q=wiertarka';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({
  useDictionary: () => ({
    languages: [
      { code: 'pl-PL', label: 'Polish', nativeLabel: 'Polski' },
      { code: 'en-US', label: 'English (US)', nativeLabel: 'English' },
    ],
  }),
}));

const { LocaleSwitcher, alternatePath, languageCookie } = await import('../../components/HeaderPreferenceSwitchers');
const { LocalePathProvider } = await import('../../lib/i18n/localized-link');

const plEn: ChannelUrlLanguage[] = [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

function render(languages: ChannelUrlLanguage[] = plEn, current = 'pl-PL'): string {
  return renderToString(
    <LocalePathProvider value={{ languages, aliases: [], current }}>
      <LocaleSwitcher label="Language" />
    </LocalePathProvider>,
  );
}

beforeEach(() => {
  currentPath = '/pl/search';
  currentSearch = 'q=wiertarka';
});

describe('LocaleSwitcher', () => {
  it('renders one link per channel language to the same page in that language, query kept (US4 #3)', () => {
    const html = render();
    expect(html).toMatch(/<a[^>]*href="\/en\/search\?q=wiertarka"[^>]*>English<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/pl\/search\?q=wiertarka"[^>]*>Polski<\/a>/);
  });

  it('labels each option in its own language and marks it with hreflang and lang', () => {
    const html = render();
    expect(html).toMatch(/<a[^>]*hrefLang="en-US"[^>]*lang="en-US"|<a[^>]*lang="en-US"[^>]*hrefLang="en-US"/i);
  });

  it('marks the current language with aria-current (US4 #5)', () => {
    const html = render();
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*>Polski<\/a>/);
    expect(html).not.toMatch(/<a[^>]*aria-current="page"[^>]*>English<\/a>/);
  });

  it('is a named group', () => {
    expect(render()).toMatch(/<nav[^>]*aria-label="Language"/);
  });

  it('renders nothing for a channel with one language (US4 #4)', () => {
    const html = render([plEn[0]!]);
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('<a');
  });

  it('links the unprefixed default language unprefixed when the setting is off', () => {
    currentPath = '/en/c/narzedzia';
    currentSearch = '';
    const html = render(
      [
        { languageCode: 'pl-PL', prefix: 'pl', prefixed: false, isDefault: true },
        { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
      ],
      'en-US',
    );
    expect(html).toMatch(/href="\/c\/narzedzia"[^>]*>Polski</);
    expect(html).toMatch(/href="\/en\/c\/narzedzia"[^>]*>English</);
  });

  it('writes the lang cookie for one year, site-wide, samesite=lax (OR-11)', () => {
    expect(languageCookie('en-US')).toBe(`lang=en-US; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`);
  });
});

describe('alternatePath — the switcher stays on the visitor\'s origin', () => {
  it('keeps only the path, query and fragment of an absolute alternate', () => {
    // `metadataBase` makes the head's alternates absolute, on the configured site
    // URL; a deployment serving a channel on another host must not be sent there.
    expect(alternatePath('https://shop.example.com/pl/o-nas?x=1#top')).toBe('/pl/o-nas?x=1#top');
    expect(alternatePath('/en/about-us')).toBe('/en/about-us');
  });

  it('refuses a value that is not a URL', () => {
    expect(alternatePath('http://[bad')).toBeNull();
  });
});

describe('header.language', () => {
  it('names the switcher in English and Polish', () => {
    expect(MESSAGES['en-US']!['header.language']).toBe('Language');
    expect(MESSAGES['pl-PL']!['header.language']).toBe('Język');
  });
});
