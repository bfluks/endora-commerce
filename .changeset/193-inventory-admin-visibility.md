---
"@endora-commerce/mod-inventory": minor
---

The inventory admin reads are narrowed by `product_visibility_rules`' admin scope while that module is on (spec 193, FR-083): the landing KPIs, the stock roster (`GET /api/v1/admin/inventory/levels`), the low-stock report, the legacy list, the availability-notification queue and the warehouse totals (`GET /api/v1/admin/warehouses` with `withTotals`, `GET /api/v1/admin/warehouses/:id` — `products` and `onHand`) hold only the products a restricted administrator's role may see, counted and paged over them; a role with no visibility category sees no stock. The set-stock assistant tool answers a hidden product as a missing one and does not write it (FR-081). With the module off or absent nothing is narrowed. `@endora-commerce/mod-inventory` declares `adminProductVisibilityPort` `degrades-without`.
