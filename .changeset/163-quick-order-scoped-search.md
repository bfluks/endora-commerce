---
'@endora-commerce/mod-quick-order': patch
---

The type-ahead (`GET /api/v1/quick-order/search`) passes the request's `Accept-Language` pick to `catalogQuickSearchPort`, so a product switched off in that language of the sales channel is not offered.
