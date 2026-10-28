---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
---

A product's storefront page follows its availability at once. `catalog` now drops the storefront's cached product-page reads of a product — tagged by its id, slug, URL keys and former keys — after `product.updated.v1`, `product.archived.v1` and a product's `sales_channels.membership_changed`, and every product-page read after `product.deleted.v1`, through the storefront revalidate endpoint it already uses for categories (`STOREFRONT_BASE_URL` + `REVALIDATE_SECRET`; a no-op without them). Coalesced per batch and best-effort: a failed key read or call is logged and never fails the write. Next keeps only a `200` in its Data Cache, so a product switched off, archived or moved out of a channel used to go on showing until the storefront restarted. The tag vocabulary is `CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS` (`product`, `productKey(key)`, `maxLength`), shared by both sides.
