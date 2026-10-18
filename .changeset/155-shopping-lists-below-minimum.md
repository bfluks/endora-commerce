---
'@endora-commerce/mod-shopping-lists': minor
---

**Behaviour change for API clients.** Converting a shopping list to a cart adds the active items as one batch judged with the cart's minimum order quantities. An item whose product would stay below a minimum is skipped with reason `below_minimum` and the `minimum` it missed; a product the buyer may no longer see, or that the channel does not publish, is skipped as `product_not_found`. The other items are still added and the response stays `200` with `{ added, skipped }`. Converting to a quote request is unchanged here; it now refuses below-minimum lines because `mod-quote-requests` enforces minimums on customer writes, naming the products in the language the response is answered in.
