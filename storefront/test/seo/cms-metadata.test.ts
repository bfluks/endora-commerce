import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CmsResolvedPage } from '@endora-commerce/contracts';

/**
 * Sharing metadata for CMS pages
 * (`specs/163-page-builder-marketing-pages/` T085; spec US9, FR-033–FR-034 as
 * amended by ruling Q1; research R-18, R-19).
 *
 * - `openGraph.images[0].url` is the resolved `share.imageUrl` — the page's own
 *   image or the deployment default, already chosen by the backend.
 * - `openGraph.locale` is the served language and `openGraph.alternateLocale`
 *   the page's other languages, in Open Graph's `ll_CC` spelling. There is no
 *   `hreflang`: one storefront URL serves every language (R-19).
 * - `twitter.card` is `summary_large_image` when an image exists.
 * - A CMS-backed home page carries the same metadata, at `/`.
 */

const state: { page: CmsResolvedPage | null; homeSlug: string | null } = { page: null, homeSlug: null };

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
  getHomepageConfig: async () => ({ cmsPageSlug: state.homeSlug }),
}));

const cmsRoute = await import('../../app/(content)/[...slug]/page');
const homeRoute = await import('../../app/page');

const IMAGE = 'https://cdn.example.com/assets/file/share.png?v=1';

function page(overrides: Partial<CmsResolvedPage> = {}): CmsResolvedPage {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'about',
    name: 'About us',
    language: 'en-US',
    meta: { title: 'About the company', description: 'Who we are', keywords: null },
    content: { data: { root: { props: {} }, content: [] } },
    embeds: { blocks: {}, templates: {} },
    assets: {},
    breadcrumbs: { visible: true, scheme: 'light', trail: [] },
    share: { imageUrl: IMAGE },
    languages: ['en-US', 'pl-PL', 'de-DE'],
    ...overrides,
  };
}

async function cmsMetadata() {
  return cmsRoute.generateMetadata({ params: Promise.resolve({ slug: ['about'] }) });
}

async function homeMetadata(): Promise<Record<string, unknown>> {
  const generate = (homeRoute as unknown as { generateMetadata?: () => Promise<Record<string, unknown>> })
    .generateMetadata;
  expect(generate, 'app/page.tsx exports generateMetadata').toBeTypeOf('function');
  return generate!();
}

afterEach(() => {
  state.page = null;
  state.homeSlug = null;
});

describe('CMS page sharing metadata', () => {
  it('carries the sharing image, the served locale and the alternates', async () => {
    state.page = page();

    const metadata = await cmsMetadata();

    expect(metadata.openGraph).toMatchObject({
      title: 'About the company',
      description: 'Who we are',
      locale: 'en_US',
      alternateLocale: ['pl_PL', 'de_DE'],
    });
    const images = (metadata.openGraph as { images: Array<{ url: string }> }).images;
    expect(images[0]!.url).toBe(IMAGE);
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
    // The canonical stays as it was.
    expect(metadata.alternates).toMatchObject({ canonical: expect.any(String) });
    // No hreflang alternates: one URL serves every language (R-19).
    expect((metadata.alternates as Record<string, unknown>)['languages']).toBeUndefined();
  });

  it('carries no image and no large card when there is no sharing image', async () => {
    state.page = page({ share: { imageUrl: null }, languages: ['en-US'] });

    const metadata = await cmsMetadata();

    const og = metadata.openGraph as Record<string, unknown>;
    expect(og['images']).toBeUndefined();
    expect(og['locale']).toBe('en_US');
    expect(og['alternateLocale']).toBeUndefined();
    expect((metadata.twitter as Record<string, unknown> | undefined)?.['card']).not.toBe('summary_large_image');
  });

  it('falls back to the page name when the page has no meta title', async () => {
    state.page = page({ meta: { title: null, description: null, keywords: null } });

    const metadata = await cmsMetadata();

    expect(metadata.openGraph).toMatchObject({ title: 'About us' });
  });
});

describe('CMS-backed home page sharing metadata', () => {
  it('uses the same metadata as the CMS page, at /', async () => {
    state.homeSlug = 'about';
    state.page = page();

    const metadata = await homeMetadata();

    expect(metadata['title']).toBe('About the company');
    expect(metadata['alternates']).toMatchObject({ canonical: '/' });
    expect(metadata['openGraph']).toMatchObject({
      title: 'About the company',
      locale: 'en_US',
      alternateLocale: ['pl_PL', 'de_DE'],
      images: [{ url: IMAGE }],
    });
    expect(metadata['twitter']).toMatchObject({ card: 'summary_large_image' });
  });

  it('keeps the built-in landing page metadata when no CMS page is selected', async () => {
    const metadata = await homeMetadata();

    expect(metadata['alternates']).toMatchObject({ canonical: '/' });
    expect(metadata['openGraph']).toBeUndefined();
  });
});
