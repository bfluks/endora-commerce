import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResolvedPage } from '@endora-commerce/contracts';

/**
 * Hierarchical CMS page addresses on the storefront
 * (`specs/163-page-builder-marketing-pages/` R19D, T285).
 *
 * - A page is canonical at `/<path>`, the path the backend resolved for the
 *   request's channel; the flat slug of a nested page answers a permanent
 *   redirect there.
 * - The breadcrumb links are the ancestors' paths.
 * - The canonical link and `og:url` are the path.
 */

const state: { page: CmsResolvedPage | null; homeSlug: string | null } = { page: null, homeSlug: null };
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
  getServerContext: async () => ({
    // Feature 167 — no URL languages known: paths stay as written.
    urlState: { languages: [], aliases: [], current: 'en-US' },
    ctx: { locale: 'en-US', salesChannelCode: 'web' },
    locale: 'en-US',
  }),
}));
vi.mock('../../lib/api/cms', () => ({
  getCmsPageBySlug: async () => state.page,
  normalizeCmsUrlPath: (path: string) => path.replace(/^\/+|\/+$/g, ''),
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: state.homeSlug }),
}));
vi.mock('../../components/CmsPageRenderer', () => ({
  CmsPageRenderer: () => <div data-testid="page-body" />,
}));
vi.mock('../../components/seo/OrganizationJsonLd', () => ({
  OrganizationJsonLd: () => null,
}));

const route = await import('../../app/(content)/[...slug]/page');
const CmsContentPage = route.default;

const ORIGIN = 'https://shop.example.com';

function page(overrides: Partial<CmsResolvedPage> = {}): CmsResolvedPage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'workshops',
    path: 'services/consulting/workshops',
    name: 'Workshops',
    language: 'en-US',
    meta: { title: null, description: null, keywords: null },
    content: { data: { root: { props: {} }, content: [] } },
    embeds: { blocks: {}, templates: {} },
    assets: {},
    breadcrumbs: {
      visible: true,
      scheme: 'light',
      trail: [
        { name: 'Services', slug: 'services', path: 'services' },
        { name: 'Consulting', slug: 'consulting', path: 'services/consulting' },
      ],
    },
    share: { imageUrl: null },
    languages: ['en-US'],
    ...overrides,
  };
}

async function render(segments: string[]): Promise<string> {
  return renderToString(await CmsContentPage({ params: Promise.resolve({ slug: segments }) }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.page = null;
  state.homeSlug = null;
  redirects.length = 0;
});

describe('a nested CMS page', () => {
  it('renders at its path, linking each crumb to its ancestor path', async () => {
    state.page = page();
    const html = await render(['services', 'consulting', 'workshops']);
    expect(redirects).toEqual([]);
    expect(html).toContain('href="/services"');
    expect(html).toContain('href="/services/consulting"');
    expect(html).not.toContain('href="/consulting"');
    expect(html).toContain(`${ORIGIN}/services/consulting/workshops`);
  });

  it('redirects its flat slug permanently to its path', async () => {
    state.page = page();
    await expect(render(['workshops'])).rejects.toThrow('NEXT_REDIRECT');
    expect(redirects).toEqual(['/services/consulting/workshops']);
  });

  it('keeps a flat page where it is — no redirect, crumbs on their slugs, when the answer has no path', async () => {
    state.page = page({
      slug: 'about',
      path: undefined,
      breadcrumbs: { visible: true, scheme: 'light', trail: [{ name: 'Services', slug: 'services' }] },
    });
    const html = await render(['about']);
    expect(redirects).toEqual([]);
    expect(html).toContain('href="/services"');
  });

  it('still sends the selected home page to /, by its path or its flat slug', async () => {
    state.page = page();
    state.homeSlug = 'workshops';
    await expect(render(['services', 'consulting', 'workshops'])).rejects.toThrow('NEXT_REDIRECT');
    expect(redirects).toEqual(['/']);
  });

  it('declares its path as the canonical address and og:url', async () => {
    state.page = page();
    const metadata = await route.generateMetadata({ params: Promise.resolve({ slug: ['workshops'] }) });
    expect(metadata.alternates).toMatchObject({ canonical: '/services/consulting/workshops' });
    expect(metadata.openGraph).toMatchObject({ url: expect.stringContaining('/services/consulting/workshops') });
  });
});
