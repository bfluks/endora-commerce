---
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-shopping-lists': patch
---

The acquisition seams ask `catalogProductAvailabilityPort` (product data scopes per sales channel and language) instead of testing membership, audience or status themselves.

- **Behaviour change for API clients — basket:** adding a product to the basket (single add and the batch add behind quick order, shopping-list and quote conversions) is refused with `404 PRODUCT_NOT_FOUND` — the answer an absent product gets — when the product is not effectively available at the basket's channel and the request's language (switched off there, outside its publication window, or outside the channel's audience rule). The add path used to test no status at all, so a `draft` member product could be put in a basket. A line whose product goes off after it was added stays in the basket and reads `unavailable` (`unavailableReason: 'not_purchasable'`); submitting the basket for approval and placing the order refuse it with `404 PRODUCT_NOT_FOUND` and its `cartItemIds`, and the checkout preview lists it as `product_unavailable`. The cart's up-sell strip shows only available products.
- **Orders:** the admin order preview reports a member product that is not available in the chosen channel (at its default language) as `PRODUCT_NOT_IN_SALES_CHANNEL`. Reorder and quote conversion are unchanged (their lines are refused at placement as above).
- **Quote requests:** a buyer's request (create, draft edit, resubmit) naming a product not available at the request's channel and language is refused with `404 PRODUCT_NOT_FOUND`. `POST /api/v1/admin/quote-requests` still accepts such a line and answers `warnings: [{ productId, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]` beside `data` (only when there is one).
- **Comparisons and shopping lists:** a product not available at the request's channel and language cannot be added or saved (`404 PRODUCT_NOT_FOUND`); a comparison column reads `available` from the same answer; a saved line whose product went off is skipped on conversion as `product_not_found`.
- **Quick order:** a pasted SKU of a product not available in the request's channel is rejected as `product_not_found`; the operator's import arm is unchanged.
- **Effective names (FR-017):** basket line names and batch below-minimum outcomes, quote-request line snapshots (buyer: request language; operator: channel default) and comparison names and compared values follow the channel's overrides at the request language.
