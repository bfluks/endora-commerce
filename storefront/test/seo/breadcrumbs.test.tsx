import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResolvedPage } from '@endora-commerce/contracts';

/**
 * Breadcrumbs that follow the page tree
 * (`specs/163-page-builder-marketing-pages/` T082; spec US8, FR-030–FR-031;
 * research R-18).
 *
 * - A CMS page renders Home › its ancestors › itself, in the order the backend
 *   resolved for the request's channel; an ancestor that channel does not serve
 *   (`slug: null`) is text, not a link, and has no JSON-LD `item`.
 * - The trail is absent when the page hides it, and wears the page's scheme.
 * - JSON-LD `item` values are absolute (`siteUrl()`), which a `BreadcrumbList`
 *   requires.
 */

const state: { page: CmsResolvedPage | null } = { page: null };

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    ctx: { locale: 'en-US', salesChannelCode: 'web' },
    locale: 'en-US',
  }),
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
// Feature 163 (T088) renders `OrganizationJsonLd`, an async server component,
// on every CMS page; `renderToString` cannot await it, and this file is about
// the trail. `organization-jsonld.test.tsx` holds that component.
vi.mock('../../components/seo/OrganizationJsonLd', () => ({
  OrganizationJsonLd: () => null,
}));

const { Breadcrumbs } = await import('../../components/Breadcrumbs');
const { default: CmsContentPage } = await import('../../app/(content)/[...slug]/page');

const ORIGIN = 'https://shop.example.com';

function page(breadcrumbs: CmsResolvedPage['breadcrumbs']): CmsResolvedPage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'audience/buyers',
    name: 'Buyers',
    language: 'en-US',
    meta: { title: null, description: null, keywords: null },
    content: { data: { root: { props: {} }, content: [] } },
    embeds: { blocks: {}, templates: {} },
    assets: {},
    breadcrumbs,
    share: { imageUrl: null },
    languages: ['en-US'],
  };
}

function jsonLd(html: string): { itemListElement: Array<{ position: number; name: string; item?: string }> } {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as { itemListElement: Array<{ position: number; name: string; item?: string }> };
}

async function renderPage(): Promise<string> {
  return renderToString(await CmsContentPage({ params: Promise.resolve({ slug: ['audience', 'buyers'] }) }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.page = null;
});

describe('Breadcrumbs', () => {
  it('renders a crumb without a link as text, and gives it no JSON-LD item', () => {
    const html = renderToString(
      <Breadcrumbs
        crumbs={[
          { href: '/', label: 'Home' },
          { href: null, label: 'Client zone' },
          { href: '/audience/buyers', label: 'Buyers' },
        ]}
      />,
    );
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/<a[^>]*>Client zone<\/a>/);
    expect(html).toContain('Client zone');

    const ld = jsonLd(html);
    expect(ld.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Client zone' },
      { '@type': 'ListItem', position: 3, name: 'Buyers', item: `${ORIGIN}/audience/buyers` },
    ]);
  });
});

describe('the CMS page trail', () => {
  it('renders Home › ancestors › page, linking only what the channel serves', async () => {
    state.page = page({
      visible: true,
      scheme: 'light',
      trail: [
        { name: 'Audiences', slug: 'audiences' },
        { name: 'Client zone', slug: null },
      ],
    });
    const html = await renderPage();

    const ld = jsonLd(html);
    expect(ld.itemListElement.map((entry) => [entry.name, entry.item ?? null])).toEqual([
      ['Home', `${ORIGIN}/`],
      ['Audiences', `${ORIGIN}/audiences`],
      ['Client zone', null],
      ['Buyers', `${ORIGIN}/audience/buyers`],
    ]);
    expect(html).toContain('href="/audiences"');
    expect(html).not.toMatch(/<a[^>]*>Client zone<\/a>/);
    expect(html).toMatch(/aria-current="page"[^>]*>Buyers</);
  });

  it('renders no breadcrumbs when the page hides them', async () => {
    state.page = page({ visible: false, scheme: 'light', trail: [{ name: 'Audiences', slug: 'audiences' }] });
    const html = await renderPage();
    expect(html).not.toContain('aria-label="Breadcrumb"');
    expect(html).not.toContain('BreadcrumbList');
    expect(html).toContain('data-testid="page-body"');
  });

  it('wears the page scheme on the breadcrumb wrapper', async () => {
    state.page = page({ visible: true, scheme: 'dark', trail: [] });
    const html = await renderPage();
    expect(html).toMatch(/data-cmsb-scheme="dark"[^>]*>[\s\S]*aria-label="Breadcrumb"/);
  });

  it('keeps the light default free of a painted band, as on a page that never set one', async () => {
    state.page = page({ visible: true, scheme: 'light', trail: [] });
    const html = await renderPage();
    expect(html).toContain('data-cmsb-scheme="light"');
    expect(html).not.toContain('bg-[var(--cmsb-bg');
  });
});
