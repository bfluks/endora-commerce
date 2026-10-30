import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A store closed to anonymous visitors advertises nothing
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §2).
 *
 * Every page of such a store sends a crawler — which never signs in — to the
 * sign-in page, and the backend refuses its catalogue to anonymous callers. A
 * sitemap listing the home page and the catalogue would only advertise
 * redirects, so it answers empty and asks the backend nothing.
 */

const state = { anonymousAccess: true as boolean | undefined };
const listProducts = vi.fn(async () => ({
  data: [{ slug: 'pump' }],
  pagination: { cursor: null, hasMore: false, limit: 100 },
}));

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    urlState: { languages: [], aliases: [], current: 'en-US' },
    ctx: { locale: 'en-US', salesChannelCode: 'trade' },
    ...(state.anonymousAccess !== undefined ? { anonymousAccess: state.anonymousAccess } : {}),
  }),
}));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: () => listProducts(),
  getCategoryTree: async () => [],
}));
vi.mock('../../lib/api/blog', () => ({ getBlogIndex: async () => null }));
vi.mock('../../lib/api/cms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/cms')>()),
  getCmsPageIndex: async () => null,
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: null }),
}));

const { default: sitemap } = await import('../../app/sitemap');

beforeEach(() => {
  listProducts.mockClear();
});

describe('the sitemap of a store closed to anonymous visitors', () => {
  it('is empty and asks for no catalogue', async () => {
    state.anonymousAccess = false;
    expect(await sitemap()).toEqual([]);
    expect(listProducts).not.toHaveBeenCalled();
  });

  it('is unchanged on an open store', async () => {
    state.anonymousAccess = true;
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls.some((url) => url.endsWith('/p/pump'))).toBe(true);
  });
});
