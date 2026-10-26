---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-comparisons': patch
---

A gallery image hidden in a sales channel no longer reaches that channel's product feeds or comparisons (product data scopes, FR-076).

- **Contracts:** `CatalogGalleryPort.listForProducts(productIds, channelId)` and `CatalogGalleryPort.baseImageUrls(productIds, channelId)` take the channel the caller serves; `null` keeps the global answer.
- **catalog:** `listForProducts` leaves out the items hidden in the channel. `baseImageUrls` answers the channel's own `base_image` holder, else the global one, and `null` when that holder is hidden there. Each is still one statement per batch.
- **product_feeds:** a feed's images are read in the feed's channel.
- **comparisons:** the base-image column is read in the viewer's resolved channel.
