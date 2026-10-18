---
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-i18n': minor
---

Quote requests validate packaging units by id and apply minimum order quantities — refused for buyers, flagged for sales reps.

- **Behaviour change for API clients — packaging validation.** A customer line (create, draft edit, cart → quote request) may carry `packagingUnitId`; it must be a current unit of the line's product, and the server stores that unit's catalogue name and base quantity. A line sending a packaging name and base quantity without an id is accepted only when both match one of the product's units. Anything else is refused whole with `422 PACKAGING_UNIT_MISMATCH`, `details.lines[]` with `index` and `reason`; every failure of an id has the single reason `unknown_unit` (a name gives `name_unknown` or `base_quantity_mismatch`). **A buyer request with a non-matching packaging label is now refused, including a draft edit of an existing request whose stored label no longer matches a catalogue unit.** `packagingUnitId` is returned on the admin and customer reads.
- **Behaviour change for API clients — buyer writes refused below a minimum.** Customer create (`POST /api/v1/quote-requests`, also from the cart, quick order, a shopping list or an order clone), draft edit (`PATCH /api/v1/quote-requests/:id`) and resubmit answer `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`. Order: hidden or unpublished products as unknown first, then packaging, then minimums. A draft edit does not refuse a line left unchanged. Resubmit is judged as a new request; **a resubmit of a request whose product no longer exists now answers `404 PRODUCT_NOT_FOUND`**.
- **Sales-rep writes warn.** Create on behalf, Modify, the admin's order clone and the admin quick-order build write below-minimum lines; `GET /api/v1/admin/quote-requests/:id` gives each such line `minimumWarning` (`{ kind, minimum, packagingUnitName? }`), shown as a *Below minimum* badge on the quote request screen. It never reaches the customer read.
- `RfqCustomerPort.createForCustomer` accepts `options.minimums` (`'enforce' | 'warn'`).
- `mod-i18n`'s `core` bundle gains `rfq.detail.minimum.pieces`, `rfq.detail.minimum.packagingUnit` and `rfq.detail.minimum.packagingUnitUnnamed` in English and Polish.
- Migration `20261018T122118_quote_requests_item_packaging_unit_id.ts` adds `quote_request_items.packaging_unit_id`.
