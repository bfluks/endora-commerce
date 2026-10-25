---
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-orders': patch
---

"Archived" is read from the product's archived time, never from its status (the catalogue's status is now `active` | `inactive` and `inactive` no longer archives).

- **Product import:** a `status` of `draft` or `archived` is refused per record with `invalid status: <value>`; `inactive` switches the product off without archiving it.
- **Quick-order import:** `product_archived` is reported for an archived product whatever its status. A product merely switched off is not `product_archived`; for a buyer it is the channel's `product_not_found`.
- **Shopping-list conversion:** an archived product is skipped as `product_archived` whatever its status; a product switched off is the availability answer's `product_not_found`.
- **Reorder:** an archived product is reported `discontinued` and left out; a product merely switched off is seeded and left to the basket and to placement to refuse.
