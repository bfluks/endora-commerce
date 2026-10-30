import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ChannelUrlLanguage } from '@endora-commerce/contracts';
import type { UrlLanguageState } from '../../lib/i18n/locale-path';

/**
 * Feature 167 — the adapters every storefront link and redirect goes through
 * (`specs/167-storefront-locale-path/contracts/storefront-navigation.md` §3):
 * `<LocalizedLink>` and `useLocalizedPath()` read the state the root layout provides;
 * `localizedPath()`, `localeRedirect()` and `localePermanentRedirect()` read it from
 * the server context (the forwarded `x-storefront-language` and the channel read).
 */

const plEn = (on: boolean): ChannelUrlLanguage[] => [
  { languageCode: 'pl-PL', prefix: 'pl', prefixed: on, isDefault: true },
  { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
];

const server: { urlState: UrlLanguageState } = {
  urlState: { languages: plEn(true), aliases: [], current: 'en-US' },
};

class RedirectSignal extends Error {
  constructor(
    readonly to: string,
    readonly permanent: boolean,
  ) {
    super(to);
  }
}

vi.mock('../../lib/server-context', () => ({
  getServerContext: vi.fn(async () => ({ urlState: server.urlState })),
}));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new RedirectSignal(to, false);
  }),
  permanentRedirect: vi.fn((to: string) => {
    throw new RedirectSignal(to, true);
  }),
}));

const { LocalizedLink, LocalePathProvider, useLocalizedPath } = await import('../../lib/i18n/localized-link');
const { localizedPath, localeRedirect, localePermanentRedirect } = await import('../../lib/i18n/navigation');

function Probe({ path, languageCode }: { path: string; languageCode?: string }) {
  const localize = useLocalizedPath();
  return <span>{localize(path, languageCode)}</span>;
}

beforeEach(() => {
  server.urlState = { languages: plEn(true), aliases: [], current: 'en-US' };
});

describe('<LocalizedLink>', () => {
  it('prefixes a logical href with the current language', () => {
    const html = renderToString(
      <LocalePathProvider value={{ languages: plEn(true), aliases: [], current: 'en-US' }}>
        <LocalizedLink href="/c/narzedzia?sort=price">Tools</LocalizedLink>
      </LocalePathProvider>,
    );
    expect(html).toContain('href="/en/c/narzedzia?sort=price"');
  });

  it('leaves the unprefixed default language unprefixed', () => {
    const html = renderToString(
      <LocalePathProvider value={{ languages: plEn(false), aliases: [], current: 'pl-PL' }}>
        <LocalizedLink href="/cart">Cart</LocalizedLink>
      </LocalePathProvider>,
    );
    expect(html).toContain('href="/cart"');
  });

  it('leaves an already-prefixed and an external href unchanged', () => {
    const html = renderToString(
      <LocalePathProvider value={{ languages: plEn(true), aliases: [], current: 'en-US' }}>
        <LocalizedLink href="/pl/p/wiertarka">A</LocalizedLink>
        <LocalizedLink href="https://example.com/x">B</LocalizedLink>
      </LocalePathProvider>,
    );
    expect(html).toContain('href="/pl/p/wiertarka"');
    expect(html).toContain('href="https://example.com/x"');
  });

  it('without a provider renders the href as written', () => {
    expect(renderToString(<LocalizedLink href="/cart">Cart</LocalizedLink>)).toContain('href="/cart"');
  });
});

describe('useLocalizedPath', () => {
  it('localizes for the current language or a named one', () => {
    const html = renderToString(
      <LocalePathProvider value={{ languages: plEn(true), aliases: [], current: 'en-US' }}>
        <Probe path="/" />
        <Probe path="/search?q=x" languageCode="pl-PL" />
      </LocalePathProvider>,
    );
    expect(html).toContain('<span>/en</span>');
    expect(html).toContain('<span>/pl/search?q=x</span>');
  });
});

describe('server adapters', () => {
  it('localizedPath reads the server context', async () => {
    expect(await localizedPath('/account/orders')).toBe('/en/account/orders');
    expect(await localizedPath('/account/orders', 'pl-PL')).toBe('/pl/account/orders');
    expect(await localizedPath('/en/account')).toBe('/en/account');
  });

  it('localeRedirect and localePermanentRedirect redirect to the localized path', async () => {
    await expect(localeRedirect('/login?next=%2Fen')).rejects.toMatchObject({ to: '/en/login?next=%2Fen', permanent: false });
    server.urlState = { languages: plEn(false), aliases: [], current: 'pl-PL' };
    await expect(localePermanentRedirect('/c/x')).rejects.toMatchObject({ to: '/c/x', permanent: true });
  });
});
