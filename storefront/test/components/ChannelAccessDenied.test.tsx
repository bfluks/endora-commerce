import { renderToString } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesChannelAccessResponse } from '@endora-commerce/contracts';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * A signed-in buyer on a store their account may not use
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §4, FR-029).
 *
 * The backend refuses every call of such a buyer on this store with
 * `403 SALES_CHANNEL_NOT_PERMITTED`. The root layout already asks who the buyer
 * is, so it is where the refusal is met: instead of the page — which would be
 * built from refused reads — it renders a screen that says what happened, lists
 * the stores the account can use, and offers to sign out. It does not redirect:
 * every page of the store would redirect again, and the sign-in page cannot help
 * a buyer who is already signed in.
 *
 * The first half renders the screen; the second renders the root layout, with
 * everything it composes around the page replaced, and reads which branch it
 * took.
 */

type Access = SalesChannelAccessResponse['data'];

const TWO_STORES: Access = {
  channelCode: 'trade',
  anonymousAccess: false,
  viewer: 'customer',
  permitted: false,
  reason: 'not_permitted',
  permittedChannels: [
    {
      code: 'default',
      name: { 'en-US': 'Retail store', 'pl-PL': 'Sklep detaliczny' },
      storefrontUrl: 'https://shop.example.com',
    },
    { code: 'export', name: { 'en-US': 'Export desk' }, storefrontUrl: null },
  ],
};

const state: {
  locale: string;
  me: () => Promise<unknown>;
  access: Access | null;
} = {
  locale: 'en-US',
  me: async () => ({ customerAccount: { id: 'c1' }, organization: null, impersonation: null }),
  access: TWO_STORES,
};

const requestHeaders = new Map<string, string>([['x-pathname', '/catalog']]);
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => requestHeaders.get(name.toLowerCase()) ?? null }),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));
vi.mock('../../app/globals.css', () => ({}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    config: { languages: [], defaultLanguageCode: state.locale },
    locale: state.locale,
    currency: undefined,
    ctx: { salesChannelCode: 'trade', locale: state.locale, viewerSession: 'session' },
    theme: { code: 'industria', unknownRequest: null },
    modules: { isPresent: () => true, absentIds: [] },
    anonymousAccess: false,
  }),
}));
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => 'session',
  getAnonCartCookie: async () => null,
  clearSessionCookie: vi.fn(),
}));
vi.mock('../../lib/api/account', () => ({ getMe: () => state.me() }));
const accessRead = vi.fn(async () => state.access);
vi.mock('../../lib/api/sales-channel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/sales-channel')>()),
  getSalesChannelAccess: (...args: unknown[]) => accessRead(...(args as [])),
}));
vi.mock('../../lib/api/megamenu', () => ({ getActiveMegamenu: async () => null }));
vi.mock('../../lib/dictionary/client', () => ({ fetchDictionary: async () => ({}) }));
vi.mock('../../lib/api/cart', () => ({ getCartItemCount: async () => 0 }));
vi.mock('../../lib/api/speculation-rules', () => ({
  getSpeculationRulesConfig: async () => ({ enabled: false, eagerness: 'moderate' }),
}));
for (const path of [
  '../../lib/api/analytics-config',
  '../../lib/api/linkedin-config',
  '../../lib/api/meta-config',
  '../../lib/api/gtm-config',
]) {
  vi.doMock(path, () => ({
    getGoogleAnalyticsConfig: async () => ({}),
    getLinkedInAdsConfig: async () => ({}),
    getMetaAdsConfig: async () => ({}),
    getGoogleTagManagerConfig: async () => ({}),
  }));
}
const nothing = (): null => null;
const through = ({ children }: { children?: ReactNode }): ReactNode => children;
vi.mock('../../components/Header', () => ({ Header: nothing }));
vi.mock('../../components/Footer', () => ({ Footer: nothing }));
vi.mock('../../components/mobile/MobileTabBar', () => ({ MobileTabBar: nothing }));
vi.mock('../../components/Hook', () => ({ Hook: nothing }));
vi.mock('../../components/PwaRegister', () => ({ PwaRegister: nothing }));
vi.mock('../../components/pwa/InstallPrompt', () => ({ InstallPrompt: nothing }));
vi.mock('../../components/pwa/PushOptIn', () => ({ PushOptIn: nothing }));
vi.mock('../../components/SpeculationRules', () => ({ SpeculationRules: nothing }));
vi.mock('../../components/RouteTransition', () => ({ RouteTransition: through }));
vi.mock('../../components/NavigationFeedback', () => ({ NavigationFeedback: nothing }));
vi.mock('../../components/CartMergeToast', () => ({ CartMergeToast: nothing }));
vi.mock('../../components/checkout/CheckoutHeader', () => ({ CheckoutHeader: nothing }));
vi.mock('../../components/HeaderSwitch', () => ({ HeaderSwitch: nothing }));
vi.mock('../../components/BlockRenderScope', () => ({ BlockRenderScope: through }));
vi.mock('../../lib/dictionary/DictionaryProvider', () => ({ DictionaryProvider: through }));
vi.mock('../../components/analytics/GoogleAnalytics', () => ({ GoogleAnalytics: nothing }));
vi.mock('../../components/analytics/AnalyticsProvider', () => ({ AnalyticsProvider: nothing }));
vi.mock('../../components/analytics/LinkedInInsightTag', () => ({ LinkedInInsightTag: nothing }));
vi.mock('../../components/analytics/MetaPixel', () => ({ MetaPixel: nothing }));
vi.mock('../../components/analytics/GoogleTagManager', () => ({ GoogleTagManager: nothing }));
vi.mock('../../components/analytics/GtmProvider', () => ({ GtmProvider: nothing }));
vi.mock('../../components/analytics/ConsentBanner', () => ({ ConsentBanner: nothing }));
vi.mock('../../components/analytics/CookieConsentMessage', () => ({ CookieConsentMessage: nothing }));

const { ChannelAccessDenied } = await import('../../components/ChannelAccessDenied');
const { default: RootLayout } = await import('../../app/layout');

const PAGE = <p>PAGE-CONTENT</p>;

async function renderLayout(): Promise<string> {
  return renderToString((await RootLayout({ children: PAGE })) as ReactElement);
}

beforeEach(() => {
  state.locale = 'en-US';
  state.access = TWO_STORES;
  state.me = async () => ({ customerAccount: { id: 'c1' }, organization: null, impersonation: null });
  accessRead.mockClear();
});

describe('ChannelAccessDenied', () => {
  const signOut = async (): Promise<void> => {};

  it('says what happened, in English', () => {
    const html = renderToString(<ChannelAccessDenied locale="en-US" access={TWO_STORES} signOut={signOut} />);
    expect(html).toContain('No access to this store');
    expect(html).toContain('Your account is not set up to buy in this store.');
    expect(html).toContain('Stores you can use:');
  });

  it('says it in Polish', () => {
    const html = renderToString(<ChannelAccessDenied locale="pl-PL" access={TWO_STORES} signOut={signOut} />);
    expect(html).toContain('Brak dostępu do tego sklepu');
    expect(html).toContain('Twoje konto nie ma uprawnień do zakupów w tym sklepie.');
    expect(html).toContain('Sklepy, z których możesz korzystać:');
    expect(html).toContain('Wyloguj się');
    // The store's own name in the page's language, and another language's when it has none.
    expect(html).toContain('Sklep detaliczny');
    expect(html).toContain('Export desk');
  });

  it('links a store that has an address and names one that has none', () => {
    const html = renderToString(<ChannelAccessDenied locale="en-US" access={TWO_STORES} signOut={signOut} />);
    expect(html).toMatch(/<a [^>]*href="https:\/\/shop.example.com"[^>]*>Retail store<\/a>/);
    expect(html).toContain('Export desk');
    expect(html).not.toMatch(/<a [^>]*>Export desk<\/a>/);
  });

  it('leaves the list out when there is nothing to list, and keeps the way out', () => {
    for (const access of [null, { ...TWO_STORES, permittedChannels: [] }]) {
      const html = renderToString(<ChannelAccessDenied locale="en-US" access={access} signOut={signOut} />);
      expect(html).not.toContain('Stores you can use:');
      expect(html).toContain('<form');
      expect(html).toContain('Sign out');
      expect(html).toContain('contact your organisation’s administrator');
    }
  });

  it('asks search engines not to index it', () => {
    const html = renderToString(<ChannelAccessDenied locale="en-US" access={TWO_STORES} signOut={signOut} />);
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
  });

  it('is a page heading a screen reader can land on', () => {
    const html = renderToString(<ChannelAccessDenied locale="en-US" access={TWO_STORES} signOut={signOut} />);
    expect(html).toMatch(/<h1[^>]*>No access to this store<\/h1>/);
  });
});

describe('the root layout', () => {
  it('renders the screen instead of the page when the account may not use this store', async () => {
    state.me = async () => {
      throw new StorefrontApiError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'no');
    };
    const html = await renderLayout();
    expect(html).toContain('No access to this store');
    expect(html).toContain('Retail store');
    expect(html).not.toContain('PAGE-CONTENT');
    // Asked for the viewer's own answer, with the viewer's session.
    expect(accessRead).toHaveBeenCalledWith(expect.objectContaining({ viewerSession: 'session' }));
  });

  it('renders the page for a buyer the store serves', async () => {
    const html = await renderLayout();
    expect(html).toContain('PAGE-CONTENT');
    expect(html).not.toContain('No access to this store');
    expect(accessRead).not.toHaveBeenCalled();
  });

  it('renders the page when the buyer cannot be read for another reason', async () => {
    state.me = async () => {
      throw new StorefrontApiError(401, 'UNAUTHENTICATED', 'expired');
    };
    const html = await renderLayout();
    expect(html).toContain('PAGE-CONTENT');
  });

  it('sends a session the store no longer recognises to sign in again, rather than render an empty shop', async () => {
    state.me = async () => {
      throw new StorefrontApiError(403, 'SALES_CHANNEL_SIGN_IN_REQUIRED', 'sign in');
    };
    await expect(renderLayout()).rejects.toMatchObject({
      digest: expect.stringContaining('/session-expired?next=%2Fcatalog'),
    });
  });
});
