---
'@endora-commerce/mod-carts': minor
---

The cart enforces minimum order quantities and adds lines in batches.

- **Behaviour change for API clients — add and edit are refused below a minimum.** `POST /api/v1/cart/items` and `PATCH /api/v1/cart/items/:itemId` judge the cart as the change would leave it (the product's total over every line and variant) and refuse with `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, message in the buyer's language, nothing written. An edit to `0` and `DELETE` still remove the line. Editing a line whose product no longer exists answers `404 PRODUCT_NOT_FOUND`.
- **Cart view.** `GET /api/v1/cart` gives each line `minOrderQuantity` and `belowMinimum` (`{ kind, minimum, packagingUnitName? }` or `null`). A line whose product record was hard-deleted is reported `unavailable: true` (`unavailableReason: 'not_purchasable'`). **If the catalogue cannot be read the view now answers `5xx`** instead of a cart without these flags. `?view=mini` is unchanged.
- **Quote-seeded exemption, by state.** A line seeded from an accepted quote request is exempt from the minimums while its quantity equals the quote's (new column `cart_items.quote_seeded_quantity`); changing it makes it an ordinary line until it is set back. The cart takes the mark at face value; checkout and placement in `mod-orders` confirm the quote is still valid.
- **Batch add: `CartWritePort.addItems`** (and `CartService.addItems`), up to 200 lines per call. Every line is resolved first with the single add's checks, then the resolved lines are judged together with the cart and only those that pass are added; the rest come back as `below_minimum` or `failed` outcomes. With `onLineError: 'throw'`, **a batch with an unknown or hidden product now fails before any line is added**.
- **Quote request → cart** now adds the quote's lines as one batch. A line below a product's minimum is dropped with reason `below_minimum` and its `minimum` (it was reported as `no_price_in_customer_list`); a product the buyer may no longer see is dropped as `not_purchasable`.
- **Cart → quote request** sends each line's `packagingUnitId`; a line whose unit has since been deleted is sent as plain pieces.
- Migration `20261016T082018_carts_cart_item_quote_seeded_quantity.ts`.
