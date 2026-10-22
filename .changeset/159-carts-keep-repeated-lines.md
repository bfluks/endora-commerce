---
'@endora-commerce/mod-carts': minor
---

Baskets can hold one product on several lines when an order is created for a customer.

- **`addItems` `keepRepeatedLines`** (with `replaceExisting` only): every line of the batch is written as a line of its own — a repeated product, variant and packaging unit is not merged into the first — priced at its own quantity, and created in batch order a millisecond apart. Minimums are still judged on a product's total across the batch. The admin order creation uses it to place one product on lines of several groups (feature 159).
- **Deterministic basket order.** `replaceItemsForCustomer` creates its lines a millisecond apart in seed order, and the placement read of the basket (`readActiveForPlacement`) now orders the lines by creation time like every other basket read — it carried no order before, so an order placed from a seeded basket could list its lines in any order.
