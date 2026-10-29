import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 163, owner decision L-1 = A (2026-10-26) — on the product page an
 * explicit `?lang=` beats the visitor's `lang` cookie.
 *
 * Product URL keys are per language (FR-071), and every product URL the
 * platform emits for a non-default language is `/p/<key>?lang=<L>`. A visitor
 * whose cookie says `pl-PL` opening `/p/schuh?lang=de-DE` must get the German
 * page — rendered in Polish, the German key `schuh` does not resolve and the
 * link answers not-found. The page passes the query value to
 * `getServerContext({ langOverride })`; only that call site changes.
 *
 * What does not change:
 * - a `?lang=` that is not an enabled language is ignored, and the ordinary
 *   chain decides — cookie, then `Accept-Language`, then the channel default;
 * - without a `?lang=` the cookie still wins over `Accept-Language`;
 * - a GET never writes the cookie: opening a link is not choosing a
 *   preference, and only the header switcher stores one.
 */

const state: {
  cookies: Record<string, string>;
  acceptLanguage: string | null;
} = { cookies: {}, acceptLanguage: null };

const cookieSet = vi.fn();

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => {
    const h = new Headers();
    if (state.acceptLanguage !== null) h.set('accept-language', state.acceptLanguage);
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
      { code: 'de-DE', isActive: true },
      { code: 'it-IT', isActive: false },
    ],
  })),
}));
vi.mock('../../lib/api/module-presence', () => ({
  getModulePresence: vi.fn(async () => ({ isPresent: () => true })),
}));
vi.mock('../../lib/api/sales-channel', () => ({
  getPublicSalesChannel: vi.fn(async () => ({ code: 'retail', anonymousAccess: true })),
}));

const { getServerContext } = await import('../../lib/server-context');

beforeEach(() => {
  state.cookies = {};
  state.acceptLanguage = null;
  cookieSet.mockReset();
});

describe('getServerContext — the product page language (L-1 = A)', () => {
  it('an enabled ?lang= beats the lang cookie', async () => {
    state.cookies = { lang: 'pl-PL' };
    const { locale, ctx } = await getServerContext({ langOverride: 'de-DE' });
    expect(locale).toBe('de-DE');
    // The backend is asked in the same language, so the German key resolves.
    expect(ctx.locale).toBe('de-DE');
  });

  it('matches the enabled language case-insensitively and answers its canonical code', async () => {
    state.cookies = { lang: 'pl-PL' };
    const { locale } = await getServerContext({ langOverride: 'de-de' });
    expect(locale).toBe('de-DE');
  });

  it('ignores a ?lang= that is no language of the store, and the cookie decides', async () => {
    state.cookies = { lang: 'pl-PL' };
    state.acceptLanguage = 'de-DE';
    const { locale } = await getServerContext({ langOverride: 'fr-FR' });
    expect(locale).toBe('pl-PL');
  });

  it('ignores a ?lang= naming an inactive language, and the cookie decides', async () => {
    state.cookies = { lang: 'pl-PL' };
    const { locale } = await getServerContext({ langOverride: 'it-IT' });
    expect(locale).toBe('pl-PL');
  });

  it('falls back to Accept-Language when neither ?lang= nor the cookie is a language of the store', async () => {
    state.cookies = { lang: 'xx-XX' };
    state.acceptLanguage = 'de-DE,de;q=0.9';
    const { locale } = await getServerContext({ langOverride: 'fr-FR' });
    expect(locale).toBe('de-DE');
  });

  it('without ?lang= the cookie still wins over Accept-Language', async () => {
    state.cookies = { lang: 'pl-PL' };
    state.acceptLanguage = 'de-DE';
    expect((await getServerContext()).locale).toBe('pl-PL');
    expect((await getServerContext({ langOverride: null })).locale).toBe('pl-PL');
  });

  it('without a cookie an enabled ?lang= beats Accept-Language', async () => {
    state.acceptLanguage = 'pl-PL';
    const { locale } = await getServerContext({ langOverride: 'de-DE' });
    expect(locale).toBe('de-DE');
  });

  it('never writes the lang cookie: opening a link is not choosing a preference', async () => {
    state.cookies = { lang: 'pl-PL' };
    await getServerContext({ langOverride: 'de-DE' });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
