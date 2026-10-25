---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/contracts': patch
---

Product data scopes reach the basket view and the two external API seams that did not follow them yet.

- **Basket view:** a line whose product is no longer available at the basket's sales channel and language keeps its `productName` and `productSku`, reads `unavailable: true` (`unavailableReason: 'not_purchasable'`), and has `productSlug: null`, so the storefront shows it without a link to a product page that answers `404` there. Placing the order still refuses it. `cartViewLineSchema` types `productSlug` as nullable and gains `productSku`.
- **External order intake** (`POST /api/v1/external/orders`): every line is checked against the product's availability at the key's sales channel (its default language) for the bound Organization — switched off there, outside its publication window or outside the channel's audience rule. Such a line is refused exactly as an unknown SKU: the whole order answers `422 VALIDATION_FAILED` with `SKU_NOT_IN_ASSORTMENT` at `lines.<i>.sku`, and nothing is placed. The availability rule decides the status, so a product off globally but on in the key's channel is orderable. `OrderApiIntakeService` takes `catalogAvailability` in place of the sales-channel membership port.
- **External bulk prices:** a product not available to the bound Organization at the key's channel gets no price and reads `sku_not_in_assortment`, like an unknown SKU. The external catalogue namespace is mounted only with `catalog`'s own availability port.
