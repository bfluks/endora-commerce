---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-orders': minor
---

A reorder reports the lines that no longer have a price (issue #166).

- **Behaviour change — reorder.** `POST /api/v1/orders/:id/reorder` and the admin reorder seed every line at the price the buyer may order it at now, and leave out a line nothing prices for this buyer (or that is sold on request only), reporting it in `unavailableItems` with `reason: 'no_price'` beside the discontinued products. Such a line used to be seeded at the old order's price without being reported, and placement then refused the basket.
- **`CartSeedOptions.dropUnorderable`** (contracts): `CartWritePort.replaceItemsForCustomer` leaves out the seed lines that have no orderable price and names them in the answer's new optional `unorderable` (`CartSeedUnorderableLine[]`: `productId`, `variantId`, `reason: 'unpriced' | 'quote_only'`). Ignored for an agreed seed. Absent, behaviour is unchanged.
- **`CartService.repriceLinesForCustomer`** (carts) now answers the lines it could not price, by cart item id, with the reason; it still prices them all in one batched call.
