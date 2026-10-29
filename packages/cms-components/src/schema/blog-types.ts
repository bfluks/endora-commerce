/**
 * The blog post card as `blog.LatestPosts` renders it — the shape of
 * `BlogPostCard` from `GET /api/v1/blog/posts`, declared here so this package
 * needs no `@endora-commerce/contracts` (as `catalog-types.ts`).
 */
export interface CmsBlogPostCard {
  id: string;
  slug: string;
  name: string;
  publishedAt: string | null;
  excerpt: string | null;
  mainImageUrl: string | null;
  primaryCategorySlug: string | null;
  /** The primary category's name in the page language; absent from an older backend. */
  primaryCategoryName?: string | null | undefined;
  /** The post's storefront path (`/<blog prefix>/<slug>`); absent from an older backend. */
  url?: string | undefined;
}
