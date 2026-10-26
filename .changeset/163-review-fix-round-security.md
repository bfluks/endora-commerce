---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-seo': patch
---

Product data scopes — checkpoint C/E/Q review fixes.

- **Platform:** new `withSystemScopeActingFor(adminUserId, reason, fn)` in `@endora-commerce/platform/tenancy` — a worker's system scope acting for the admin who queued the work, so its Commands are audited with that admin.
- **Catalog — audit:** a queued bulk Archive / Restore and a queued bulk scoped-status edit audit each product with the admin who requested the operation (it was a null actor). The API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` of an existing product is now the audited `product.update` Command, its entry naming the key (`apiKeyId` in the after-state); it is still never checked by the completeness gate.
- **Catalog — Archive / Restore** lock the product row, so a concurrent single and bulk Archive transition the product once: one audit entry, one `product.archived.v1`.
- **Catalog:** a composition that cannot build the completeness gate logs one warning instead of running unchecked silently.
- **SEO:** the cached sitemaps are marked stale on a change of the global status, archive, visibility or organization list, and on `product.archived.v1`, as they already were on the scoped values and URL keys.
- **Behaviour change for API clients (contracts, SEO):** an override's `ogImageUrl` must be an `http(s)` URL or a path starting with a single `/` (`ogImageUrlSchema`); `javascript:`, `data:` and other schemes are refused with `400 VALIDATION_FAILED`. The read shape accepts any stored string.
- **Contracts:** `effectiveOrderRules` and `effectiveKeys` are documented as applying no availability — a buyer-facing caller filters with `filterAvailable` first.
