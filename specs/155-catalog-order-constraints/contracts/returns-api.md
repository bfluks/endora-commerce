# Contract: returns — per-line returnability

Research: R3, R14. All changes additive.

## 1. Port — `OrderReturnContextPort` (container `orderReturnContextPort`, owner `orders`)

```ts
export interface OrderReturnContextLine {
  // …existing…
  /**
   * Feature 155 (FR-016a) — the product's returnable flag recorded when the order was placed.
   * `null`: the order was placed before the flag was recorded. `orders` reports the fact; the
   * policy for `null` (returnable, FR-025) is `returns`'.
   */
  returnableAtPurchase: boolean | null;
}
```

## 2. `GET /api/v1/orders/:orderId/returnable` (customer, unchanged gate)

`returnableLineSchema` (`returns.ts:187`) gains:

```ts
/** Feature 155 — may this line be included in a `return` case? (complaints are never restricted) */
returnable: z.boolean(),
notReturnableReason: z.enum(['product_not_returnable']).optional(),
```

`returnableResponseSchema.reason` (`returns.ts:199`) gains `'no_returnable_lines'`:

| Order state | `eligible` | `reason` | Return form | Complaint form |
| --- | --- | --- | --- | --- |
| not completed | `false` | `order_not_completing` | no | no (unchanged) |
| everything returned | `false` | `fully_returned` | no | no (unchanged) |
| completed, ≥ 1 line returnable with quantity left | `true` | — | lines with `returnable: true` | all lines |
| completed, no line returnable | `false` | **`no_returnable_lines`** | no — "no products in this order are returnable" | **yes** (FR-018) |

Precedence: `order_not_completing`, then `fully_returned`, then `no_returnable_lines`.

**`eligible` changes meaning (analyze F13).** Until this feature `eligible: false` meant "no case of
either kind can be opened" (the storefront replaced the whole form). It now means "no `return`-kind case
can be opened"; with `reason: 'no_returnable_lines'` a `complaint` is still accepted. A client that
treated `eligible: false` as "nothing possible" must branch on `reason`. Stated in the `mod-returns`
changeset and the returns module docs (EN and PL).

## 3. `POST /api/v1/returns` (customer create case)

Request unchanged (`createReturnCaseRequestSchema`, `returns.ts:205–220`). Checks, in order, after the
existing order-ownership and completing-status checks:

1. **Per-line totals (FR-033, both kinds).** Requested quantities are summed per `orderItemId`; an
   unknown `orderItemId` keeps `unknown_line`; a sum above the line's remaining quantity →
   `422 VALIDATION_FAILED`, `details.code = 'qty_exceeds_returnable'` (the existing code, now judged on
   the sum). 3 + 3 against 4 remaining → refused; 2 + 2 → accepted (as 4). The case's lines are stored
   **as sent** — each entry keeps its own `reasonId` and `description`.
2. Reason check (unchanged).
3. **Returnability (`kind: 'return'` only, FR-019).** Any requested line whose returnability
   (`returnableAtPurchase ?? true`) is `false` → `422 RETURN_LINE_NOT_RETURNABLE`,
   `details: { productName, orderItemIds, lines: [{ orderItemId, productName }] }`, each such line once;
   no case created. `kind: 'complaint'` is never checked (FR-020). Existing cases are never
   re-evaluated (FR-022).

The free-return window and everything after are unchanged.

## 4. Owner off

`returns` off: §2 and §3 answer `503 MODULE_DISABLED` (unchanged); `orders` still records
`returnable_at_purchase` at placement — always an explicit boolean for new orders, `false` when the
product's record or flag could not be read (FR-016a fail-closed).
