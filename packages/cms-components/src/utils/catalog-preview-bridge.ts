import type { CmsBlogPostCard } from '../schema/blog-types.js';
import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';

export interface CatalogPreviewApi {
  fetchProductsBySlugs: (slugs: string[]) => Promise<CmsProductSummary[]>;
  fetchProductsList: (query: {
    categorySlug?: string;
    q?: string;
    limit?: number;
  }) => Promise<CmsProductSummary[]>;
  fetchCategoryTree: () => Promise<CmsCategoryNode[]>;
  /**
   * The editor's read of `blog.LatestPosts` (feature 163). Optional: an editor
   * without it previews the block through the public list API.
   */
  fetchBlogPosts?: (query: { limit: number; categorySlug?: string }) => Promise<CmsBlogPostCard[]>;
}

let previewApiGetter: (() => CatalogPreviewApi | null) | null = null;

export function registerCatalogPreviewGetter(getter: (() => CatalogPreviewApi | null) | null): void {
  previewApiGetter = getter;
}

export function getCatalogPreviewApi(): CatalogPreviewApi | null {
  return previewApiGetter?.() ?? null;
}
