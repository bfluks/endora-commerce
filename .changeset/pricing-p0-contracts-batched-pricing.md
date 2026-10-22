---
'@endora-commerce/contracts': minor
---

Batched pricing ports, one customer-group rule, and the price split on catalogue summaries (D-287 P0).

- **New `LinePricesPort`** (container `pricingService`): `resolveLinePrices({ lines, context })` prices many `LinePriceRequest`s (`{ key, product, variantId?, quantity }`) for one buyer in one call and answers a `Map<key, LinePriceResult | null>` identical, key by key, to one `resolveLinePrice` per line. `OrgLinePricePort` is unchanged; a caller that needs both names `OrgLinePricePort & LinePricesPort`.
- **New `ListingPriceDetailPort`** (container `pricingService`): `resolveListingPriceDetails(input)` answers, per product, a `ListingPriceDetail` — the listing chain's `price` (`ListingPrice`) plus `basePrice`, `salePrice` and `displayMode` from the same resolution. `ListingPricePort`'s input is now the named type `ListingPriceInput`.
- **New `PricingBuyerContext`** documents the one rule: effective group = the explicit `customerGroupId` ?? the customer account's own group ?? the organisation's. `customerAccountId?: string | null` is added to the contexts of `ListingPricePort`, `LinePricePort` and `ListingPriceViewerContext`.
- **`ProductAudience.customerAccountId?`** — the signed-in customer account; not a visibility input.
- **`ProductSummary.resolvedPrice?`** (`productResolvedPriceSchema`: `basePrice`, `salePrice`, `displayMode`, nullable, optional) — inherited by `ProductDetail` and `SearchSuggestItem`.
