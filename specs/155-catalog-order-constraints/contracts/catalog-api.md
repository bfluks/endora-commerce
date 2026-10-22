# Contract: catalogue — minimums, the returnable flag, the read port and the rule

All shapes are written in `packages/contracts/src/` **before** any service code (Principle II).
Every change is additive: new optional request keys, new response keys, new required fields on a
record that only `catalog` implements. Research: R1, R2, R6, R7, R9, R15, R16.

## 0. Range

`ORDER_MINIMUM_MAX = 1_000_000` and `isValidOrderMinimum(n)` (`packages/contracts/src/order-minimums.ts`).
Both minimums are integers in `1…ORDER_MINIMUM_MAX` or `null` (clear). Enforced by the request
schemas, by the services (for in-process callers such as `pim_pimcore` through `CatalogPackagingPort`),
and by the column `check` constraints. Out of range → `400 VALIDATION_FAILED` from a route schema
(the platform's Zod answer, `error-envelope.ts:219–248`); `422 VALIDATION_FAILED`,
`details.field = 'minOrderQuantity' | 'minOrderUnits'` from a service (in-process callers).

## 1. Admin product write — `PATCH /api/v1/admin/catalog/products/:id` (`catalog:write`, unchanged gate)

`updateProductRequestSchema` (`catalog.ts:671`, from `baseProductRequestObject` `:593`) gains:

```ts
/** Feature 155 — pieces; `null` clears. Simple / configurable only (else 422 VALIDATION_FAILED, details.field). */
minOrderQuantity: z.number().int().min(1).max(ORDER_MINIMUM_MAX).nullable().optional(),
/** Feature 155 — may `return`-kind cases include this product? Every type. */
returnable: z.boolean().optional(),
```

The create schema inherits both (a product may be created with them; the type rule applies on create
too). The admin product response (`serializeAdminProduct`, `catalog/src/backend/routes.admin.ts:1763`)
gains `minOrderQuantity: number | null` and `returnable: boolean`. Audit: both keys appear in the
Command's `before` / `after` (FR-005).

## 2. Bulk edit — `POST /api/v1/admin/catalog/products/bulk-update` (`catalog:write`)

`bulkUpdateFieldsObject` (`catalog.ts:718`) gains `returnable: z.boolean().optional()`; the
"at least one field" refine (`:747–756`) counts it. Per-product outcome unchanged in shape;
`changedFields` lists `returnable`. Same 200-per-request synchronous cap and queued path.

**Audit (FR-003).** Each product's change is written by the legacy `CatalogAdminService.updateProduct`
(`catalog-bulk-update.service.ts:274`) as one `product.update` audit row through `AuditPort.record`,
whose `stateBefore` / `stateAfter` carry `returnable`, plus the existing `product.bulk_update` summary
row. This path predates the Command Bus and stays on it (research R9); the queued path's undo restores
`returnable` through its generic column snapshot.

## 3. Packaging units — `/api/v1/admin/catalog/products/:productId/packaging-units[/:unitId]`

`createPackagingUnitRequestSchema` and `updatePackagingUnitRequestSchema` (both `.strict()`,
`catalog.ts:1571–1589`) gain:

```ts
/** Feature 155 — minimum number of this unit per order of the product; `null` clears. */
minOrderUnits: z.number().int().min(1).max(ORDER_MINIMUM_MAX).nullable().optional(),
```

`packagingUnitSchema` (`:1559`) gains `minOrderUnits: z.number().int().positive().nullable().optional()`
(always emitted by `catalog`; optional in the schema so the DTO type stays assignable for `pim_pimcore`
and older builders). `CatalogPackagingPort` (`:3049`) is unchanged in signature; its request and DTO
types widen, so `pim_pimcore`, which never sends the key, keeps working (FR-002). A port call with an
out-of-range `minOrderUnits` is refused by the service like the route refuses it (§0).

## 4. Storefront product DTOs

| Schema | File:line | New key |
| --- | --- | --- |
| `productDetailSchema` | `catalog.ts` (PDP) | `minOrderQuantity: z.number().int().positive().nullable().optional()` |
| `productDetailSchema.packagingUnits[]` | `catalog.ts:462` | `minOrderUnits: z.number().int().positive().nullable().optional()` |
| `productSummarySchema` | `catalog.ts:226` | `minOrderQuantity: z.number().int().positive().nullable().optional()` |
| `comparisonProductSummarySchema` | `comparisons.ts` | `minOrderQuantity: z.number().int().positive().nullable().optional()` |

`null` = no minimum. The value is emitted only for `simple` / `configurable` products (else `null`).
Producers: `catalog`'s query service (detail + list), `search`'s hit projection
(`search-query.service.ts:494`), `comparisons`' service. The returnable flag is **not** on any
storefront DTO: buyers learn returnability per order line (contracts/returns-api.md).

## 5. Read port — `CatalogProductReadPort` (container `catalogProductReadPort`, owner `catalog`)

```ts
export interface CatalogProductRecord {
  // …existing…
  /** Feature 155 — pieces minimum; `null` = none. Stored for any type, applied to simple/configurable only. */
  minOrderQuantity: number | null;
  /** Feature 155 — the product's current flag; order lines record their own copy at placement. */
  returnable: boolean;
}

export interface CatalogPackagingUnitRecord {
  // …existing…
  /** Feature 155 — minimum units of this packaging unit per order of the product; `null` = none. */
  minOrderUnits: number | null;
}

export interface CatalogProductReadPort {
  // …existing…
  /**
   * Feature 155 — the packaging units of the given products, ordered by product id, then
   * `position`, then `name`. The batch twin of `listVariantsByProductIds`. Unknown ids contribute
   * nothing.
   *
   * **No policy, like every method of this port: it answers for any id.** Callers MUST pass only
   * product ids they have already vetted — resolved through the buyer-visibility and channel checks
   * (`isProductVisibleTo`, the request-channel filter) or taken from a document the caller owns on the
   * buyer's behalf (their basket, quote request or order). Passing an id straight from a request body
   * turns this method into a catalogue enumeration oracle.
   */
  listPackagingUnitsByProductIds(productIds: readonly string[]): Promise<CatalogPackagingUnitRecord[]>;
}
```

Owner off: `catalog` is `nonDeactivatable`; the port's existing gate statement stands.

Consumers of the new method, and how each vets its ids:

| Consumer | Ids come from |
| --- | --- |
| `carts` add / edit / batch | lines that passed `#resolveLine` (visibility, channel, unit-in-product) plus the buyer's own basket |
| `carts` cart view, cart → quote | the buyer's own basket |
| `orders` placement, checkout preview | the buyer's own basket |
| `orders` admin preview | lines that passed the preview's not-found / not-visible / not-in-channel steps |
| `quote_requests` buyer writes | `#acquirableProductsById` (the existing 404 step) |
| `quote_requests` admin warnings | the request's stored lines (an operator read) |

All already declare `catalog` in `dependencies` — **no new lifecycle edge**.

## 6. The rule — `packages/contracts/src/order-minimums.ts` (new, exported from the barrel)

`ORDER_MINIMUM_MAX`, `isValidOrderMinimum`, `evaluateOrderMinimums(lines, rules)` and
`minimumRefusal(violations, names, keyName)`; the full signatures and the normative semantics are in
[data-model.md §5](../data-model.md) and research R6.1. Pure, synchronous, linear, no imports beyond
the record types and the error-code constants.

## 7. Errors owned by `catalog` (contracts/error-codes.md)

`PRODUCT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_MISMATCH` —
declared in `packages/modules/catalog/src/manifest.ts` `errorCodes`, sentences in
`packages/modules/catalog/i18n/{en,pl}.json`.
