# Data model: minimum order quantities and the returnable flag

**Feature**: `specs/155-catalog-order-constraints/` | Decisions: [research.md](./research.md) R1–R5

No new table, no new entity class. Five nullable-or-defaulted columns on four existing tables, owned
by three modules, in **three migrations** — one per owning module (the `carts` state reads an existing
column, §2), each scaffolded with
`pnpm --filter backend run migration:new -- --module <id> --name <slug>` (never numbered by hand,
`specs/conventions/module-migrations.md`). Every table touched is already `@GlobalEntity()`; no tenant
classification changes and no foreign key is added, so `test/unit/db/fk-dependency-drift.test.ts` and
the module graph are unaffected.

## 1. `catalog` — migration `order_rules`

```sql
alter table "products"
  add column "min_order_quantity" integer null,
  add column "returnable" boolean not null default false,
  add constraint "products_min_order_quantity_check" check ("min_order_quantity" is null or "min_order_quantity" between 1 and 1000000);

alter table "product_packaging_units"
  add column "min_order_units" integer null,
  add constraint "product_packaging_units_min_order_units_check" check ("min_order_units" is null or "min_order_units" between 1 and 1000000);
```

`down` drops the two constraints and the three columns.

### `Product` (`packages/modules/catalog/src/backend/entities/product.entity.ts`)

| Property | Column | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `minOrderQuantity` | `min_order_quantity` | `number \| null` | `null` | Pieces, 1…1 000 000 (`ORDER_MINIMUM_MAX`, FR-001). Meaningful for `simple` / `configurable` only (R6.1, R9); inherited by variants (variants are `product_variants` rows with no column of their own). `1` ≡ no minimum. |
| `returnable` | `returnable` | `boolean` | `false` | FR-003/FR-004. Every type. Add to `[OptionalProps]`. |

### `ProductPackagingUnit` (`…/entities/product-packaging-unit.entity.ts`)

| Property | Column | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `minOrderUnits` | `min_order_units` | `number \| null` | `null` | Units of this packaging unit, 1…1 000 000 (FR-002). Add to `[OptionalProps]`. Hard delete of a unit removes its rule; lines keep their snapshot and count as pieces (spec edge case). |

Validation (R9): integer 1…1 000 000 or `null` (clear), enforced three times — the request schemas,
the services (`isValidOrderMinimum`, because `CatalogPackagingPort` callers bypass the route schema;
refusal `422 VALIDATION_FAILED`, `details.field`), and the `check` constraints. `minOrderQuantity`
non-null on a type other than `simple` / `configurable` → `422 VALIDATION_FAILED`
`details.field = 'minOrderQuantity'`, on create and update (D5).

Audit (FR-005): `#applyProductUpdate`'s `stateBefore` / `stateAfter` gain `minOrderQuantity` and
`returnable` — which reaches both the Command Bus path (`updateProductAudited`) and the legacy
per-product `AuditPort` rows the bulk edit writes (R9); `PackagingUnitService` `before` / `after` gain
`minOrderUnits`. The queued bulk edit's undo restores `returnable` through its generic column snapshot.

## 2. `carts` — no migration: the exemption reads `cart_items.agreed_quantity`

The per-line state this feature needs is the quantity a line was seeded with from an accepted quote
request. `carts` already stores exactly that as `agreed_quantity` (migration
`20261018T074021_carts_cart_item_agreed_price`, the quantity a quote-seeded line's agreed price holds
at), so this feature adds no column (research R4).

### `CartItem` (`packages/modules/carts/src/backend/entities/cart-item.entity.ts`)

| Property | Column | Type | Notes |
| --- | --- | --- | --- |
| `agreedQuantity` (existing) | `agreed_quantity` | `number \| null` | Set by `replaceItemsForCustomer` to the line's quantity when `options.sourceQuoteRequestId` is set; `null` for every other line. Never written by any other path. Exposed on the record as `quoteSeededQuantity`. |

**Derived state — quote-line exemption (FR-028).** One predicate, in `@endora-commerce/contracts`
(`packages/contracts/src/carts.ts`):

```ts
export function isQuoteSeededLineExempt(
  cart: Pick<CartRecord, 'sourceQuoteRequestId'>,
  item: Pick<CartItemRecord, 'quantity' | 'quoteSeededQuantity'>,
): boolean {
  return (
    cart.sourceQuoteRequestId !== null &&
    item.quoteSeededQuantity !== null &&
    item.quantity === item.quoteSeededQuantity
  );
}
```

| Event | Effect on exemption |
| --- | --- |
| Accepted quote → basket (`convertToOrder` → `replaceItemsForCustomer` with source) | every seeded line exempt |
| Buyer edits a seeded line's quantity | not exempt while it differs; equal to the quote's again ⇒ exempt again (FR-028, P2) |
| `addItem` bumps a seeded line (same product + variant, no unit) | quantity changes ⇒ not exempt |
| Login merge sums into a seeded line | quantity changes ⇒ not exempt |
| New line added after seeding | `agreedQuantity = null` ⇒ never exempt |
| Reorder seed / another accepted quote | all rows replaced ⇒ previous exemptions gone |
| Last line removed | `sourceQuoteRequestId` cleared (`cart-service.ts:133–138`) ⇒ nothing exempt |

`CartItemRecord` (`packages/contracts`) gains `quoteSeededQuantity: number | null`;
`toCartItemRecord` (`cart-read-port.ts`) maps it from `agreedQuantity`.

**The predicate is the per-line half only.** `carts` (add, edit, view) applies it to the basket's mark
at face value (FR-028). At the checkout preview and placement `orders` first decides whether the
basket's quote source honours exemptions at all (R19, FR-036): `judgeQuoteRequestSource` accepted
**and** `expiresAt` not lapsed; if not, every line is passed to the rule with `exempt: false`.

| Quote source at preview / placement | Exemptions |
| --- | --- |
| Approved, same organization, not yet ordered, validity open, an agreed line still on the basket | honoured per line (predicate above) |
| Cancelled, expired, completed (any status other than `Approved`) | none |
| `expiresAt` ≤ now | none |
| An order already carries it (second basket of one quote) | none |
| Another organization | none |
| No agreed line left on the basket | none |
| `quote_requests` off (`quoteRequestRead()` → `null`) | none (cannot be vouched, R17) |

## 3. `orders` — migration `order_item_returnable_at_purchase`

```sql
alter table "order_items" add column "returnable_at_purchase" boolean null;
```

### `OrderItem` (`packages/modules/orders/src/backend/entities/order-item.entity.ts`)

| Property | Column | Type | Notes |
| --- | --- | --- | --- |
| `returnableAtPurchase` | `returnable_at_purchase` | `boolean \| null` | Written once by `placeOrder` (`order-service.ts:1914`) as `product?.returnable === true` — always an explicit boolean; an absent record or flag records `false` (FR-016a fail-closed, P4). `null` only on rows placed before this feature. Never updated afterwards. Add to `[OptionalProps]`. |

Resolution, in `returns` (FR-017, FR-025): `returnable = line.returnableAtPurchase ?? true`.

## 4. `quote_requests` — migration `item_packaging_unit_id`

```sql
alter table "quote_request_items" add column "packaging_unit_id" uuid null;
```

### `QuoteRequestItem` (`packages/modules/quote_requests/src/backend/entities/quote-request-item.entity.ts`)

| Property | Column | Type | Notes |
| --- | --- | --- | --- |
| `packagingUnitId` | `packaging_unit_id` | `string \| null` | The catalogue unit the line resolved to under FR-026, beside the existing `packagingUnitName` / `packagingUnitBaseQuantity` snapshot (which now always hold the catalogue's values at write time for a resolved line). No FK: units are hard-deleted and the snapshot survives. Written by `createForCustomer`, `patchDraft`; carried by admin `modify`; not written by `createOnBehalf`, `resubmit` (unchanged behaviour: neither carries packaging). |

`QuoteRequestLineRecord` (`packages/contracts/src/quote-requests.ts:704`) gains
`packagingUnitId: string | null` (optional on the interface, so connector stubs keep compiling).

## 5. Evaluation input (not stored) — `packages/contracts/src/order-minimums.ts`

```ts
/** Feature 155 (FR-001, FR-002) — the upper bound of both minimums. */
export const ORDER_MINIMUM_MAX = 1_000_000;
/** Integer in 1…ORDER_MINIMUM_MAX. `null` (clear) is the caller's to allow. */
export function isValidOrderMinimum(value: number): boolean;

/** One line as the rule sees it. `quantity` is always base pieces. */
export interface OrderMinimumLine {
  /** Caller's identity for the line: a cart item id, a request line index, a row number. */
  key: string;
  productId: string;
  quantity: number;
  packagingUnitId: string | null;
  /** The line's own base-quantity snapshot; `null` = use the unit's current value. */
  packagingUnitBaseQuantity: number | null;
  /** Counted toward totals, never itself refused (FR-028, FR-031 (b)). */
  exempt: boolean;
}

export interface OrderMinimumRules {
  /** Records of the lines' products. A line whose product is absent here is `product_unavailable`. */
  products: ReadonlyArray<Pick<CatalogProductRecord, 'id' | 'type' | 'minOrderQuantity'>>;
  packagingUnits: ReadonlyArray<
    Pick<CatalogPackagingUnitRecord, 'id' | 'productId' | 'name' | 'baseQuantity' | 'minOrderUnits'>
  >;
}

export type OrderMinimumViolation =
  /** FR-037 — no record for the product: fail-closed, reported as an unknown product. */
  | { key: string; productId: string; kind: 'product_unavailable' }
  | { key: string; productId: string; kind: 'pieces'; minimum: number; total: number }
  | {
      key: string;
      productId: string;
      kind: 'packaging_unit';
      packagingUnitId: string;
      packagingUnitName: string;
      minimum: number;
      /** Real number: 96 pieces on a 64-piece unit = 1.5. */
      units: number;
    };

/**
 * Pure, O(lines + products + units). Violations in input-line order; for one line,
 * `product_unavailable` alone, else `pieces` before `packaging_unit`.
 */
export function evaluateOrderMinimums(
  lines: readonly OrderMinimumLine[],
  rules: OrderMinimumRules,
): OrderMinimumViolation[];

/**
 * Builds the refusal for a single- or multi-line case (R10) from **minimum** violations
 * (`product_unavailable` is the caller's 404, never passed here): the first violation's code; its
 * `productName`, `minimum` and `packagingUnitName` at the top level of `details` (what the bundle
 * sentence interpolates — SC-004); every violation in `details.lines`, each with its `productName`
 * and the caller's key under `keyName` (`cartItemId` or `index`). Names are resolved by the caller
 * in the request's language.
 */
export function minimumRefusal(
  violations: readonly Exclude<OrderMinimumViolation, { kind: 'product_unavailable' }>[],
  productNameById: ReadonlyMap<string, string>,
  keyName: 'cartItemId' | 'index',
): {
  code: 'PRODUCT_BELOW_MINIMUM_QUANTITY' | 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY';
  message: string;
  details: Record<string, unknown>;
} | null;
```

Rules (normative; research R6.1): a line with no product record → `product_unavailable`, counted
nowhere; minimums apply to eligible types only; pieces total per product including exempt lines; unit
count per (product, unit) over lines in that unit, with a vanished unit contributing no rule;
violations only on non-exempt lines; `minOrderQuantity ≤ 1` and `minOrderUnits = null` are "no rule".
The earlier `group` input is gone: the import preview now judges the file's product totals (P1), the
default scope.

**Batch admission (carts, R8)** is built on the function, not a second rule: pass 1 rejects batch
lines with a `packaging_unit` violation; pass 2 re-evaluates without them and rejects batch lines
with a `pieces` violation. Existing cart lines are never rejected. Two passes are the fix-point.

## 6. Worked examples (the spec's scenarios, as the function answers them)

| Lines (pieces; unit) | Rules | Violations |
| --- | --- | --- |
| A × 5 | A min 10 | A: pieces 5 < 10 (US1 #3) |
| A × 10 → edit to 4 | A min 10 | A: pieces 4 < 10 (US1 #4) |
| B 64 (Pallet 64) | Pallet min 2 | B: unit 1 < 2 (US2 #3) |
| B 5 | Pallet min 2, no pieces min | none (US2 #5) |
| B-red 64 (Pallet), B-blue 64 (Pallet) | Pallet min 2 | none (US2 #6) |
| C 128 (Pallet), C 3 | C min 10, Pallet min 2 | none — 131 ≥ 10, 2 pallets (US3 #3) |
| C 64 (Pallet) | C min 10, Pallet min 2 | C: unit 1 < 2 only (US3 #4) |
| A 5 exempt, A-v2 3 | A min 10 | A-v2: pieces 8 < 10; the exempt line none (US4 #7c) |
| A 5 exempt, A-v2 5 | A min 10 | none (US4 #7c) |
| A 5 (seeded 5, quote source cancelled ⇒ `exempt: false`) | A min 10 | A: pieces 5 < 10 (US4 #7e, FR-036) |
| B 96 (Pallet 64) | Pallet min 2 | B: unit 1.5 < 2 (edge case) |
| B 64 (deleted unit) | B min 10 | none — pieces 64 ≥ 10, no unit rule (edge case) |
| X 5, no record for X | — | X: `product_unavailable` (FR-037) |
| File rows A-red 4, A-blue 6 (preview, no cart) | A min 10 | none — file total 10 (US4 #1c) |
| File rows A-red 4, A-blue 3 (preview, no cart) | A min 10 | both rows: pieces 7 < 10 (US4 #1c) |
| Batch: Pallet 1 × C (64), C 3; cart empty | C min 10, Pallet min 2 | pass 1 rejects the pallet line (1 < 2); pass 2: C 3 < 10 rejects the piece line too |

## 7. Unchanged

`carts.source_quote_request_id`, `order_items.packaging_unit_snapshot`, `cart_items.packaging_unit_*`,
the revision snapshot lines of `quote_requests`, and every `returns` table. Return cases created before
this feature are never re-read for returnability (FR-022).
