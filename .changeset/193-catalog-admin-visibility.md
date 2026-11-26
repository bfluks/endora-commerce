---
"@endora-commerce/mod-catalog": minor
"@endora-commerce/contracts": minor
---

`@endora-commerce/mod-catalog` narrows its admin product reads by `product_visibility_rules`' admin scope while that module is on (spec 193): the product list (page, `total` and the tab badges, cut in the statement that pages), `resolve-ids`, `batch-by-id`, a product's variants and the admin global search (`hasMore` over visible rows) answer only the products and variants the caller's role may see, and the list answers `visibility: { restricted: true, reason?: 'no_category', categoryName? }` to a restricted caller (absent otherwise). Every route addressed by a product id answers a hidden product — and a hidden variant of a visible product — exactly as one that does not exist, writes nothing, and no API pre-interceptor sees its id. The list, selection, batch and variant answers are sent `Cache-Control: private, no-store` whatever the module's state. With the module off or absent nothing is narrowed. `CatalogAdminService` list reads and `CatalogAdminSearchService.searchProducts` take the scope as a required first parameter; `adminProductVisibilityPort` is declared `degrades-without`.

`@endora-commerce/contracts` adds `adminProductListVisibilitySchema`, `AdminProductListVisibility` and `adminProductListVisibility(scope)`.
