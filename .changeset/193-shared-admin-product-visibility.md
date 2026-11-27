---
"@endora-commerce/contracts": minor
"@endora-commerce/mod-catalog": patch
"@endora-commerce/mod-price-lists": patch
"@endora-commerce/mod-inventory": patch
---

`@endora-commerce/contracts` adds `createDegradingAdminProductVisibility({ isPresent, port })`, `DegradingAdminProductVisibility`, `narrowsAdminProducts(scope)`, `visibilityPredicateClause(predicate)` and `SYSTEM_ADMIN_PRODUCT_SCOPE` (spec 193): the one `degrades-without` shell in front of `adminProductVisibilityPort` — owner absent ⇒ every scope is `system` and the port is never resolved; a scope that narrows nothing ⇒ no predicate and no port call; present ⇒ a failing call is not caught. `catalog`, `price_lists` and `inventory` now wrap it instead of each carrying a copy; their behaviour is unchanged.
