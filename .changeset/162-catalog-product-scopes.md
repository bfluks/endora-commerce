---
'@endora-commerce/mod-catalog': minor
---

Product data scopes per sales channel and language.

- New error sentences in both bundles for `SCOPE_INVALID`, `SCOPE_INCOMPLETE`, `URL_KEY_TAKEN`, `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` and `URL_REDIRECT_NOT_FOUND`, declared in the module's `errorCodes`.
- Migration `20261022T035133_catalog_product_scopes.ts` adds `product_channel_scopes` (per-channel status, publication window, audience, minimum order quantity and returnable flag; `NULL` inherits), `product_channel_language_scopes` (status per channel × language) and the global window `products.publish_from` / `products.publish_until`, with no backfill — with no rows, every product behaves as before. Both tables cascade on product hard delete and on sales channel delete. `CatalogProductRecord` now carries `publishFrom` / `publishUntil`.
