---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
---

CMS pages get a breadcrumb parent, breadcrumb display options and a sharing image.

- `@endora-commerce/mod-cms` adds four columns to `cms_pages` (migration `20261023T052237_cms_page_tree_and_share`): `parent_page_id` (self-reference, cleared when the parent is deleted), `breadcrumbs_visible` (default `true`), `breadcrumbs_scheme` (`light`, `muted` or `dark`, default `light`) and `share_image_asset_id`. The parent only shapes the breadcrumb trail; it never changes the page's URL. A parent that would create a cycle, or a tree deeper than eight levels, is refused with `422` (`CMS_PAGE_PARENT_CYCLE` for a cycle) and nothing is written or audited. Saving a page invalidates the cached pages below it.
- The storefront page read returns `breadcrumbs: { visible, scheme, trail }` (each crumb's `slug` is `null` when the ancestor is not published on the request's sales channel), `share: { imageUrl }` (the page's own public image, else the new per-channel setting `cms.default_share_image_asset_id`) and `languages` (the page's languages that carry content). A page that sets nothing keeps today's trail and look.
- The page editor adds a *Breadcrumbs* card (parent page, visibility, scheme) and a *Sharing* card (image from the asset library). Deleting an asset used as a sharing image is refused like any other referenced asset.
- `@endora-commerce/contracts`: `cmsBreadcrumbsSchemeSchema` / `CmsBreadcrumbsScheme`; `parentPageId` on the admin page summary; `breadcrumbsVisible`, `breadcrumbsScheme` and `shareImageAssetId` on the page detail (all required in responses, optional on create and patch); `breadcrumbs`, `share` and `languages` on `cmsResolvedPageSchema`; `parentPageId` on `CmsPageRecord`; the error code `CMS_PAGE_PARENT_CYCLE`. Code that constructs these response objects or a `CmsPageRecord` must supply the new fields.
