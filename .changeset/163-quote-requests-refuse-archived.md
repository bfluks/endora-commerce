---
'@endora-commerce/mod-quote-requests': minor
---

Quote requests refuse an archived product (product data scopes). A product archived with catalog's Archive action can no longer be put on a quote request through any path:

- **Buyer:** create, draft edit and resubmit — and so cart conversion, the quick order build, shopping-list conversion and order clone, which all create through the same path — answer `404 PRODUCT_NOT_FOUND`, exactly as for a product that does not exist. This now also holds outside a request (no sales channel), where only the audience rule used to run.
- **Behaviour change for API clients — operator:** `POST /api/v1/admin/quote-requests` and `PATCH /api/v1/admin/quote-requests/:id` refuse a line whose product is archived with `409 PRODUCT_ARCHIVED` ("Product is archived.") and write nothing; a product id that does not exist still answers `404 PRODUCT_NOT_FOUND`. Before, the create accepted it and answered a `PRODUCT_UNAVAILABLE_IN_SCOPE` warning; that warning still covers every other reason a line is unavailable.
- **Convert:** converting an approved quote whose product has been archived since answers the existing `409 PRODUCT_NOT_FOUND` before the basket is touched (the line would have been refused at order placement anyway).

Price lists are unchanged: an archived product can still be priced.
