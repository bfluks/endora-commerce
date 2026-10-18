# Contract: cart, batch paths, checkout and admin order creation

Research: R4, R8, R10, R11, R12, R15, R16, R19, R20. All schema changes additive. The FR-038 bounds
(§5, §10) are service-level refusals of requests no target could complete (R20), not schema changes.

**One minimum-line shape (R10).** Wherever a refusal or report lists offending lines it uses
`{ <key>, productId, productName, kind, minimum, packagingUnitName? }`, `<key>` being `cartItemId`
(cart, placement, preview) or `index` (admin create, API intake). A line that failed visibility,
channel or packaging-unit resolution is **never** listed this way (FR-035): it gets the unknown-id
answer, with no name and no minimum.

## 1. Single add — `POST /api/v1/cart/items` (and `CartWritePort.addItem`)

Request unchanged (`addCartItemRequestSchema`, `carts.ts:58`). Order of refusals:

1. `quantity < 1` → `422 CART_QUANTITY_INVALID` (unchanged)
2. product unknown / not visible / not in channel → `404 PRODUCT_NOT_FOUND` (unchanged, one answer)
3. unknown packaging unit → `404 PACKAGING_UNIT_NOT_FOUND` (unchanged)

   Steps 1–3 are `CartService.#resolveLine`, shared verbatim with `addItems` (§4).
4. **new** — the prospective basket (cart lines with their face-value exemptions, this add merged
   into the matching line or appended) leaves the touched line below a minimum →
   `422 PRODUCT_BELOW_MINIMUM_QUANTITY` (pieces) or `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (unit;
   only when the pieces rule passes for that line). Details:

   ```json
   { "productId": "…", "productName": "Anchor bolt M8", "minimum": 10, "total": 5 }
   { "productId": "…", "productName": "Anchor bolt M8", "packagingUnitId": "…", "packagingUnitName": "Pallet", "minimum": 2, "units": 1 }
   ```
   Nothing written; no `price_lists` call made.
5. line cap, quote-only, pricing (unchanged)

## 2. Edit — `PATCH /api/v1/cart/items/:itemId`

`quantity: 0` removes (unchanged, FR-007). `quantity ≥ 1`: step 4 above with the line's new quantity;
refused → line unchanged. A line whose product record is absent → `404 PRODUCT_NOT_FOUND` (FR-037).
`DELETE` never checks.

## 3. Full cart view — `GET /api/v1/cart`

`cartViewLineSchema` (`carts.ts:143`) gains:

```ts
/** Feature 155 — the product's current pieces minimum (null = none); the storefront's input floor. */
minOrderQuantity: z.number().int().positive().nullable().optional(),
/** Feature 155 — set when this line is below a current minimum and not exempt (FR-013, FR-028). */
belowMinimum: z
  .object({
    kind: z.enum(['pieces', 'packaging_unit']),
    minimum: z.number().int().positive(),
    packagingUnitName: z.string().optional(),
  })
  .nullable()
  .optional(),
```

Exemptions are taken at face value from the basket's mark (FR-028); the checkout preview may still
flag an "exempt" line (§8). A line whose product record is absent (FR-037) is reported with the
existing `unavailable: true`, `unavailableReason: 'not_purchasable'` and `belowMinimum: null`. A
failed catalogue read fails the view (D7). The mini view (`?view=mini`) is unchanged.

## 4. Batch add — `CartWritePort.addItems` (in-process only; no route)

```ts
export interface CartBatchLineInput {
  productId: string;
  variantId?: string;
  /** Pieces, or units when `packagingUnitId` is set — as `addItem`. */
  quantity: number;
  packagingUnitId?: string;
  salesChannelId?: string;
}

export type CartBatchLineOutcome =
  | { index: number; status: 'added' }
  | {
      index: number;
      status: 'below_minimum';
      productId: string;
      productName: string;
      kind: 'pieces' | 'packaging_unit';
      minimum: number;
      packagingUnitName?: string;
    }
  | { index: number; status: 'failed'; error: { status: number; code: string; message: string } };

export interface CartWritePort {
  // …existing…
  /**
   * Feature 155 (R8) — add several lines. (1) Every line is resolved with exactly `addItem`'s
   * preconditions (quantity, visibility, channel, packaging unit in product); a line that fails gets
   * the unknown-id answer and takes no part in the evaluation. (2) The resolved lines are judged with
   * the cart in two passes — unit minimums, then pieces minimums over the survivors; lines below a
   * minimum are not added and are reported. Lines already in the cart are never rejected. (3) The
   * accepted lines are added.
   * `onLineError: 'throw'` — the first resolution failure is thrown before anything is written; a
   * later add failure is thrown as `addItem` would (lines before it stay added).
   * `'report'` — every failure is returned as `failed`. `ModuleDisabledError` is always thrown.
   * At most `CART_MAX_LINES` lines.
   */
  addItems(
    actor: { customer?: CartCustomerContext; anonymousToken?: string },
    lines: readonly CartBatchLineInput[],
    options: { onLineError: 'throw' | 'report' },
  ): Promise<CartWithItems & { outcomes: CartBatchLineOutcome[] }>;
}
```

`CartItemRecord` gains `quoteSeededQuantity: number | null`; contracts export
`isQuoteSeededLineExempt(cart, item)` (data-model §2).

## 5. Batch callers and their reports

| Path | Call | Report change |
| --- | --- | --- |
| Quick order build, target `cart` (buyer and operator) | `addItems(…, 'throw')` | More than `QUICK_ORDER_BUILD_MAX_ITEMS` (200) items, either target → `422 VALIDATION_FAILED` `details: { code: 'too_many_items', maximum: 200 }` before anything else. `quickOrderBuildResponseSchema` gains `rejected: z.array(z.object({ productId, variantId: uuid.nullable(), quantity, productName, reason: z.literal('below_minimum'), kind, minimum }))`, always present for target `cart` |
| Shopping list → cart (`POST /api/v1/shopping-lists/:id/convert-to-cart` and `POST /api/v1/cart/from-shopping-list/:id`, both reaching `ShoppingListService.convertToCart`) | `addItems(…, 'report')` | `conversionSkipSchema.reason` gains `'below_minimum'`; new optional `minimum: z.number().int().positive()`. A `failed` 404 becomes a `product_not_found` skip (as a deleted product today); any other `failed` is rethrown |
| Quote request → cart (`/api/v1/cart/from-quote-request/:id`) | `addItems(…, 'report')` | `cartDroppedLineReasonSchema` gains `'below_minimum'`; `cartDroppedLineSchema` gains optional `minimum`. A `failed` 404 maps to `not_purchasable` (as an unknown product today); any other `failed` keeps `no_price_in_customer_list` |
| Admin create order (`order-creation-admin-service.ts`) | `addItems(…, 'throw')` on the transient basket | any `below_minimum` → whole request refused with the minimum code of the first, `details.lines` per the shape above with `index` |
| API order intake (`order-api-intake-service.ts`) | same | same |

## 6. Quick-order import preview — `POST /api/v1/quick-order/import` and `POST /api/v1/admin/quick-order/import`

The preview judges each product's **total across all recognised rows of the file** (duplicate rows
merged by `(product, variant)` as today, then every variant of the product summed), never with the
cart (FR-011 (a), P1). Rows rejected for an existing reason count toward no total.

- `quickOrderRejectionReasonSchema` (`quick-order.ts:37`) gains `'below_minimum'`;
  `rejectedQuickOrderItemSchema` gains optional `minimum: z.number().int().positive()` and
  `productTotal: z.number().int().nonnegative()` (the file total the verdict used).
- **Buyer's import**: every row of a product whose file total is below its pieces minimum moves to
  `rejected` with `below_minimum`, `minimum` and `productTotal`; `line` is the merged row's first line,
  `raw` its first raw line; `summary.recognizedCount` / `rejectedCount` follow.
- **Operator's import** (admin route): such a row stays in `recognized`;
  `recognizedQuickOrderItemSchema` gains optional
  `warning: z.object({ reason: z.literal('below_minimum'), minimum, productTotal })`, and the summary
  gains optional `warningCount`. Customer visibility is not judged here (`audience: 'unrestricted'`);
  the build judges it.
- The resolved `quick_order.import_max_rows` is clamped to `[1, 10 000]` (R20).

## 7. One-click — `POST /api/v1/quick-order/one-click`

Request/response unchanged. Default quantity becomes the product's pieces minimum when the product is
`simple` / `configurable` and has a minimum > 1 (FR-010); otherwise 1.

## 8. Checkout preview — `POST /api/v1/orders/preview-total`

`orderPreviewTotalResponseSchema` (`orders.ts:358`) gains:

```ts
/**
 * Feature 155 — basket lines placement will refuse. Exemptions apply only when the basket's quote
 * source is confirmed valid now (FR-036); `product_unavailable` is a line whose product record is
 * gone (FR-037), with no name or minimum.
 */
belowMinimumLines: z
  .array(
    z.object({
      cartItemId: uuidSchema,
      productId: uuidSchema,
      productName: z.string().optional(),
      kind: z.enum(['pieces', 'packaging_unit', 'product_unavailable']),
      minimum: z.number().int().positive().optional(),
      packagingUnitName: z.string().optional(),
    }),
  )
  .default([]),
```

The quote-source assessment is the read-only twin of placement's (R19): no lock, so under a race the
preview is advisory and placement binds.

## 9. Placement — `POST /api/v1/orders` (and every `placeOrder` caller)

Inside the transaction, right after the basket read and before the value gate, the business id, any
stock or credit reservation (R19):

1. one product + packaging-unit read for the basket;
2. the quote-source vouch with its advisory lock (only when the basket carries a mark); exemptions
   honoured only when it accepts **and** the quote's validity has not lapsed;
3. the evaluation:
   - any `product_unavailable` → `404 PRODUCT_NOT_FOUND`, `details: { cartItemIds }`;
   - any minimum violation → `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
     `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (first line's kind), `details.lines` with `cartItemId`.

Nothing written. The recorded `source_quote_request_id` and `returnable_at_purchase` use the same
reads.

## 10. Admin create-order preview and create — `POST /api/v1/admin/orders/preview`, `POST /api/v1/admin/orders` (`orders:write`, unchanged)

- More than `ADMIN_ORDER_MAX_ITEMS` (200) items on create or preview → `422 VALIDATION_FAILED`,
  `details: { code: 'too_many_items', maximum: 200 }`, refused whole by the service / handler as its
  first step, before any line is evaluated (FR-038). The request schemas stay unbounded: a Zod
  refusal answers 400, and FR-038 requires 422 (R20).
- `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` (`orders.ts:799`) appends `'BELOW_MINIMUM_QUANTITY'` (last).
  `messages[]` items gain optional `minimum: z.number().int().positive()`. A line with an earlier code
  keeps that code (and never carries a minimum); the field stays a plain string (`orders.ts:820–825`),
  so older clients parse it.

## 11. Storefront reports

The storefront renders `belowMinimum`, `belowMinimumLines`, `rejected[]`, `skipped[].minimum` and
`droppedLines[].minimum` with its own PL/EN strings; refusals carry the backend's translated
`error.message` (the request's language).
