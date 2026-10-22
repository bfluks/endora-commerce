---
'@endora-commerce/platform': patch
---

`productAudienceOf(request)` now carries the signed-in customer's `customerAccountId` on the `ProductAudience` it answers for a customer actor (D-287 P0), so catalogue, search, comparison and product-link pricing can apply the customer's own customer group. Visibility is unchanged: `isProductVisibleTo` does not read it.
