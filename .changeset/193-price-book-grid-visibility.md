---
"@endora-commerce/mod-price-lists": minor
"@endora-commerce/mod-catalog": minor
"@endora-commerce/contracts": minor
---

The price book grid (`GET /api/v1/admin/price-books/:id/lines`) is narrowed by `product_visibility_rules`' admin scope while that module is on (spec 193): a restricted administrator's product lines — page, search and `totalLines` — hold only the products their role may see, cut inside `catalog`'s statement, and a visible configurable product keeps only its qualifying variant lines. Row reads and edits are unchanged (FR-038). With the module off or absent nothing is narrowed. `@endora-commerce/mod-price-lists` declares `adminProductVisibilityPort` `degrades-without`.

`CatalogAdminNamePageQuery` (`catalogProductReadPort.pageProductsByAdminName`) gains a **required** `scope: AdminProductVisibilityScope` (threat model TM-3: the scope is never optional); a caller that narrows nothing passes `{ kind: 'system' }`. This is an incompatible change to a stable port input and needs the owner's sanctioned-break ruling before release (`specs/conventions/contract-surface.md`, D-293.7).
