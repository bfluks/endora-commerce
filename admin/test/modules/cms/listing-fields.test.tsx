import { describe, expect, it, vi } from 'vitest';
import type { ComponentConfig, Fields } from '@puckeditor/core';

/**
 * Feature 163, T069–T072 — in the admin, the buttons of the dynamic listings
 * pick their links with the library pickers (`specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, research R-9): the header button of the product grid
 * and slider and of `blog.LatestPosts`, the product listings' footer button,
 * and each row button of `cms.LinkList`. Every other field is the block's own.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(() => Promise.resolve({ data: [], nextCursor: null })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { defaultPageBuilderConfig } = await import('@endora-commerce/cms-components');
const { withAdminListingFields, LISTING_BLOCKS_WITH_ADMIN_FIELDS } = await import(
  '../../../../packages/modules/cms/src/admin/components/ListingFields'
);

const components = defaultPageBuilderConfig.components as Record<string, ComponentConfig>;

type Field = { type: string; arrayFields?: Record<string, Field>; objectFields?: Record<string, Field> };

function adminFields(name: string): Record<string, Field> {
  return withAdminListingFields(name, components[name]!).fields as Record<string, Field>;
}

describe('withAdminListingFields (T069–T072)', () => {
  it('covers the product grid and slider, the latest posts and the link list, keeping every other field', () => {
    expect([...LISTING_BLOCKS_WITH_ADMIN_FIELDS].sort()).toEqual(
      ['blog.LatestPosts', 'catalog.ProductGrid', 'catalog.ProductSlider', 'cms.LinkList'].sort(),
    );
    for (const name of LISTING_BLOCKS_WITH_ADMIN_FIELDS) {
      expect(Object.keys(adminFields(name)).sort(), name).toEqual(Object.keys(components[name]!.fields as Fields).sort());
    }
    expect(withAdminListingFields('cms.Text', components['cms.Text']!)).toBe(components['cms.Text']);
  });

  it('gives the header button its link picker', () => {
    for (const name of ['catalog.ProductGrid', 'catalog.ProductSlider', 'blog.LatestPosts']) {
      const header = adminFields(name)['header']!;
      expect(header.type, name).toBe('object');
      expect(header.objectFields!['button']!.objectFields!['link']!.type, name).toBe('custom');
    }
  });

  it('gives the product listings\' footer button its link picker', () => {
    for (const name of ['catalog.ProductGrid', 'catalog.ProductSlider']) {
      expect(adminFields(name)['footerButton']!.objectFields!['link']!.type, name).toBe('custom');
    }
  });

  it('gives each link-list row button its link picker', () => {
    const items = adminFields('cms.LinkList')['items']!;
    expect(items.type).toBe('array');
    expect(items.arrayFields!['button']!.objectFields!['link']!.type).toBe('custom');
    expect(items.arrayFields!['title']!.type).toBe('text');
  });
});
