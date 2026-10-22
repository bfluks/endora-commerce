---
'@endora-commerce/mod-search': minor
---

Search and typeahead pricing are batched and honour the customer's own group (D-287 P0).

- **Typeahead.** `createSuggestionPricingEnricher` prices all hits in one `resolveListingPriceDetails` call (it was one `resolveEngine` per hit). `SuggestionPriceResolverPort` is now `ListingPriceDetailPort`. A suggestion's `basePrice` is now the listing chain's, so a product priced only by its own price attribute shows it; a pricing refusal degrades the whole popup to plain summaries (a switched-off `price_lists` is still re-thrown). The suggest route passes the customer account, and `SuggestionPricingEnricher`'s context gains `customerAccountId`.
- **Search results** (Meilisearch path) price through `resolveListingPriceDetails` and carry `ProductSummary.resolvedPrice`, like the Postgres path; `searchHitSummary` takes an optional sixth `detail` argument. `SearchModuleOptions['listingPrices']` is typed `ListingPriceDetailPort`.
