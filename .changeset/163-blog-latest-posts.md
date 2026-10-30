---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-blog': minor
'@endora-commerce/cms-components': minor
---

Blog posts get a main image, a public list endpoint and a *Latest posts* page-builder block.

- `@endora-commerce/mod-blog` adds `blog_posts.main_image_asset_id` (migration `20261023T063013_blog_post_main_image`, nullable, foreign key to the asset library), editable in the post editor through the asset library picker. Deleting an asset a post uses as its main image is refused like any other referenced asset (reference kind `blog_post_main_image`).
- `GET /api/v1/blog/posts?limit=&categorySlug=` returns the newest published posts of the request's sales channel as post cards (`limit` 1–24, default 6; an unknown category returns `[]`; a channel with the blog disabled returns `[]`). Cards carry the primary category's name for a chip.
- `@endora-commerce/contracts`: `blogPostsListQuerySchema`, `blogPostsListResponseSchema`, `BLOG_POSTS_LIST_MAX_LIMIT`, `BLOG_POSTS_LIST_DEFAULT_LIMIT`; `mainImageAssetId` on `blogPostSummarySchema` (required, nullable) and on the create and patch request schemas (optional); optional `primaryCategoryName` on `blogPostCardSchema`; `blog_post_main_image` in `assetReferenceKindSchema`.
- `blog.LatestPosts` (declared by `@endora-commerce/mod-blog`, rendered by `@endora-commerce/cms-components` as `LatestPosts` with the `CmsBlogPostCard` type): the newest posts as a carousel or a grid, optionally from one category, with a header and a read-more label. It is resolved on the server through the block-data seam, renders nothing for customers when there are no posts, and disappears from the editor and the storefront when the blog module is off.
