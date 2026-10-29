# Contract: quote requests — packaging references, minimums, operator warnings

Research: R5, R10, R13. Every customer-facing request schema stays **non-strict** (feature 146
coordinator ruling M4); `patchQuoteRequestSchema` keeps its existing body-level `.strict()`.

## 1. Buyer line — `createQuoteRequestLineSchema` (`quote-requests.ts:422`)

```ts
/** Feature 155 (FR-026) — the catalogue unit the line is ordered in. Wins over name/base quantity. */
packagingUnitId: uuidSchema.optional(),
```

Shared by `POST /api/v1/quote-requests` (create) and `PATCH /api/v1/quote-requests/:id` (draft edit).

Resolution (per line, before anything is written):

| Line sends | Accepted when | Stored | Refusal reason |
| --- | --- | --- | --- |
| `packagingUnitId` (± name / base) | id is a current unit of the line's product | id + catalogue name + catalogue base quantity | `unknown_unit` — one reason for an unknown, deleted or another product's id (FR-026, threat F6); the distinction is logged only |
| name + base quantity, no id | the product has a unit with that name **and** that base quantity | that unit's id + values | `name_unknown`, `base_quantity_mismatch` |
| name without base quantity | treated as name + base mismatch | — | `base_quantity_mismatch` |
| nothing | always | plain pieces | — |

Any refusal → `422 PACKAGING_UNIT_MISMATCH`, `details: { lineNumber, productName, lines: [{ index,
productId, productName, reason }] }` for every failing line (contracts/error-codes.md), nothing
written. Resolution runs only on lines whose product passed `#acquirableProductsById` (the 404 runs
first, FR-029), and `listPackagingUnitsByProductIds` is called only with those vetted ids
(contracts/catalog-api.md §5). `quantity` stays base pieces (feature 146).

## 2. Minimum refusal on buyer writes

`POST /api/v1/quote-requests`, `PATCH /api/v1/quote-requests/:id`, `POST /api/v1/quote-requests/:id/resubmit`,
and every in-process `RfqCustomerPort.createForCustomer` caller acting for the buyer (cart → quote,
quick order, shopping list → quote, buyer clone of an order):

- `422 PRODUCT_BELOW_MINIMUM_QUANTITY` / `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (first line's kind),
  `details.lines: [{ index, productId, productName, kind, minimum, packagingUnitName? }]` for every
  offending line, the first line's `productName` / `minimum` / `packagingUnitName` also top-level;
  nothing written; no reference price resolved.
- Position (FR-029): after the price-proposal refusal (unchanged place) and the product 404; packaging
  (§1) before minimums; both before reference pricing.
- Draft edit exemption (FR-031 (b)): a line paired to a stored row with identical product, variant,
  packaging and quantity is not refused, and still counts toward its product's total.
- Resubmit: pieces only (packaging is dropped by `resubmit` today), no exemption.
- Accept / reject a revision: never checked.

## 3. In-process option — `CreateForCustomerOptions` (`quote-requests.ts:797`)

```ts
export interface CreateForCustomerOptions {
  lineReferencePrices?: …;               // feature 146, unchanged
  /**
   * Feature 155 (FR-012, FR-030) — `'enforce'` (default): a buyer is writing, minimums refuse.
   * `'warn'`: a sales representative is writing through the buyer's path (admin clone-to-quote,
   * admin quick-order build); nothing is refused for minimums and the admin read flags the lines.
   * In-process only: no HTTP body can carry it (`createQuoteRequestSchema` has no such key).
   * Packaging validation (FR-026) applies either way.
   */
  minimums?: 'enforce' | 'warn';
  /**
   * Review fix round A (D3/D4) — the language a refusal names a product in: the caller's
   * `request.responseLanguage()`. Absent, the record's own fallback chain.
   */
  language?: string;
}
```

`patchDraft` and `resubmit` take the same `{ language }` as a trailing option. Every buyer route
passes it, and so do the in-process callers that carry a buyer's request (cart → quote request,
shopping list → quote request, the buyer's quick-order build).

Callers setting `'warn'`: `OrderCloneToQuoteService.clone(…, { actor: 'operator' })` from
`POST /api/v1/admin/orders/:id/clone-to-quote`; `QuickOrderBuildService.build(…, { actor: 'operator' })`
from `POST /api/v1/admin/quick-order/build` (target `quote_request`). Admin `createOnBehalf` and
`modify` do not call the check at all.

## 4. Admin read — `GET /api/v1/admin/quote-requests/:id` (`rfqs:handle`, unchanged)

`quoteRequestItemSchema` (`quote-requests.ts:33`) gains, **admin serialisation only**:

```ts
/** Feature 155 (FR-030) — set when the line is below its product's current minimum. Informs only. */
minimumWarning: z
  .object({
    kind: z.enum(['pieces', 'packaging_unit']),
    minimum: z.number().int().positive(),
    packagingUnitName: z.string().optional(),
  })
  .nullable()
  .optional(),
/** Feature 155 — the resolved catalogue unit (admin and customer). */
packagingUnitId: uuidSchema.nullable().optional(),
```

`packagingUnitId` is stored by `createForCustomer` / `patchDraft` from the resolution, **carried by
admin `modify`** with the paired stored line's snapshot (an operator never sends it; a line `modify`
adds has none), exposed on **both** the admin and the customer read, and on `listItems`. Each of the
three is pinned by a RED test (T077, analyze F14).

Evaluated over the request's current lines with no exemption (product totals across the request).
The customer serialisation (allow-list, feature 146 T7) gains `packagingUnitId` only; a contract
test pins that `minimumWarning` never reaches `GET /api/v1/quote-requests/:id` or the list.

## 5. Read port — `QuoteRequestLineRecord` (`quote-requests.ts:704`)

Gains optional `packagingUnitId?: string | null`, populated by `listItems`.

## 6. Unchanged

`convertToOrder` (seeds pieces, no packaging, with the source mark — FR-028 exempts its lines while
their quantity equals the quote's; at checkout `orders` honours that only while the request is still
`Approved`, not yet ordered, of the buyer's organization and within its validity — FR-036, research
R19),
`createOnBehalf` / `modify` request schemas, the 200-line cap, the negotiation lock.
