---
"@endora-commerce/mod-price-lists": minor
"@endora-commerce/contracts": minor
---

`@endora-commerce/mod-price-lists` publishes `catalogueReferencePricePort` (`CatalogueReferencePricePort` in `@endora-commerce/contracts`): the catalogue price of a product in one currency over the fixed profile `[base book, designated book]` — quantity 1, no buyer, no sale book, one line per variant — through the same resolver every price uses (`resolve`), whether a designated book is in force now and why not (`designationStatus`, `designationStatuses`: `not_found`, `currency_mismatch`, `not_regular`, `audience_restricted`, `not_on_channel`, `not_active`, `outside_schedule`), the books a currency may designate (`designatableBooks`) and a durable change watermark (`changeWatermark`). Every pricing-generation bump that moves something is now announced by the writing process after commit as the EventBus event `price_lists.catalogue_prices_changed` (`CataloguePricesChangedEventSchema`, names only, no amounts) and moves the new sequence `price_lists_catalogue_change_seq` (one migration). Existing resolutions, caches and the price surface are unchanged.
