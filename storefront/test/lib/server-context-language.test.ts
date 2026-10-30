import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 167 (`specs/167-storefront-locale-path/`, FR-005, FR-010, FR-022, OR-4) —
 * the page language is the path's. The middleware parses the prefix and forwards the
 * language on `x-storefront-language`; `getServerContext` reads it, validated against
 * the **channel's** URL languages (never the platform-wide active list), and falls back
 * to the channel default. The `lang` cookie and `Accept-Language` decide nothing for a
 * rendered page any more — the cookie only chooses the target of the middleware's 307
 * (OR-11) — and the product page's `?lang=` override (163's interim) is gone.
 *
 * Replaces 163's L-1 = A suite, whose `?lang=` override this feature retires.
 */

const state: {
  cookies: Record<string, string>;
  acceptLanguage: string | null;
  language: string | null;
  prefix: string | null;
  channel: Record<string, unknown> | null;
} = { cookies: {}, acceptLanguage: null, language: null, prefix: null, channel: null };

const cookieSet = vi.fn();

const CHANNEL = {
  code: 'retail',
  anonymousAccess: true,
  defaultLanguage: 'pl-PL',
  languages: ['pl-PL', 'en-US'],
  prefixDefaultLanguage: true,
  urlLanguages: [
    { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
    { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
  ],
  urlLanguageAliases: [],
};

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (state.acceptLanguage !== null) h.set('accept-language', state.acceptLanguage);
    if (state.language !== null) h.set('x-storefront-language', state.language);
    if (state.prefix !== null) h.set('x-storefront-language-prefix', state.prefix);
    return h;
  }),
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      state.cookies[name] !== undefined ? { name, value: state.cookies[name] } : undefined,
    set: cookieSet,
  })),
}));
vi.mock('../../lib/api/i18n', () => ({
  getI18nConfig: vi.fn(async () => ({
    defaultLanguageCode: 'en-US',
    languages: [
      { code: 'en-US', isActive: true },
      { code: 'pl-PL', isActive: true },
      // Active on the platform, but not a language of the channel.
      { code: 'de-DE', isActive: true },
    ],
  })),
}));
vi.mock('../../lib/api/module-presence', () => ({
  getModulePresence: vi.fn(async () => ({ isPresent: () => true })),
}));
vi.mock('../../lib/api/sales-channel', () => ({
  getPublicSalesChannel: vi.fn(async () => state.channel),
}));
vi.mock('../../lib/api/brand', () => ({
  getBrandTokens: vi.fn(async () => null),
}));

const { getServerContext } = await import('../../lib/server-context');

beforeEach(() => {
  state.cookies = {};
  state.acceptLanguage = null;
  state.language = null;
  state.prefix = null;
  state.channel = CHANNEL;
  cookieSet.mockReset();
});

describe('getServerContext — the path language (feature 167)', () => {
  it('renders the language the middleware forwarded, whatever the cookie and Accept-Language say', async () => {
    state.language = 'en-US';
    state.prefix = 'en';
    state.cookies = { lang: 'pl-PL' };
    state.acceptLanguage = 'pl-PL';
    const { locale, ctx, urlState } = await getServerContext();
    expect(locale).toBe('en-US');
    // The backend is asked in the path language.
    expect(ctx.locale).toBe('en-US');
    expect(urlState).toEqual({ languages: CHANNEL.urlLanguages, aliases: [], current: 'en-US' });
  });

  it('matches the forwarded language case-insensitively and answers the channel code', async () => {
    state.language = 'en-us';
    expect((await getServerContext()).locale).toBe('en-US');
  });

  it("falls back to the channel default for a language outside the channel's list (FR-005)", async () => {
    state.language = 'de-DE';
    expect((await getServerContext()).locale).toBe('pl-PL');
  });

  it('without a forwarded language renders the channel default — no cookie, no Accept-Language', async () => {
    state.cookies = { lang: 'en-US' };
    state.acceptLanguage = 'en-US';
    expect((await getServerContext()).locale).toBe('pl-PL');
  });

  it('without a channel read falls back to the configured default', async () => {
    state.channel = null;
    state.cookies = { lang: 'pl-PL' };
    const { locale, urlState } = await getServerContext();
    expect(locale).toBe('en-US');
    expect(urlState.languages).toEqual([]);
  });

  it('never writes the lang cookie', async () => {
    state.language = 'en-US';
    await getServerContext();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
