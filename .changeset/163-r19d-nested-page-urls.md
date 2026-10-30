---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
---

A CMS page can include its parent page's path in its address, for nested URLs such as `/services/consulting/workshops`.

- `@endora-commerce/mod-cms` adds `parent_path_in_url` to `cms_pages` (migration `20261027T165458_cms_page_parent_path_in_url`, `boolean not null default false`). Off, a page keeps its flat `/<slug>`, so no stored page changes address. On, the page is served at its parent's public path, a `/` and its slug; the parent's own path follows the same rule. The path is computed on read for each sales channel from the slug that channel serves a page under, so renaming or moving a parent moves the nested pages below it; their old path stops answering.
- `GET /api/v1/cms/pages/by-slug?slug=` takes the whole path. A nested page's own slug still resolves; its answer's `path` is the canonical address, and the storefront answers that request with a permanent (308) redirect. A parent the channel does not serve leaves the page at its own slug in that channel.
- A save that would give two pages of one sales channel the same address — the page saved or a nested page below it — is refused with `409 CMS_SLUG_CONFLICT` (details `{ path }`), and nothing is written or audited. `parentPathInUrl` is part of the `cms_page.update` audit entry.
- Page Builder links of kind `page` are rendered at the target's path in the request's channel. Breadcrumb links, the canonical link, `og:url` and the sitemap use the path. A write that moves a nested page's path drops every cached page answer, because other pages link to it.
- The page editor adds *Include the parent page's path in the address* under the parent picker, and its *Public address* shows the resulting path.
- `@endora-commerce/contracts`: `parentPathInUrl` on the admin page summary and detail (required in responses) and on create and patch (optional); optional `path` on `cmsResolvedPageSchema`, on each breadcrumb crumb and on `cmsPageIndexEntrySchema`; `cmsPagePublicPaths`, `CMS_PAGE_PATH_MAX_LEVELS` and `CmsPagePathNode`; optional `addressesMoved` on the page `CmsContentChange`. Code that constructs an admin page summary or detail must supply `parentPathInUrl`.
