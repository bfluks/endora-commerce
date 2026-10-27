---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/contracts': minor
---

**BREAKING — `cartViewLineSchema.productSlug` is `string | null | undefined`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A basket line whose product is unavailable carries `productSlug: null`, so a reader that typed it as `string | undefined` must handle `null` (render the line without a product link); `productSku` is new beside it.

Product data scopes reach the basket view and the two external API seams that did not follow them yet.

- **Basket view:** a line whose product is no longer available at the basket's sales channel and language keeps its `productName` and `productSku`, reads `unavailable: true` (`unavailableReason: 'not_purchasable'`), and has `productSlug: null`, so the storefront shows it without a link to a product page that answers `404` there. Placing the order still refuses it. `cartViewLineSchema` types `productSlug` as nullable and gains `productSku`.
- **External order intake** (`POST /api/v1/external/orders`): after the existing per-line checks, every line's product must be available at the key's sales channel (its default language) to the calling key's Organization — not switched off there, inside its publication window, admitted by the channel's audience rule. A product that is not answers what a product hidden from the bound Organization already answered: `404 PRODUCT_NOT_FOUND`, no name, nothing placed. An unknown or unpublished SKU keeps its per-line `422 VALIDATION_FAILED` (`SKU_NOT_IN_ASSORTMENT`), which takes precedence. The availability rule decides the status, so the SKU read no longer drops a product that is off globally: one that is on in the key's channel is orderable, one that is off there answers the `404`. `OrderApiIntakeService` takes `catalogAvailability`, and `place` takes the caller's `audience`.
- **External bulk prices** (`POST /api/v1/external/catalog/prices`): a product not available to the calling key's Organization at the key's channel gets no price and reads `sku_not_in_assortment` — before, a product restricted away from that Organization was priced. `resolveBulkPrices` takes the caller's `audience`; the external catalogue namespace is mounted only with `catalog`'s own availability port.
