---
'@endora-commerce/mod-returns': minor
---

Returns honour the per-line returnable flag recorded at purchase; complaints stay unrestricted.

- **Behaviour change for API clients.** `GET /api/v1/orders/:orderId/returnable` gives each line `returnable` and, when it may not be returned, `notReturnableReason: 'product_not_returnable'`. **`eligible: false` with the new reason `no_returnable_lines` still allows a complaint** — `eligible` answers for `return`-kind cases only.
- `POST /api/v1/returns` with `kind: 'return'` naming a line recorded as not returnable is refused with `422 RETURN_LINE_NOT_RETURNABLE` (`details.productName`, `orderItemIds[]`, `lines[]`). Complaints are never restricted.
- **Duplicate order lines in one request are summed** per order line, for both kinds, and checked against the remaining quantity (`qty_exceeds_returnable`). An unknown line is reported before any quantity error.
- Lines of orders placed before this release carry no recorded value and count as returnable. **FR-034: products default to not returnable, so lines of orders placed after the upgrade are not returnable until their products are marked** in the catalogue (Bulk edit → Returnable); orders placed before the upgrade are unaffected.
- New bundle sentence `errors.RETURN_LINE_NOT_RETURNABLE` in English and Polish.
