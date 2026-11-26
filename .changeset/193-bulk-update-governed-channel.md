---
"@endora-commerce/mod-catalog": minor
---

`@endora-commerce/mod-catalog`'s bulk product update refuses a sales-channel edit naming a channel a `product_visibility_rules` website rule governs with `409 CHANNEL_MEMBERSHIP_GOVERNED` before anything is applied or queued (spec 193 T067), and its membership writes pass `onGoverned: 'refuse'`, so a replace that would take a product off a governed channel fails that product instead. With the module off nothing is governed and the edit behaves as before. `CatalogBulkUpdateService.assertNoGovernedChannel(fields)` is added.
