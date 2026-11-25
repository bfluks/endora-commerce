---
"@endora-commerce/mod-product-visibility-rules": minor
"@endora-commerce/contracts": patch
---

`@endora-commerce/mod-product-visibility-rules` publishes `adminProductVisibilityPort` (`AdminProductVisibilityPort` in `@endora-commerce/contracts`): `resolveScope(adminUserId)` per request — `unrestricted`, `no_category` or `restricted` to the conditions that can be met now (active currency, catalogue-price flags built for the designation that holds, designation in force) — `systemScope()`, `productPredicate` / `variantPredicate` (a `none` / `sql` / `deny` union; the SQL fragment uses `?` placeholders over the module's own tables and accepts only `"alias"."column"` identifiers), `filterVisible` and the live `checkLines` with `noFixedPrice`. Behind it, per currency, the catalogue-price flags: built whole by generation and swapped only when complete, refreshed per product from `price_lists.catalogue_prices_changed`, by the `product_visibility_rules.flags` queue with a two-minute drift poll on `price_lists`' change watermark and a nightly reconcile. A designation change asks for its currency's rebuild. No consumer narrows its reads yet.
