---
'@endora-commerce/mod-comparisons': patch
---

Comparison columns are priced on the signed-in customer's own customer group when it overrides their organization's (D-287 P0): the buyer's `customerAccountId` is passed to `resolveListingPrices`.
