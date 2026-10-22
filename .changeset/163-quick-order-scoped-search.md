---
'@endora-commerce/mod-quick-order': patch
---

The type-ahead (`GET /api/v1/quick-order/search`) passes the request's `Accept-Language` pick to `catalogQuickSearchPort`, so a product switched off in that language of the sales channel is not offered.

A pasted SKU list (`POST /api/v1/quick-order/import`) recognises only products available in the request's channel (at its default language); any other is rejected as `product_not_found`, the unknown SKU's reason. The operator's `POST /api/v1/admin/quick-order/import` is unchanged.
