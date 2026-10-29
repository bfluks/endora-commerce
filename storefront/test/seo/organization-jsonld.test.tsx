import { isValidElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResolvedPage, ShopInfo } from '@endora-commerce/contracts';

/**
 * `Organization` structured data from settings
 * (`specs/163-page-builder-marketing-pages/` T088; spec US9, FR-035; research R-20).
 *
 * - `logo` comes from `shop.logo_asset_id` (served as `logoUrl`) and `sameAs`
 *   from `shop.social_profiles`; both are left out while unset.
 * - The component renders on every CMS page, not only on `/`.
 */

const SHOP: ShopInfo = {
  name: 'Example Company',
  address: '1 Example Street',
  contactEmail: 'hello@example.com',
  supportEmail: '',
  phone: '',
  logoUrl: null,
  socialProfiles: [],
};

const state: { shop: ShopInfo; page: CmsResolvedPage | null } = { shop: SHOP, page: null };

vi.mock('../../lib/api/shop', () => ({
  getShopInfo: async () => state.shop,
}));
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
  CmsPageRenderer: () => null,
}));

const { OrganizationJsonLd } = await import('../../components/seo/OrganizationJsonLd');
const { default: CmsContentPage } = await import('../../app/(content)/[...slug]/page');

const ORIGIN = 'https://shop.example.com';

async function organization(): Promise<Record<string, unknown>> {
  const html = renderToString(await OrganizationJsonLd({ ctx: {} }));
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!) as Record<string, unknown>;
}

/** Every element in a rendered tree, without rendering async children. */
function elements(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  const out: Array<{ type: unknown; props: Record<string, unknown> }> = [];
  const visit = (value: ReactNode): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isValidElement(value)) return;
    const props = value.props as Record<string, unknown>;
    out.push({ type: value.type, props });
    visit(props['children'] as ReactNode);
  };
  visit(node);
  return out;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  state.shop = SHOP;
  state.page = null;
});

describe('OrganizationJsonLd', () => {
  it('emits logo and sameAs from the shop settings', async () => {
    state.shop = {
      ...SHOP,
      logoUrl: 'https://cdn.example.com/assets/file/logo.png?v=1',
      socialProfiles: ['https://social.example.com/company', 'https://video.example.org/@company'],
    };

    const data = await organization();

    expect(data).toMatchObject({
      '@type': 'Organization',
      name: 'Example Company',
      url: `${ORIGIN}/`,
      logo: 'https://cdn.example.com/assets/file/logo.png?v=1',
      sameAs: ['https://social.example.com/company', 'https://video.example.org/@company'],
    });
  });

  it('leaves logo and sameAs out while they are unset', async () => {
    const data = await organization();

    expect(data['logo']).toBeUndefined();
    expect(data['sameAs']).toBeUndefined();
    expect(data['name']).toBe('Example Company');
  });

  it('tolerates a shop-info answer from before the fields existed', async () => {
    const legacy = { ...SHOP } as Partial<ShopInfo>;
    delete legacy.logoUrl;
    delete legacy.socialProfiles;
    state.shop = legacy as ShopInfo;

    const data = await organization();

    expect(data['logo']).toBeUndefined();
    expect(data['sameAs']).toBeUndefined();
  });
});

describe('a CMS page', () => {
  it('renders the Organization data as well', async () => {
    state.page = {
      id: '00000000-0000-4000-8000-000000000001',
      slug: 'about',
      name: 'About us',
      language: 'en-US',
      meta: { title: null, description: null, keywords: null },
      content: { data: { root: { props: {} }, content: [] } },
      embeds: { blocks: {}, templates: {} },
      assets: {},
      breadcrumbs: { visible: false, scheme: 'light', trail: [] },
      share: { imageUrl: null },
      languages: ['en-US'],
    };

    const tree = await CmsContentPage({ params: Promise.resolve({ slug: ['about'] }) });

    expect(elements(tree).some((element) => element.type === OrganizationJsonLd)).toBe(true);
  });
});
