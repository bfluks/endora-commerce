---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
---

The product gallery per sales channel and its alt text per language (product data scopes, FR-076, FR-077).

- **New admin routes:** `GET` / `PUT /api/v1/admin/catalog/products/:productId/gallery/channel-roles` (`catalog:read` / `catalog:write`) read and set a channel's own holder of `base_image`, `small_image` and `thumbnail` — keyed `baseImage`, `smallImage` and `thumbnail` in `roles` (`null` = use the global holder). `PATCH …/gallery/:itemId` accepts `altText` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). These writes run as the Command `product.media.update` — one audit entry per request whose `before` restores the item — and emit `product.updated.v1` with `changedFields: ['media']`. A channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing an override there is always allowed. The route-level `gallery.update` audit row is no longer written beside the Command's.
- **Admin DTO:** gallery items carry `altText` and `hiddenInChannels`.
- **Storefront reads:** the product page's `gallery`, the listing card's image (also for related products and grouped / bundle children) and the OG image follow the request's channel: a hidden image is never served there, also not through its legacy `product_assets` twin, and a role resolves to its channel holder. `gallery[].altText` is the product's alt text at the request's language, else the asset's.
- **Contracts:** `translationAt`, `applyTranslationPatch`, `translationMapPatchSchema`, `effectivePackagingUnitName`, `galleryChannelRolesSchema`, `putGalleryChannelRolesRequestSchema`, `GALLERY_ALT_TEXT_MAX`, `SCOPED_CHANNELS_MAX`; `sameLanguage` now lives in `scoped-translations.ts` and is re-exported unchanged.
- **Scope overview:** lists `media:roles` and `media:hidden` per channel, `media:altText` per language, and `seo:<field>` overrides at L, C and C × L (none while `seo` is off).
- **Migration** `catalog` `product_media_scopes`: tables `gallery_item_channel_labels`, `gallery_item_channel_hidden`, column `gallery_items.alt_text`. No backfill.
