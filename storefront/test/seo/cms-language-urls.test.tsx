import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResolvedPage } from '@endora-commerce/contracts';

/**
 * A CMS page's address per language on the storefront
 * (`specs/163-page-builder-marketing-pages/` R24, issue #521).
 *
 * - Feature 167: the language is the path's (`/en/about-us`); `?lang=` is not read.
 * - The backend answers the page at its address in the served language (`path`) and
 *   the URL built for it (`url`, under the language prefix); a request under another
 *   address — the slug of the language the reader switched away from — answers a
 *   permanent redirect to that URL.
 * - The canonical is `url`; every language is an `hreflang` alternate, plus
 *   `x-default` — the default language's URL without its prefix.
 */

const state: { page: CmsResolvedPage | null; calls: unknown[] } = { page: null, calls: [] };
const redirects: string[] = [];

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  permanentRedirect: (url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async (...args: unknown[]) => {
    state.calls.push(args);
    return {
      ctx: { locale: 'pl-PL', salesChannelCode: 'web' },
      locale: 'pl-PL',
      urlState: {
        languages: [
          { languageCode: 'pl-PL', prefix: 'pl', prefixed: true, isDefault: true },
          { languageCode: 'en-US', prefix: 'en', prefixed: true, isDefault: false },
        ],
        aliases: [],
        current: 'pl-PL',
      },
    };
  },
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsPageBySlug: async () => state.page,
  normalizeCmsUrlPath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: null }),
}));
vi.mock('../../components/CmsPageRenderer', () => ({
  CmsPageRenderer: () => <div data-testid="page-body" />,
}));
vi.mock('../../components/seo/OrganizationJsonLd', () => ({
  OrganizationJsonLd: () => null,
}));

const route = await import('../../app/(content)/[...slug]/page');
const CmsContentPage = route.default;

function page(overrides: Partial<CmsResolvedPage> = {}): CmsResolvedPage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'about-us',
    path: 'o-nas',
    url: '/pl/o-nas',
    alternates: [
      { language: 'pl-PL', url: '/pl/o-nas' },
      { language: 'en-US', url: '/en/about-us' },
    ],
    name: 'O nas',
    language: 'pl-PL',
    meta: { title: null, description: null, keywords: null },
    content: { data: { root: { props: {} }, content: [] } },
    embeds: { blocks: {}, templates: {} },
    assets: {},
    breadcrumbs: { visible: true, scheme: 'light', trail: [] },
    share: { imageUrl: null },
    languages: ['en-US', 'pl-PL'],
    ...overrides,
  };
}

async function render(segments: string[], lang?: string): Promise<string> {
  return renderToString(
    await CmsContentPage({
      params: Promise.resolve({ slug: segments }),
      searchParams: Promise.resolve(lang ? { lang } : {}),
    }),
  );
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://shop.example.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.page = null;
  state.calls.length = 0;
  redirects.length = 0;
});

describe('a CMS page in several languages', () => {
  it('renders at its address in the served language, named in it', async () => {
    state.page = page();
    const html = await render(['o-nas'], 'pl-PL');
    expect(redirects).toEqual([]);
    expect(html).toContain('O nas');
    // WCAG 3.1.2: the page marks the language it is written in.
    expect(html).toContain('lang="pl-PL"');
  });

  it('reads no ?lang= override: the path decides the language (feature 167)', async () => {
    state.page = page();
    await render(['o-nas'], 'en-US');
    expect(state.calls.every((args) => (args as unknown[]).length === 0)).toBe(true);
  });

  it('redirects the slug of another language permanently to the URL of the served one', async () => {
    state.page = page();
    await expect(render(['about-us'])).rejects.toThrow('NEXT_REDIRECT');
    expect(redirects).toEqual(['/pl/o-nas']);
  });

  it('declares the served language URL canonical and every language as an hreflang alternate', async () => {
    state.page = page();
    const metadata = await route.generateMetadata({
      params: Promise.resolve({ slug: ['o-nas'] }),
      searchParams: Promise.resolve({ lang: 'pl-PL' }),
    });
    expect(metadata.alternates).toEqual({
      canonical: '/pl/o-nas',
      languages: { 'pl-PL': '/pl/o-nas', 'en-US': '/en/about-us', 'x-default': '/o-nas' },
    });
    expect(metadata.openGraph).toMatchObject({ url: '/pl/o-nas' });
    expect(metadata.title).toBe('O nas');
  });

  it('lists only its own language and x-default for a page in one language (FR-030)', async () => {
    state.page = page({ alternates: [{ language: 'pl-PL', url: '/pl/o-nas' }], languages: ['pl-PL'] });
    const metadata = await route.generateMetadata({ params: Promise.resolve({ slug: ['o-nas'] }) });
    expect(metadata.alternates).toEqual({
      canonical: '/pl/o-nas',
      languages: { 'pl-PL': '/pl/o-nas', 'x-default': '/o-nas' },
    });
  });
});
