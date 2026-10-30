---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
---

A CMS page can show its breadcrumb trail over its first section instead of in a band above it.

- `@endora-commerce/mod-cms` adds `breadcrumbs_overlay` to `cms_pages` (migration `20261028T090524_cms_page_breadcrumbs_overlay`, `boolean not null default false`), so every stored page keeps its band. It is part of the `cms_page.update` audit entry, and the storefront read answers `breadcrumbs.overlay: true` only when it is on.
- The page editor's Breadcrumbs card adds *Show the breadcrumbs over the first section*, with English and Polish labels. The storefront then draws the trail in a zero-height layer over the first section, in the brand container, painting no band, so nothing below moves down; the scheme still sets its colours. The first section's top padding is the editor's to set.
- `@endora-commerce/contracts`: `breadcrumbsOverlay` on the admin page detail (required in responses) and on create and patch (optional); optional `overlay` on `cmsResolvedPageSchema.breadcrumbs`. Code that constructs an admin page detail must supply `breadcrumbsOverlay`.
