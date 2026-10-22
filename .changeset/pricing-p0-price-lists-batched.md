---
'@endora-commerce/mod-price-lists': minor
---

Batched resolution entry points and one customer-group rule (D-287 P0).

- **`PricingServiceContract` gains `resolveLinePrices(input: LinePricesInput)`** — many lines, each at its own quantity, in a number of statements that does not grow with the lines (9 lines: 12 statements against 112 for the per-line loop; 45 lines: still 12). It answers exactly what one `resolveLinePrice` per line answers. **An overlay that decorates `resolveLinePrice` must decorate `resolveLinePrices` too** — the cart, the placement price check, quote reference prices and the external catalogue API now price through it.
- **`PricingServiceContract` gains `resolveListingPriceDetails(input)`** — `resolveListingPrices` plus `basePrice` / `salePrice` / `displayMode` from the same resolution.
- **The customer's own group on every path.** Every entry point accepts `customerAccountId`; the engine reads the account (once per call) and prices on `customerGroupId ?? account's group ?? organization's group` (`effectiveCustomerGroupId`, `services/customer-group-rule.ts`). An account that does not belong to the named organization is ignored. `PricingService` takes `customer_accounts`' read port as a fifth constructor argument; a resolution that names an account without it refuses. `GET /api/v1/storefront/products/:id/resolved-price` now prices a signed-in customer on their own group — a behaviour change for a customer whose group differs from their organization's.
- **`BuyerLinePriceService`** prices each chunk of lines with one `resolveLinePrices` call (it was one sequential `resolveLinePrice` per line); its `pricingService` dependency is now `Pick<PricingServiceContract, 'resolveLinePrices'>`.
