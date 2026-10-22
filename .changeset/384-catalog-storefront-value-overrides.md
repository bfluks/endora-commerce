---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-search': patch
'@endora-commerce/contracts': patch
---

Storefront product reads show a product's per-sales-channel value overrides.

- **Behaviour change for API clients — channel overrides are now visible on the storefront.** `GET /api/v1/catalog/products/:idOrSlug` (name, description, `seo`, `structuredDataJsonLd`, `attributeValues`, `visibleAttributes`, grouped children and bundle options) and every `GET /api/v1/catalog/products` card name now return the override written in the product scope editor for the request's sales channel and language. The resolver's override slots are walked over the storefront's own baseline language order — the `Accept-Language` language, the channel's default language, `en-US`, `en`, the first stored language — taking the (channel, language) override at each language until the baseline has text for one, so an override never replaces baseline text of an earlier language in that order; the channel-only slot is asked last. Product-link tiles (in the product page's `links` and `GET /api/v1/catalog/products/:idOrSlug/links`) show overrides too, walked over their own pick, which has no channel-default leg. Channel-scoped user attributes return their channel override. A product without an override for that channel answers exactly as before.
- Override rows are read for the request's sales channel only, once per read section, never per card.
- **Search result cards show the same name.** Every card of the Meilisearch-served listing (`GET /api/v1/catalog/products?q=…` and `GET /api/v1/search/suggest`) now shows the name the catalogue's listing card shows for the request's sales channel and language, rather than the baseline text. The indexed name is still what the index ranks and sorts by. The request channel's override rows are read once per results page.
- `@endora-commerce/contracts` exports the slot choice both modules share (`overrideLanguages`, `channelOverrideFor`, `effectiveSystemText`, `StorefrontOverrideContext`) and the resolver's `isNonEmpty` presence test the walk reuses, and `CatalogProductReadPort.listValueOverridesByProductIds` takes an optional `{ channelId }` that narrows the read to one sales channel's rows. Existing callers and implementations are unaffected.
