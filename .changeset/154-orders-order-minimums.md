---
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-i18n': minor
---

Placement enforces minimum order quantities, records whether each line was returnable, and admin and API order intake are bounded to 200 lines.

- **Behaviour change for API clients — placement refuses a basket below a minimum.** Checkout, one-click buy, reorder, a basket filled from a quote request, admin Create order and the external order API answer `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` with `details.lines[]`, checked right after the basket is read and **before** the order value and credit checks, the order number and any stock or credit reservation — a refusal writes nothing. A line whose product record is gone answers `404 PRODUCT_NOT_FOUND` with `details.cartItemIds`.
- **Quote exemption only while the quote is valid.** Lines seeded from an accepted quote request are exempt only while that quote request still exists, belongs to the buyer's organization, is `Approved` and within its validity, is recorded by no order, and still has a line at the agreed price in the basket. With `mod-quote-requests` switched off no line is exempt.
- **Checkout preview:** `POST /api/v1/orders/preview-total` answers `belowMinimumLines[]` with the same exemptions (`kind: 'product_unavailable'` for a vanished product).
- **Admin order preview:** a line whose product total is below its minimum is unavailable at zero price with the message code `BELOW_MINIMUM_QUANTITY` and its `minimum`, judged after the four existing codes.
- **Behaviour change for API clients — 200-line bound.** `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview` and the external `POST /api/v1/external/orders` refuse more than 200 lines with `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, before any line is evaluated. On the external API this is a public API change: it is checked before the `Idempotency-Key` header is required and leaves no idempotency record. Admin create and the external API also refuse a request whose product total is below the pieces minimum, `details.lines[]` keyed by `index`.
- **Returnable at purchase.** Every placement path stamps `order_items.returnable_at_purchase` from the product's **Returnable** flag (fail-closed: a product that cannot be read is recorded not returnable). Older lines hold `null`. `OrderReturnContextPort` lines carry it as `returnableAtPurchase`.
- **Create order screen** shows a below-minimum line's reason; `mod-i18n`'s `core` bundle gains `orderCreate.line.belowMinimum` and `orderCreate.line.belowMinimumUnknown` in English and Polish.
- Migration `20261016T082022_orders_order_item_returnable_at_purchase.ts`.
