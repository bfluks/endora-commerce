---
'@endora-commerce/mod-quick-order': minor
---

Quick order applies minimum order quantities to the file, bounds builds to 200 lines and caps imports at 10 000 rows.

- **Behaviour change for API clients — import preview.** Each product's pieces minimum is judged on its total across the whole file (duplicate rows merged, variants summed), never with the cart. On the buyer's import every row of such a product is rejected with `below_minimum`, `minimum` and `productTotal`; on the operator's import (`/api/v1/admin/quick-order/import`) the row stays recognized with `warning: { reason: 'below_minimum', minimum, productTotal }` and the summary counts it in `warningCount`. The on-behalf screen badges the row.
- **Behaviour change for API clients — build bound.** **Builds of more than 200 lines are refused, including to a quote request**: `POST /api/v1/quick-order/build` and its admin twin answer `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`, before anything else.
- **Build to a cart is a partial success:** lines that meet their minimums are added and the others come back in `rejected[]` (`reason: 'below_minimum'`, `kind`, `minimum`, `packagingUnitName`). A hidden or unpublished product fails the build as unknown before anything is added. A build to a quote request is refused below a minimum for a buyer and flagged for an operator.
- **One-click buy** orders a product's minimum order quantity instead of 1. **A one-click refused for its line (below a minimum, no price, unknown product) now leaves the buyer's basket as it was**; it used to empty it. The basket is replaced only once the line passes, through `CartWritePort.addItems` with `replaceExisting`; a refusal at placement still leaves it holding the one-click line.
- Refusals name products in the language the response is answered in (q-sorted `Accept-Language`, else the channel default; an operator's stored preference on the admin build), on build, build to a quote request and one-click buy.
- `quick_order.import_max_rows` is clamped to 1–10 000 whatever its stored value.
