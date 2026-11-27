---
"@endora-commerce/mod-catalog": minor
"@endora-commerce/contracts": minor
---

`@endora-commerce/mod-catalog` declares its status writers hookable `beforeCommit`: `product.update`, `product.restore`, `product.bulk_update.undo`, `product.scopes.update`, `product.scoped_values.save` and `product.scoped_values.import`. `@endora-commerce/contracts` exports the refs as `CATALOG_HOOKABLE_ACTIONS` and their hook data `ProductStatusHookData` — per addressed product, its global status, archive and deletion flags before and after the write and each channel-scoped status cell the write moved (`productStatusChanges` builds it). No behaviour changes until a module registers a hook.
