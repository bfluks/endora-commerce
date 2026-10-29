---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-catalog': patch
---

Display mode `none` now withholds every amount on the server (issue #491). Until now it hid prices
in the storefront only: the API still sent the price, the base, the sale, the list price and every
tier — a buyer's own included — so a shop configured to show prices only after sign-in
(`pricing.unauthenticated_display_mode = none`) disclosed them to anyone reading the network tab.

- **`@endora-commerce/mod-price-lists`.** Where the viewer's display mode resolves to `none`,
  `resolveListingPriceDetails` answers `price: { source: 'none' }`, `basePrice` and `salePrice`
  `null`, no `listPrice` and every `tiers` entry `null`; `resolveListingPrices` answers the `none`
  arm; `resolveEngine` names no book, bracket, sale, source or compare-at. `displayMode: 'none'`
  stays, so the storefront still renders "price on request". The catalogue listing, product page,
  home cards, search hits and suggestions, comparisons, product links and
  `GET /api/v1/storefront/products/:id/resolved-price` therefore send no amount. A line
  (`resolveLinePrices`) keeps its amount beside the mode — it is the charging path, which the cart,
  the admin order preview and order intake refuse as quote-only.
- **Price sort and range.** A product whose own display-mode step (its override, else its
  category's) is `none` is left out of the price surface: a price-sorted listing shows it after the
  priced products, in both directions, and a price range leaves it out. This replaces spec 086's
  clarification 2, under which such a product kept its position in the order. A product or
  category display-mode override now marks the products it concerns for the surface worker, so the
  order follows it at the worker's turnaround, like a price change. `PriceListService` gains
  `anyProductStepWithholds()`; `BookPricingDeps` gains the optional `anyProductStepWithholds`.
- **`@endora-commerce/contracts`.** New `displayModeWithholdsAmounts(mode)`, the one statement of
  the rule for a consumer that publishes a line amount. The documentation of
  `productResolvedPriceSchema`, `resolvedPriceEngineSchema`, `ListingPrice`, `ListingPriceDetail`
  and `LinePriceResult` says what each carries under `none`; no shape changes.
- **`@endora-commerce/mod-catalog`.** The external catalogue API (`/api/v1/external/catalog/*`)
  withholds a bound key's price, tier ladder and bulk price for a product whose display mode is
  `none` for the bound Organization: `price: null` with `priceUnavailable: true`, no `priceTiers`
  rung, and `reason: 'price_unavailable'` in a bulk answer.

**Behaviour change for API consumers.** A client that read amounts under `displayMode: 'none'` —
none should have — now reads `null`. Product feeds are unchanged: a feed publishes deliberately.
