---
'@endora-commerce/mod-catalog': minor
---

Catalogue reads are priced once and on the customer's own group (D-287 P0).

- **`ProductSummary.resolvedPrice`** (`basePrice`, `salePrice`, `displayMode`) is emitted on every listing card and on the product detail, from the same resolution as `price` — `CatalogQueryService` now prices through `ListingPriceDetailPort.resolveListingPriceDetails` (its fifth constructor argument is typed `ListingPriceDetailPort`). The product page no longer needs `GET /storefront/products/:id/resolved-price`. `null` where the channel withholds prices.
- **Customer group.** Listing, product detail and product-link prices pass the signed-in customer's `customerAccountId`, so a customer whose own group overrides their organization's is priced on it — a behaviour change for such customers.
- **External catalogue API.** `CatalogOrgPriceDecorator` prices summaries, bulk lines and the tier ladder with one `resolveLinePrices` call each, instead of one `resolveLinePrice` per summary, line and rung; its `pricingService` dependency (and `CatalogModuleOptions['pricingService']`) is now `OrgLinePricePort & LinePricesPort & …`.
