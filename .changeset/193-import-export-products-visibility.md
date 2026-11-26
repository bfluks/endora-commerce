---
"@endora-commerce/mod-import-export": minor
---

The products export (`GET /api/v1/admin/export/products.csv`) and import (`POST /api/v1/admin/import/products`) answer `403 FORBIDDEN` to an administrator whose product visibility `product_visibility_rules` narrows (a role mapped to a visibility category, or fail-closed with no category) — the file is the whole catalogue (spec 193, FR-085). With the module off or absent nothing changes; `adminProductVisibilityPort` is declared `degrades-without`.
