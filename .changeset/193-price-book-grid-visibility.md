---
"@endora-commerce/mod-price-lists": minor
"@endora-commerce/mod-catalog": minor
"@endora-commerce/contracts": minor
---

The price book grid (`GET /api/v1/admin/price-books/:id/lines`) is narrowed by `product_visibility_rules`' admin scope while that module is on (spec 193): a restricted administrator's product lines — page, search and `totalLines` — hold only the products their role may see, cut inside `catalog`'s statement, and a visible configurable product keeps only its qualifying variant lines. Row reads and edits are unchanged (FR-038). With the module off or absent nothing is narrowed. `@endora-commerce/mod-price-lists` declares `adminProductVisibilityPort` `degrades-without`.

`CatalogAdminNamePageQuery` (`catalogProductReadPort.pageProductsByAdminName`) gains an optional `scope: AdminProductVisibilityScope`, applied inside the statement (page and total); absent, the page is the system's, as before — a compatible addition.

The price history is narrowed the same way (FR-084): `GET …/price-history/products/:productId` answers a product hidden from the caller as a product with no history, and `GET …/price-history/:changeId/lines` leaves out a hidden product's lines in the statement that pages (lines naming no product are kept).

Every other number a book publishes follows the same rule for a restricted administrator (owner ruling 2026-11-26, FR-094): `rowCount` and `tierStarts` of `GET /api/v1/admin/price-books/:id`, of the book list and of the answers of the book writes (create, patch, activate, draftify, duplicate), and `lineCount` of `GET …/price-history`, are recomputed over the rows (lines) the caller can list. Unrestricted callers read the stored values unchanged. `PriceBookReads.get` / `list` and `PriceBookHistory.changes` take the caller's product scope (predicate) as a required parameter.
