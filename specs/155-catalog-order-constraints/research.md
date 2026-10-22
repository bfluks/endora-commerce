# Research: minimum order quantities and the returnable flag

**Feature**: `specs/155-catalog-order-constraints/` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Every decision below was taken against `origin/master` at `39b9b9989`. Paths are relative to the
repository root. Each entry is **decision → rationale → alternatives rejected**. Owner decisions are
cited by the spec's clarification ids (Q0–Q10, P1–P4 and the threat-model line of the 2026-10-15
session); everything else is a technical reading for the orchestrator to accept or send back
(§ *Coordinator rulings* at the end). Revised on 2026-10-15 after the analyze pass and the security
threat model: R6, R8, R9, R10, R11, R12, R14 and R17 changed; R19 (placement and the quote source)
and R20 (batch bounds) are new.

---

## R1 — Where the pieces minimum and the returnable flag are stored

**Decision.** Two first-class columns on `products`, owned by `catalog`:
`min_order_quantity integer null check (min_order_quantity between 1 and 1000000)` and
`returnable boolean not null default false`.

**Rationale.**
- `Product` already carries first-class per-product commerce flags beside its JSONB attribute bag —
  `manageStock`, `backorderEnabled`, `lowStockThreshold` (feature 010,
  `packages/modules/catalog/src/backend/entities/product.entity.ts:155–167`). These two are the same
  kind of fact: read by other modules on every order path, never per locale or channel.
- FR-003 requires the flag on **every** product whatever its attribute set. A custom attribute is
  refused outside the product's set (`catalog-admin.service.ts`, `assertAttributeValueKeysAllowed`),
  and the bulk edit drops a key not in a product's set (`catalog-bulk-update.service.ts:239–268`) —
  measured, so the attribute route cannot meet FR-003 without touching every set.
- `default false` is FR-004 (clarification P4). The migration needs no backfill: existing rows read `false`, which
  is the clarified answer — and the behaviour change FR-034 requires the docs and changeset to state.
- The `check` constraint makes the range a database fact (FR-001's upper bound, R9); the request
  schema and the service refuse the same values first.

**Alternatives rejected.**
- *Custom field / attribute value* (Constitution XIV) — refused outside the attribute set, invisible
  to the bulk edit for most products, and stored as untyped JSONB that four modules would then parse.
  XIV covers "add a field" for operator-defined data; these are platform rules with enforcement.
- *A `product_order_rules` side table* — one row per product for two scalars, a join on every
  product read, and nothing it holds that the row cannot.
- *A Setting* — minimums are per product, not per deployment.

## R2 — Where the packaging-unit minimum is stored

**Decision.** `product_packaging_units.min_order_units integer null check (min_order_units between 1
and 1000000)`, owned by `catalog`, in the same migration as R1.

**Rationale.** The minimum belongs to one unit, and a product may have several (spec Key Entities).
The unit table is catalog's (feature 043), its writes are already audited through the Command Bus
(`packaging-unit.service.ts:45–65`), and `CatalogPackagingPort` (`packages/contracts/src/catalog.ts:3049`,
also written by `pim_pimcore`) gains the field as **optional** so existing writers keep working
(FR-002).

**Alternatives rejected.** A JSON map on `products` keyed by unit id (orphaned keys when a unit is
deleted, no FK, no audit of the unit row); a column on cart lines (the rule is the catalogue's, not
the line's).

## R3 — Where "returnable at purchase" is recorded

**Decision.** `order_items.returnable_at_purchase boolean null`, owned by `orders`, written once in
`placeOrder` (`packages/modules/orders/src/backend/services/order-service.ts:1914`, the **only**
`OrderItem` creation site in the tree — `git grep "create(OrderItem"` finds no other) from the
product record placement loads once after the basket read (R19).

**Rationale.**
- FR-016a: the line snapshots the flag like it snapshots name, SKU and packaging
  (`order-item.entity.ts:20–39`). One write site covers every placement path (checkout, one-click,
  admin create, API intake, checkout of an accepted-quote basket), because all of them reach
  `placeOrder`.
- `null` means "placed before this feature" and is the value every existing row gets with no backfill;
  FR-025 turns `null` into "returnable" — **in `returns`**, not in `orders` (R14).
- **Fail-closed (FR-016a, P4).** Every new row is written with an explicit boolean:
  `product?.returnable === true`. A product record that is absent at placement records `false`.
  (R19 already refuses a basket line whose record is absent, whatever its type — plan D8 — before
  any line is written; the stamp's own fail-closed rule covers a record whose flag is missing, e.g.
  from a stub or an older producer, and a read that throws fails the transaction, so no line is ever
  written without a value.)
- `orders` gains no edge to `returns`: the value is written whether `returns` is on or off, so an
  order placed while `returns` is off answers correctly when it is switched back on (spec edge case
  *Module activation*).

**Alternatives rejected.**
- *Read the product's current flag at return time* — contradicts FR-016a.
- *A `returns`-owned table filled on `order.created.v1`* — a subscriber that is off while `returns`
  is off misses every order placed in between; the spec requires the value to be recorded then.
- *`not null default true`* — conflates "placed before the feature" with "returnable when placed".
- *`product?.returnable ?? null`* for an absent record — `null` means "returnable" (FR-025): the
  fail-open answer P4 rules out.

## R4 — The per-line "seeded from an accepted quote" state (FR-028)

**Decision.** The line's seeded quantity, stored once in `cart_items.agreed_quantity` (`carts`).
Written only by `replaceItemsForCustomer` (`packages/modules/carts/src/backend/services/cart-read-port.ts`)
when `options.sourceQuoteRequestId` is present, with the line's seeded quantity. A line is
**exempt** iff `cart.sourceQuoteRequestId !== null && item.quoteSeededQuantity !== null &&
item.quantity === item.quoteSeededQuantity`, where the record's `quoteSeededQuantity` is mapped from
`agreedQuantity`.

*Revision (2026-10-18, rebase onto master).* This feature first added its own column,
`cart_items.quote_seeded_quantity`. Master meanwhile added `agreed_quantity` (commit `7d2d00fcc`,
"price cart lines for their current quantity"), which holds an identical value on every row: it is
assigned in the same `replaceItemsForCustomer` branch from the same `line.quantity`, it is `null` on
every other line, and no other path writes it — `addItem`'s bump, `updateItem`, the login merge and
`repriceLinesForCustomer` change only `quantity` / `unitPrice` / `currency` and read the agreement
through `agreementOf`, while `clearForCustomer`, placement and a re-seed delete the row. Anonymous
baskets are never quote-seeded, so a line merged in at login carries `null` in both. Two columns that
cannot differ would be two places to keep in step, so this feature's column and migration were
removed and the exemption reads the agreement. One predicate, exported from `@endora-commerce/contracts`
(`isQuoteSeededLineExempt`) so `carts` and `orders` evaluate the identical rule.

**Rationale.**
- FR-028 as amended by P2: the exemption is **state-based** — exempt while the quantity equals
  the quote's; 5 → 12 → 5 is exempt again. Storing the seeded quantity is exactly that state; a
  sticky "changed" flag would contradict P2.
- Storing the quantity also ends the exemption by construction on every path that changes a quantity
  — `updateItem`, the bump in `addItem` (`cart-service.ts:303–306`), the login merge (`:617–624`), any
  path added later — with nothing to remember to clear. A boolean flag is fail-open.
- A reorder seeds through the same method with no source (`order-reorder-service.ts:133`), so its
  lines get `null` and are checked (US4 #4). A later seed deletes every row (`cart-read-port.ts:91`),
  so exemptions never survive it.
- Seeded lines carry no packaging (`rfq-service.ts:933–942`), so they count toward the pieces minimum
  only (spec edge case).
- **Face value at add, edit and view; vouched at preview and placement.** `carts` judges only the
  mark and the per-line state (FR-028: "Add, edit and the cart read model take the basket's quote mark
  at face value"). Whether the quote source is still valid is decided by `orders` (R19, FR-036).

**Alternatives rejected.** A boolean `seeded_from_quote` cleared by every writer (fail-open, and
contradicts P2); a per-basket rule (Q1 rejects it); reading the quote's lines at every cart check
through `quoteRequestReadPort` (a cross-module read on the hottest buyer path, and wrong when two lines
of one product exist).

## R5 — A packaging-unit id on stored quote-request lines

**Decision.** `quote_request_items.packaging_unit_id uuid null`, owned by `quote_requests`, no FK
(the cart precedent: `cart_items.packaging_unit_id` has none, and units are hard-deleted,
`product-packaging-unit.entity.ts:12–15`). Written by `createForCustomer` and `patchDraft` from the
FR-026 resolution, carried by admin `modify` with the stored snapshot (`rfq-admin-service.ts:565–566`),
dropped by `resubmit` exactly as name and base quantity are today (out of scope).

**Rationale.** FR-030 needs the line's **current** unit minimum at read time, and FR-031(b)'s pairing
needs a stable identity once a line names its unit by id. A unit may be renamed after the line was
written; re-matching by name and base quantity would then lose the warning silently.

**Alternatives rejected.** Re-matching name + base quantity at read (above); storing the minimum on
the line (the warning must reflect the *current* minimum, FR-030).

## R6 — Where the minimum rule is evaluated

**Decision.** One **pure function** in `@endora-commerce/contracts`, new file
`packages/contracts/src/order-minimums.ts`: `evaluateOrderMinimums(lines, rules)` → per-line
violations. Each consumer fetches the records through ports it already resolves and calls it:
`carts` (add, edit, batch add, cart view), `orders` (placement, checkout preview, admin preview),
`quote_requests` (buyer writes, admin warnings), `quick_order` (import preview). The rule data comes
from `CatalogProductRecord.minOrderQuantity` and `CatalogPackagingUnitRecord.minOrderUnits` (R7). The
same file exports the range constant `ORDER_MINIMUM_MAX = 1_000_000` and `isValidOrderMinimum(n)`
(R9).

**Rationale.**
- FR-006a's rule (product total across lines and variants, unit count per unit, independent checks,
  exempt lines counted but not refused) must have **one** implementation, or the cart, the checkout
  and the quote request will disagree on an edge (a deleted unit, a fractional unit count).
- The precedent is exact: `isProductVisibleTo` (`packages/contracts/src/catalog.ts:2013`) is a pure
  rule over the record shape in contracts, imported by `carts`, `orders` and others.
- Synchronous and I/O-free: unit-tested exhaustively in `packages/contracts`, no mocking.
- `catalog` is `nonDeactivatable` (`packages/modules/catalog/src/manifest.ts:346`), so a gated port
  would buy no off-state behaviour that the read port does not already give.

**Alternatives rejected.**
- *A `catalog` port `assess(lines)`* — a second port and a round trip per evaluation for a
  computation over data the consumers already hold.
- *Four per-module implementations* — four answers to FR-006a waiting to disagree.

### R6.1 — The rule, as the function implements it

- **Fail-closed on a missing record (FR-037).** A line whose `productId` has no record in
  `rules.products` gets a `product_unavailable` violation (no minimum, no name) and contributes
  nothing to any total. A consumer therefore cannot "forget" FR-037: an absent record is a violation
  by construction, never "no minimum". Writes map it to the unknown-product answer (`404
  PRODUCT_NOT_FOUND`, never naming the product); read models flag the line as blocking (R11, R19).
- Applies the minimums only to products whose `type` is `simple` or `configurable` (spec edge case
  *Product types*); a minimum stored on any other type is ignored by the function and refused at save
  (R9). A record of another type is present, so it is **not** `product_unavailable`.
- **One scope.** Totals are per product over every line passed in. The earlier `group` input (one
  group per import row) is **dropped**: P1 makes the import preview judge the product's total across
  the whole file, which is the default scope, so `group` has no remaining user (YAGNI).
- **Pieces.** `total = Σ quantity` over every line of the product (single-piece and packaging lines,
  all variants, **exempt lines included**). If `minOrderQuantity > 1` and `total < minOrderQuantity`,
  every **non-exempt** line of that product gets a `pieces` violation.
- **Packaging unit.** For each line naming a `packagingUnitId` that resolves to a **current** unit of
  that product with `minOrderUnits` set: `units = Σ quantity ÷ baseQuantity` over the product's lines
  in that unit, where `baseQuantity` is the line's own snapshot when it has one (spec Assumption) else
  the unit's current value (D6). If `units < minOrderUnits` (a real-number comparison: 96 pieces on a
  64-piece pallet is 1.5 < 2), every non-exempt line in that unit gets a `packaging_unit` violation. A
  unit that no longer exists contributes no unit rule; its lines still count toward pieces.
- A line may carry both violations. Callers that must name one code report **pieces first**, then
  the unit (R10).
- **Complexity.** One pass to index records and units by id, one pass to accumulate per-product and
  per-(product, unit) totals in `Map`s, one pass to emit violations: `O(lines + products + units)`.
  No nested scan over lines. Pinned by a performance case at the import ceiling (R20).
- Output is deterministic (input line order), so tests and error details are stable.

## R7 — How consumers read the rule data

**Decision.**
- `CatalogProductRecord` gains `minOrderQuantity: number | null` and `returnable: boolean`;
  `CatalogPackagingUnitRecord` gains `minOrderUnits: number | null` (required fields — `catalog` is
  the only implementer, `catalog-product-read.service.ts:35`).
- `CatalogProductReadPort` gains `listPackagingUnitsByProductIds(productIds)` — the batch twin of the
  existing `listVariantsByProductIds`, read-only, ordered by product then position.
- **The port applies no policy, and its doc says so (threat F12).** Like every method of this
  row-level port it answers for any id it is given, whatever the caller may see. Its doc comment and
  `contracts/catalog-api.md` §5 state the obligation: *callers pass only product ids they have already
  vetted* — resolved through the buyer-visibility and channel checks (`isProductVisibleTo`,
  `outOfRequestChannel` / `productIdsInRequestChannel`) or taken from a document the caller owns (the
  buyer's own basket, quote request or order). Every consumer listed in `contracts/catalog-api.md` §5
  meets it; R8, R13.2 and R19 say where.

**Rationale.** The evaluator needs the units of every product on the lines, and FR-026's name-only
match needs a product's unit *list*. A batch read on the row-level port is the shape the port
already has for variants. Measured cost of the port change: **5** typed literal stubs in 3 test files
(`git grep ": CatalogProductReadPort = {"` — `backend/test/integration/promotions/attribute-criterion-resolution.test.ts`,
`backend/test/unit/comparisons/cross-module-ports.test.ts`,
`backend/test/unit/comparisons/viewer-priced-columns.test.ts`); the record fields touch **7** record
literals (`git grep -l "lowStockThresholdMode: 'cumulative'"` in test files). Both are one task in
the read-port phase (T026).

**Alternatives rejected.**
- *`CatalogPackagingPort.list(productId)`* — the **admin write** surface published for `pim_pimcore`;
  resolving it puts create/update/delete in `quote_requests`' reach, it is per product, and it 404s on
  a missing product.
- *`findPackagingUnitInProduct` once per distinct unit id* — cannot answer "does this product have a
  unit named X with base quantity N" (FR-026).
- *A visibility-filtering variant of the method* — the port is row-level by design (`cart-service.ts`
  issue #227 comment); a second policy home would drift from `isProductVisibleTo`.
- *Optional record fields* — every consumer would then have to treat `undefined` as "no minimum" and
  "not returnable", a second default living outside the catalogue.

## R8 — Batch paths into the cart: resolve, judge as a whole, then add

**Finding.** Every batch path calls `addItem` once per line (quick-order build
`quick-order-build-service.ts:54–71`, shopping list → cart `shopping-list-service.ts:314–337`, quote →
cart `cart-conversion-service.ts:203–243`, admin create `order-creation-admin-service.ts:179–186`, API
intake `order-api-intake-service.ts:296–299`). With product A (minimum 10) sent as A-red × 5 and
A-blue × 5, a per-line check sees 5 on the first add and refuses it, although FR-006a (product total
across variants) says the batch is valid.

**Decision.** `CartWritePort` gains `addItems(actor, lines, options)`, implemented by
`CartService.addItems` in three steps:

1. **Resolve every line first, with exactly `addItem`'s preconditions (threat F1, FR-035).** `addItem`'s
   checks (`cart-service.ts:221–289`: quantity ≥ 1, `findById`, `isProductVisibleTo(product,
   cartAudience(actor))`, channel membership — `input.salesChannelId` or the request channel —, and
   `findPackagingUnitInProduct`) move into one private `#resolveLine(actor, input)` that **both**
   `addItem` and `addItems` call, so the two can never drift. A line that fails resolution gets the
   same answer as an unknown id — `404 PRODUCT_NOT_FOUND` (or `404 PACKAGING_UNIT_NOT_FOUND`) — and
   never a name or a minimum. Unresolved lines take no part in step 2 (they count toward no total).
2. **Judge the resolved lines together with the cart, once (two bounded passes, threat F4).** The
   prospective basket is the cart's lines (with their FR-028 exemptions) plus every resolved batch
   line. Pass 1 runs `evaluateOrderMinimums` and rejects every batch line carrying a
   `packaging_unit` violation. Pass 2 re-runs it without those lines and rejects every surviving batch
   line carrying a `pieces` violation. This is the old fix-point's exact answer in exactly two passes:
   rejecting a unit line can lower its product's pieces total (hence pass 2), but rejecting on pieces
   rejects every batch line of that product, so it cannot create a new unit violation on a line that
   stays, and products never couple. Each pass is linear (R6.1). Existing cart lines are **never**
   rejected — the read model flags them (FR-013) and placement refuses them (FR-008).
3. **Add the accepted lines** through the same internal write as `addItem`, the minimum already
   decided (line cap, quote-only and pricing refusals unchanged).

Per-line outcomes are returned in input order: `added`, `below_minimum` (with `kind`, `minimum`,
`productName`, and the unit name when it is one), or `failed` (the `HttpError` the line met).
`options.onLineError: 'throw' | 'report'` keeps each caller's tolerance for non-minimum refusals:
- `'throw'` (quick-order build, admin create, API intake): the **first
  resolution failure is thrown before anything is written** — a change from today, where quick order
  partially adds before the 404 (stated in the `mod-carts` and `mod-quick-order` changesets; it can
  only make the batch more atomic). A step-3 failure is thrown as today, earlier accepted lines
  staying added.
- `'report'` (quote → cart, shopping list → cart): every failure becomes `failed`; each caller maps
  it (R12.4, R12.5).
`ModuleDisabledError` is always rethrown first (`rethrowIfModuleDisabled`, module-composition item 7).

Admin create and API intake use `addItems(…, { onLineError: 'throw' })` on their transient basket and
refuse the whole request when any line is `below_minimum` (US4 #6), with the minimum code of the first
and every offending line in `details.lines` (R10).

**Rationale.** Matches the product-total rule on every batch path, keeps one evaluation per batch
instead of one per line, makes a hidden product indistinguishable from an unknown id on every batch
path (FR-035), and bounds the work (FR-038, R20).

**Consequence, stated.** A batch line that passes the minimum evaluation and then fails in step 3
(quote-only, line cap) is not added, so its product's total may end below the minimum. The remaining
lines are then flagged in the cart and refused at checkout (FR-008); nothing below a minimum can be
placed (SC-001).

**Alternatives rejected.**
- *Per-line check against cart + that line* — refuses valid batches (above).
- *An iterate-until-stable fix-point* — the first plan's choice; correct but up to *n* rounds over *n*
  lines (quadratic on a 200-line batch) for an answer two passes give.
- *Evaluate before resolving* — a hidden product's minimum would decide its outcome
  (`below_minimum` + name + minimum): the disclosure threat F1 names.
- *Skip the check on batch paths and rely on checkout* — FR-011 requires the per-line report.

## R9 — Admin writes, validation, range and audit

**Decision.**
- `updateProductRequestSchema` (and the create schema, which inherits it) gains
  `minOrderQuantity: int 1…1 000 000 | null` (optional) and `returnable: boolean` (optional).
  `createPackagingUnitRequestSchema` / `updatePackagingUnitRequestSchema` (both `.strict()`,
  `catalog.ts:1571–1589`) gain `minOrderUnits: int 1…1 000 000 | null` (optional).
- **The range is enforced in the services as well as in Zod (FR-001, FR-002, threat F5).**
  `PackagingUnitService.create` / `update` (`packaging-unit.service.ts:78–130`) do not parse their
  input — `CatalogPackagingPort` callers such as `pim_pimcore` reach them without a route schema — so
  both call `isValidOrderMinimum` (R6) and refuse `422 VALIDATION_FAILED` with
  `details.field = 'minOrderUnits'`. `#applyProductUpdate` (`catalog-admin.service.ts:520`) and the
  product create path do the same for `minOrderQuantity`. The column `check` constraints (R1, R2) are
  the last line. **Why 1 000 000:** above any realistic B2B order of one product, and
  `1 000 000 × the 200-line cart cap` stays far below `2^31`, so no total in R6.1 can overflow the
  `integer` columns or lose precision in JavaScript.
- `#applyProductUpdate` sets both fields and pushes them to `changedFields`; **`stateBefore` /
  `stateAfter` gain both keys** — today they omit even the feature 010 flags (`:556–566`,
  `:679–688`), so without this FR-005's audit would record "changed" with no values.
  `PackagingUnitService` writes `minOrderUnits` into its `before` / `after` (`:103`, `:116`, `:130`).
- A non-null `minOrderQuantity` on a product whose type is not `simple` / `configurable` is refused
  `422 VALIDATION_FAILED` with `details: { field: 'minOrderQuantity' }` — on **update and create**
  (D5). Packaging units already refuse those types (`PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE`).
- **Bulk edit (FR-003).** `bulkUpdateFieldsObject` (`catalog.ts:718`) gains `returnable: boolean`
  (optional), the refine counts it, and `applyToOneProduct` (`catalog-bulk-update.service.ts:184`)
  passes it in the partial like `status`; the "nothing else to do" skip condition (`:253–260`) counts
  it. The bulk edit does **not** gain the minimum (FR-003 asks for the flag only; YAGNI).
- **How each write is audited — measured, not assumed (Principle XIII).**
  - Single product PATCH: `updateProductAudited` → `CommandBus.run` (`catalog-admin.service.ts:464–501`),
    `before` / `after` from `#applyProductUpdate`.
  - Packaging units: the service's `#audited` → `CommandBus.run`.
  - **Bulk edit (synchronous and queued)**: `applyToOneProduct` calls the **legacy**
    `catalogAdmin.updateProduct(id, partial, auditCtx)` (`catalog-bulk-update.service.ts:274`), which
    writes one `product.update` row per product through `AuditPort.record` with `stateBefore` /
    `stateAfter` from the same `#applyProductUpdate` (`catalog-admin.service.ts:387–410`), plus one
    `product.bulk_update` summary row (`:431–457`). The route passes the request's audit context
    (`routes.admin.ts:350`); the queued path passes `{ actorAdminUserId }`
    (`bulk-operation.service.ts:363–365`). This path predates the Command Bus and is **not** routed
    through it today; this feature adds a field to it and does not migrate it (scope). FR-003's
    "audited per product" is met by those per-product rows, whose `before` / `after` carry
    `returnable` once `#applyProductUpdate` does (T028 asserts it, sync and queued). The queued
    path's undo (`revertibleFieldKeys` / `pickProductFields`, `bulk-operation.service.ts:670–690`)
    restores direct product columns generically, so `returnable` is undoable with no change.

**Alternatives rejected.** A new endpoint for "order rules" (the product PATCH already carries
per-product flags); bulk minimum (not requested); migrating the bulk path onto `updateProductAudited`
here (it changes the audit shape of every bulk field — a feature of its own; recorded in plan
§ *Deferred defects*); a range only in Zod (`CatalogPackagingPort` bypasses it).

## R10 — Error codes and what each refusal names

**Decision.** Four minted codes, owned by the module whose **noun** they name (the rule the catalogue
manifest records for `PACKAGING_UNIT_NOT_FOUND`, which `carts` raises and `catalog` owns —
`packages/modules/catalog/src/manifest.ts:410–418`, D-121 T1):

| Code | HTTP | Owner | Raised by | Details (top level) |
| --- | --- | --- | --- | --- |
| `PRODUCT_BELOW_MINIMUM_QUANTITY` | 422 | `catalog` | `carts` (add, edit), `orders` (placement, admin create, API intake), `quote_requests` (buyer writes) | `{ productId, productName, minimum, total, lines? }` |
| `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` | 422 | `catalog` | same | `{ productId, productName, packagingUnitId, packagingUnitName, minimum, units, lines? }` |
| `PACKAGING_UNIT_MISMATCH` | 422 | `catalog` | `quote_requests` (FR-026) | `{ lineNumber, productName, lines: [{ index, productId, productName, reason }] }` |
| `RETURN_LINE_NOT_RETURNABLE` | 422 | `returns` | `returns` (`createCase`, kind `return`) | `{ productName, orderItemIds, lines: [{ orderItemId, productName }] }` |

- Single-line refusals (cart add, cart edit) carry the code of the touched line's first violation
  (pieces before unit, R6.1).
- Multi-line refusals (placement, admin create, API intake, quote-request writes) carry the code of
  the **first** offending line and list **every** offending line in `details.lines`. **One line shape
  everywhere (analyze F11):** `{ <key>, productId, productName, kind, minimum, packagingUnitName? }`,
  where `<key>` is `cartItemId` (placement), `index` (quote-request writes, admin create, API intake).
  The first line's `productName` / `minimum` / `packagingUnitName` are also top-level, which is what
  the bundle sentence interpolates.
- **Every sentence names the product (SC-004, analyze F12).** The two minimum codes name the product
  and the minimum. `PACKAGING_UNIT_MISMATCH` names the first failing line's number and product;
  `RETURN_LINE_NOT_RETURNABLE` names the first non-returnable line's product (from
  `OrderReturnContextLine.name`). Neither has a minimum to name: SC-004's "and the minimum" can only
  apply to the minimum refusals — flagged for the product owner (plan § *Open for the owner*).
- Names are resolved by the raiser in the request's language from the records it already holds, and
  only for products that passed the visibility checks (FR-035) — a `product_unavailable` violation
  never reaches a minimum code.
- **`PACKAGING_UNIT_MISMATCH.details.lines[].reason` (threat F6, FR-026):** `unknown_unit` for
  **every** failure of a `packagingUnitId` — unknown, deleted, or a unit of another product — so the
  answer never tells whether an id exists elsewhere in the catalogue (the cart's single
  `PACKAGING_UNIT_NOT_FOUND` precedent). Detail (which of the three) goes to the server log only. The
  name path keeps `name_unknown` and `base_quantity_mismatch`: they describe units of the line's own
  product, which passed the 404 first and whose units are public on `productDetailSchema.packagingUnits[]`
  — nothing is disclosed that the product page does not show, and the buyer learns which half to fix.
- Each code lands in **one commit** with its `ERROR_CODES` member, its `MINTED_ERROR_CODES` entry
  (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `to` = owner), the owner's manifest
  `errorCodes` declaration, `errors.<CODE>` in the owner's `i18n/en.json` and `pl.json`, and the
  `composer:generate` output with any moved module-reference page and its Polish cache entry and mirror.

**Alternatives rejected.**
- *Module-prefixed codes per raiser* (`CART_…`, `RFQ_…`, `ORDER_…`) — six codes for two meanings.
- *`VALIDATION_FAILED` + `details.code`* — the envelope never replaces that code's message (issue #86,
  `cart-service.ts:215–220`); FR-006 asks for a translated message.
- *Reusing `PACKAGING_UNIT_NOT_FOUND`* for FR-026 — it is a 404 and FR-026 is a 422 naming the line.
- *Reusing `MIN_NOT_MET`* — it is the bundle-slot rule (`errors.ts`, *Catalog 002 US5*).
- *Distinct `unit_of_another_product`* — the enumeration oracle F6 names.

## R11 — Cart: single add, edit, read model

**Decision.**
- `addItem` (`cart-service.ts:192`): `#resolveLine` (R8) first, unchanged in behaviour; then the
  minimum check, **before** `#resolveLineUnitPrice` (`:319`), so the existing 404s keep precedence
  (spec *Order of checks*) and a refusal costs no `price_lists` call. Prospective lines = the cart's
  lines with the incoming delta applied (bump of the matching line, `:297–302`, or a new line). Refuse
  when the touched line carries a violation.
- `updateItem` (`:443`): `quantity <= 0` still removes unconditionally (FR-007); otherwise the same
  prospective evaluation with the line's new quantity; refusal leaves the line unchanged. `updateItem`
  reads no catalogue today — it now reads the products and units of the edited line's product. A
  missing record → the line's `product_unavailable` violation → `404 PRODUCT_NOT_FOUND` (FR-037).
- `removeItem` never checks (FR-007, US2 #7).
- Login merge (`:584`) is unchanged: it only sums; a merge into a seeded line changes its quantity, so
  R4 judges it normally while it differs. The pre-existing packaging-blind merge is out of scope.
- Cart full view (`GET /api/v1/cart`, `routes.ts:176–301`): each `cartViewLine` gains
  `belowMinimum` (`null` or `{ kind, minimum, packagingUnitName? }`) and `minOrderQuantity`. The mini
  view is unchanged (hot path, `routes.ts:191–199`). The evaluation runs on the product records the
  view already loads (`loadProductMeta`, `:214`) plus one `listPackagingUnitsByProductIds`. A line
  whose product record is absent (`product_unavailable`, FR-037) is reported through the **existing**
  vocabulary — `unavailable: true`, `unavailableReason: 'not_purchasable'` (declared in
  `cartLineUnavailableReasonSchema`, emitted as `null` everywhere today, `routes.ts:733`) — with
  `belowMinimum: null`; the storefront already has to render `unavailable`.
- **D7 — the view fails when the catalogue read fails.** The evaluation is **not** wrapped in the
  view's tolerant `catch` (`routes.ts:212–222` swallows a `loadProductMeta` failure into an empty map):
  hiding a below-minimum flag behind an empty map is the fail-open answer FR-037 rules out. A catalogue
  read failure therefore answers `5xx` on `GET /api/v1/cart` instead of a cart without flags
  (`ModuleDisabledError` cannot occur — `catalog` is `nonDeactivatable`). Recorded as plan deviation
  D7.

## R12 — Quick order, shopping list, one-click

### R12.1 Import preview (FR-011 (a), P1)

`QuickOrderImportPipeline` merges duplicate `(product, variant)` rows (`import-pipeline.ts:252–281`,
`mergedFromLines`). After the merge, **all recognised rows of the file are evaluated together** —
one `evaluateOrderMinimums` call, pieces only (import rows carry no packaging unit), no cart lines —
so the product's total is the sum over every row and every variant of that product in the file
(clarification P1 A). Rows already rejected for an existing reason (unknown SKU, not visible to the buyer,
…) are not in the recognised set and count toward no total (FR-035). Then, per audience:

- **Buyer's import** (`POST /api/v1/quick-order/import`): every row of a product whose file total is
  below its pieces minimum moves from `recognized` to `rejected` with the new reason
  `below_minimum`, its `minimum` and its `productName`; `summary` counts follow.
- **Operator's import** (`POST /api/v1/admin/quick-order/import`, P1 C): such a row **stays in
  `recognized`** (buildable) and carries `warning: { reason: 'below_minimum', minimum }`; the summary
  gains `warningCount`. The operator's import runs with `audience: 'unrestricted'`
  (`routes.admin.ts:85`) because the customer is named only at build time; customer visibility and
  channel are therefore judged at the build (R12.2), not the preview. A build to `quote_request`
  creates the request with the FR-030 warning; a build to `cart` still rejects the line (R12.2).

The preview never reads the cart, so preview and build can differ (spec edge case *Quick order, both
reports*, US4 #1b).

### R12.2 Build (FR-011 (b), FR-038)

The build refuses more than `QUICK_ORDER_BUILD_MAX_ITEMS` (= 200) items first (R20). Target
`cart` → `cartWrite.addItems(…, { onLineError: 'throw' })`; the response gains
`rejected: [{ productId, variantId, quantity, productName, reason: 'below_minimum', kind, minimum }]`.
Target `quote_request` → one request, FR-012 governs (R13). The operator route
(`routes.admin.ts:90–120`) passes `actor: 'operator'` to the build service, which forwards
`minimums: 'warn'` on the quote-request target only; a build to `cart` on the customer's behalf is
judged like the buyer's (spec US4 #1d).

### R12.3 One-click (FR-010)

`one-click-service.ts` `place`: `quantity = input.quantity ?? defaultOneClickQuantity(product)` where
the helper answers `product.minOrderQuantity` **only for `simple` / `configurable`** with a minimum
> 1, else 1 — the same type filter R6.1 applies (analyze F14), so a stored minimum on another type
never inflates a one-click order. The product is read through `catalogProductReadPort` (`quick_order`
already declares `catalog`); `OneClickService` gains it as a constructor argument. An explicit
`input.quantity` below the minimum is refused by `addItem` as for any add.

### R12.4 Shopping list → cart (FR-011)

`convertToCart` uses `addItems(…, { onLineError: 'report' })` and maps the outcomes:
`below_minimum` → a skip with the new reason `below_minimum` and `minimum`; a `failed` **404** (the
product is hidden from the buyer, out of the channel, or its unit is gone) → a skip `product_not_found`,
exactly what `#partitionByProductStatus` already reports for a deleted product
(`shopping-list-service.ts:322`), so a hidden product is indistinguishable from an unknown one
(FR-035, threat F1); any other `failed` is rethrown, as `addItem` threw it before. `'throw'` would
abort the whole conversion on a hidden product while a deleted one is skipped — the distinction F1
names. `convertToRfq` is one request (R13).

### R12.5 Quote request → cart (FR-011, US4 #8, FR-035)

`createCartFromQuoteRequest` uses `addItems(…, { onLineError: 'report' })`:
- `below_minimum` → `droppedLines[].reason = 'below_minimum'` with `minimum`;
- `failed` with a `404` (the product is no longer visible to the buyer or not in the channel) →
  `not_purchasable` — the reason the conversion already gives an unknown or out-of-channel product
  (`cart-conversion-service.ts:195–202`); today such a line is reported as
  `no_price_in_customer_list` (`:233–240`), which F1 names;
- any other `failed` keeps `no_price_in_customer_list`.
The line's `productName` comes from the buyer's own quote request, never from the catalogue.

## R13 — Quote requests

### R13.1 Packaging on a buyer line (FR-026, FR-027)

`createQuoteRequestLineSchema` (`quote-requests.ts:422`) gains `packagingUnitId: uuid` (optional).
A pure resolver in `quote_requests` (`services/packaging-resolution.ts`) takes the lines and the units
from `listPackagingUnitsByProductIds` — called only with the product ids `#acquirableProductsById`
already vetted (R7):
- id given → must be a unit of that line's product, else `unknown_unit` (one reason for unknown,
  deleted and another product's unit, R10); the stored name and base quantity are the catalogue's;
- no id, name given → must match a unit of the product by name **and** base quantity, else
  `name_unknown` / `base_quantity_mismatch`;
- neither → plain pieces.
Any failure → `422 PACKAGING_UNIT_MISMATCH` listing every failing line; nothing written.

**Behaviour change for existing rows, stated.** A `Pending` request stored before this feature with a
free-form label, or with a unit renamed since, is refused on every draft edit that re-sends that
label (spec-conformant: FR-026 applies to draft edits). The `mod-quote-requests` changeset says so.

Cart → quote (`convertToQuoteRequest`, `cart-conversion-service.ts:107–132`) sends the cart line's
`packagingUnitId` **only** when the unit still exists (one `listPackagingUnitsByProductIds` over the
buyer's own cart lines), otherwise the line goes as plain pieces with its piece quantity unchanged
(FR-026). It stops sending name and base quantity: the id wins anyway.

### R13.2 Where the checks sit (FR-029)

- `createForCustomer` (`rfq-service.ts:309`): after `#acquirableProductsById` and its 404
  (`:327–337`), **before** `resolveReferencePrices` (`:344`). The price-proposal check (`:326`) keeps
  its place. Order: packaging resolution, then minimums.
- `patchDraft` (`:444`): after the product 404 (`:481–486`) and the pairing (`:493–501`), before
  pricing (`:513`). Pairing receives the **resolved** packaging name, so an id-only line pairs with a
  stored row of the same unit.
- `resubmit` (`:630`): after the channel 404 (`:653–659`), before pricing (`:667`); pieces only, no
  exemption (FR-031 (c)).
- `acceptRevision` / `respondToRevision`: no check (FR-031 (a)).

### R13.3 Unchanged lines on a draft edit (FR-031 (b))

A line is exempt when `pairLines` pairs it with a stored row **and**
`referenceInputsUnchanged(row, line)` holds (`line-carry-over.ts`, used at `rfq-service.ts:508–511`) —
which compares product, variant, quantity, packaging name and base quantity: exactly the spec's
"same product, variant, packaging and quantity". Exempt lines count toward their product's total.

### R13.4 The actor rule (FR-012, FR-030, Q3, Q10)

`CreateForCustomerOptions` (`quote-requests.ts:797`) gains `minimums?: 'enforce' | 'warn'`, default
`'enforce'`. In-process only — the route parses its body with `createQuoteRequestSchema`, which has no
such key and strips it. Set to `'warn'` by the two admin call sites that reach the buyer's
`createForCustomer`: the admin clone-to-quote route (`orders/src/backend/routes.ts:1292–1304`) through
an `actor` argument on `OrderCloneToQuoteService.clone`, and the admin quick-order build
(`quick_order/src/backend/routes.admin.ts:90–120`). `createOnBehalf` and `modify` never check
minimums. The buyer clone route (`routes.ts:1306–1318`) enforces (Q10). Packaging validation (R13.1)
applies whatever the actor.

### R13.5 Admin warnings (FR-030)

The admin detail serialisation (`serializeFull(…, true)`) evaluates the request's lines with no
exemption and sets per item `minimumWarning: null | { kind, minimum, packagingUnitName? }`. The
customer serialisation is an allow-list since feature 146 (T7) and does **not** gain the key; a
contract test pins its absence. Strings go to the **core** bundle
(`packages/modules/_i18n/i18n/{en,pl}.json`, `rfq.detail.*`), because `RfqDetail` reads
`useTranslation('core')` (146 Phase 9 outcome).

## R14 — Returns (FR-016a – FR-022, FR-025, FR-033)

- `OrderReturnContextLine` (`packages/contracts/src/returns.ts:580`) gains
  `returnableAtPurchase: boolean | null` — the raw recorded value. `orders` reports the fact;
  **`returns` owns the policy** that `null` means returnable (FR-025).
- `returnableLineSchema` gains `returnable: boolean` and `notReturnableReason: 'product_not_returnable'`
  (optional). `returnableResponseSchema.reason` gains `no_returnable_lines`, used with
  `eligible: false` only when the order-level rules pass and no line is returnable — and it is the
  one reason that **does not** block a complaint: the storefront offers the complaint form for it
  (FR-018). **The meaning of `eligible` changes (analyze F13):** it now answers "can a `return`-kind
  case be opened?", not "can any case be opened?"; with `no_returnable_lines` a complaint is still
  possible. The `mod-returns` changeset and the returns docs say so for API consumers. The server
  never blocked complaints on `eligible` (`createCase` checks the completing status and per-line
  quantities only, `return-case-service.ts:83–140`).
- `createCase`:
  - **FR-033 (threat F7, P3) — aggregate, do not refuse duplicates.** Requested quantities are summed
    per `orderItemId` before the remaining-quantity check, for both kinds; a sum above the remaining
    quantity is refused with the existing `422 VALIDATION_FAILED` + `details.code =
    'qty_exceeds_returnable'` (no new code), and no case is created. The case's lines are stored **as
    sent**: each request entry carries its own `reasonId` and `description`
    (`createReturnCaseRequestSchema`, `returns.ts:205–220`), so "2 damaged + 2 wrong colour" of one
    four-piece line is a legitimate request that refusing duplicates would break and merging the
    stored lines would flatten. 3 + 3 against 4 remaining → refused; 2 + 2 → accepted as 4.
  - For `kind === 'return'`, any requested line whose resolved returnability is `false` →
    `422 RETURN_LINE_NOT_RETURNABLE` naming each such line once (deduplicated by `orderItemId`);
    nothing created (FR-019). Kind `complaint` is never checked (FR-020). Existing cases are never
    re-evaluated (FR-022).
- Placement's fail-closed stamp (R3) is what makes US6 #9 hold.

**Alternatives rejected.** For FR-018's shape, a second order-level flag (`returnEligible`) beside
`eligible` — two booleans whose combinations a client must interpret. For FR-033, refusing a request
that names a line twice — breaks per-entry reasons (above).

## R15 — Storefront

- PDP (`storefront/components/ProductBuyActions.tsx`): the quantity input's `min` and initial value are
  the pieces minimum, or the selected unit's `minOrderUnits` when a unit is selected; the minimum is
  stated beside the input, with the resulting pieces for a unit (US2 #2). Data: `productDetailSchema`
  gains `minOrderQuantity` and `packagingUnits[].minOrderUnits` (both optional/nullable, additive).
- Product card / comparison (FR-016): `productSummarySchema` gains `minOrderQuantity` (optional); it
  is produced by `catalog`'s query service **and** by `search`'s projection
  (`packages/modules/search/src/backend/services/search-query.service.ts:481–494`), both from the
  record. `comparisonProductSummarySchema` gains the same field. Optional, so a producer that omits it
  degrades to "add 1", which the API then refuses with a translated message — never a silent bypass.
- Cart page (FR-015): renders `belowMinimum` and floors the line input at `minOrderQuantity`;
  refusals already reach the buyer through `/cart?error=…` (`cart/page.tsx:215–217`).
- Checkout (FR-008): `orderPreviewTotalResponseSchema` gains `belowMinimumLines` (empty when none);
  the checkout page shows them and disables placement.
- Quick order (FR-011): the buyer's preview shows `below_minimum` rows as rejected "below the minimum
  — the product's total in this file is N, minimum M" (file-total wording, P1).
- Quote-request draft (FR-032): the draft is `localStorage`-only (`storefront/lib/rfqDraft.ts`) and
  holds product id, slug, name, price and quantity. US4 #14 ("added before the minimum was set … shown
  below the minimum") rules out carrying the minimum on the draft line alone, so the draft page reads
  the **current** minimum at render through a server action that fetches the existing public product
  detail per distinct slug with bounded concurrency (the `getResolvedPricesBulk` pattern,
  `storefront/lib/api/pricing.ts:110–137`). No new public route.
- Returns form and order detail (FR-021): per-line "not returnable" with a translated reason;
  `no_returnable_lines` hides the return option and keeps the complaint. The strings this feature
  touches move into `storefront/lib/i18n/messages.ts` (its `Record` is total, so a missing Polish
  string is a `tsc` error).

**Alternative rejected for the draft.** A new public batch endpoint `GET /api/v1/catalog/products?ids=`
— new public surface, OpenAPI baseline growth and a new visibility seam for one screen.

## R16 — Admin

- Product editor, Inventory tab (`catalog/src/admin/pages/ProductEditor.tsx:795–802`, shown for every
  type): a new `ProductOrderRulesCard.tsx` with "Returnable" (every type) and "Minimum order quantity
  (pcs)" (simple / configurable only, input `min=1 max=1000000`), saving through the existing `PATCH
  /api/v1/admin/catalog/products/:id` (`catalog:write`).
- `PackagingUnitsEditor.tsx`: a "Minimum (units)" column / field (same range).
- `ProductsBulkEditDialog.tsx`: a "Returnable" section (set yes / set no), with a one-line hint that
  products are not returnable until marked (FR-034's operator-facing statement in the UI).
- Admin create-order preview: `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` (`packages/contracts/src/orders.ts:799`)
  gains `BELOW_MINIMUM_QUANTITY` **last**; `messages[]` gains optional `minimum`.
- Admin quick-order import: rows with `warning` are shown buildable with a "below minimum (N pcs)"
  badge (P1 C); the build result lists `rejected[]` for target `cart`.
- `RfqDetail`: the FR-030 badge (R13.5).
- No new permission, palette action, nav entry or Setting: every surface is an existing screen gated
  by its existing code (Principle XVI satisfied by the screens' existing palette entries).

## R17 — Module activation (Principle XVII)

| Module off | Behaviour |
| --- | --- |
| `returns` | Its routes answer 503 (unchanged). `orders` still records `returnable_at_purchase` at placement (no edge to `returns`); switching `returns` back on answers from the recorded value. The catalogue's "Returnable" control stays visible (spec Assumption). New off-state case: place while off, re-enable, `GET /returnable` reflects the stamp. |
| `quick_order` | Preview, build and one-click answer 503 (unchanged). The cart still enforces minimums for every other path. |
| `shopping_lists` | Conversion routes answer 503 (unchanged); `carts`' `appendShoppingListToCart` seam fails closed as today. |
| `quote_requests` | Cart → quote fails closed at `rfqService` (unchanged); quote → cart is not reachable; admin warnings unreachable. Already-seeded baskets keep their per-line state in `carts`, and add, edit and the cart view keep trusting the mark (FR-028). **At the checkout preview and placement, `quoteRequestRead()` answers `null`, so the source cannot be vouched and no line is exempt (R19)**: a seeded basket below a minimum is flagged in the preview and refused at placement while `quote_requests` is off — the fail-closed reading of FR-036 (the quote's validity cannot be confirmed). This is a new off-state consequence and gets its own case (T092a). |
| `catalog`, `carts`, `orders` | `nonDeactivatable` — no off state. |

No new route, worker, subscriber, timer or boot hook is added, so `check:off-state-coverage` gains no
obligation; the existing off-state tests of the switchable modules are re-run, and `returns` and
`quote_requests` gain the cases above.

## R18 — Caching

No new cache. The cart recompute cache (`cart-recompute-cache.ts`) holds prices only; the minimum
evaluation is never cached. Product writes already emit `product.updated.v1` with `changedFields`
(`catalog-admin.service.ts:21`), which drives the existing invalidation; the storefront's product
detail fetch keeps its revalidation window, so a changed minimum reaches the PDP within it while the
API refusal is immediate (the binding rule, spec *API vs UI*).

## R19 — Placement: where the check sits, and when a quote line is exempt (FR-008, FR-036, FR-037; threat F2, F3)

**Measured.** `placeOrder` (`order-service.ts:1344`) opens its transaction at `:1364`, reads the
basket on it at `:1404–1418`, and then runs, in order: the minimum order **value** gate
(`:1420–1435`), address and method reads, the business-id sequence (`businessId.generate`, a write),
stock reservation (`:1519–1714`, `lockAvailabilityForPlacement` / `reserveForPlacement` — writes), the
product read for totals (`:1726`), and only then the quote-source vouch (`:1777`,
`#vouchedQuoteRequestSource`, `:1315–1342`), the order and item rows, and the credit reservation
(`:2076`). A basket line whose product record is missing is **not** refused today: totals default its
type to `simple` (`:1087`, `:1103`) and the item row is written with `product` undefined (`:1906`).

**Decision.**
1. **One product read, hoisted.** Right after the empty-basket check, placement reads
   `findByIds(productIds)` and `listPackagingUnitsByProductIds(productIds)` once (both over the
   buyer's own basket — R7's vetted-ids rule) and reuses the record map for the minimum check, the
   totals (`:1726`, which then stops reading again) and the returnable stamp (R3). The inventory
   block's own `findByIds` (`:1603`) stays (it reads stock flags of the same records; folding it in is
   an optional tidy-up, not required).
2. **The vouch moves up, with its lock (F2).** `#vouchedQuoteRequestSource` is called **immediately
   after the product read** — before the value gate, the business id, any stock reservation and the
   credit reservation — and its answer is reused at `:1777` to stamp `source_quote_request_id` (no
   second call). It is refactored to return `{ sourceQuoteRequestId, quoteRequest }` so the
   exemption decision can read the record it already fetched.
3. **When the exemption applies (FR-036).** Exemptions are honoured only when **both** hold:
   - the existing judge accepts the source (`judgeQuoteRequestSource`,
     `orders/src/backend/domain/quote-request-source.ts`): the request exists, belongs to the placing
     organization (XI), is `Approved` (cancelled / expired / completed are other statuses), no Order
     already carries it (counted under the advisory lock), and the basket still holds at least one
     agreed line at its agreed price;
   - **and** the quote's validity has not lapsed: `quoteRequest.expiresAt === null ||
     expiresAt > now` — the rule `convertToOrder` applies when it seeds the basket
     (`rfq-service.ts:911`, `validityHasLapsed`, private to `quote_requests`). It is re-stated as a
     pure `quoteSourceHonoursExemptions(judged, quoteRequest, now)` in `orders`' `domain/` beside the
     judge rather than imported across modules; the provenance stamp itself keeps today's judge
     (whether an order of a lapsed quote should still name its source is not this feature's to
     change).
   Otherwise every line is judged like any basket line (`exempt = false` for all).
   `isQuoteSeededLineExempt` (R4) then decides per line.
4. **The minimum check (F3)** runs right after that, **inside the transaction, before the first
   side effect**: `evaluateOrderMinimums` over the basket with the exemptions of step 3. Violations:
   - any `product_unavailable` (FR-037) → `404 PRODUCT_NOT_FOUND`, `details: { cartItemIds }`, no
     name;
   - otherwise any minimum violation → the minimum code of the first, `details.lines` per R10.
   Nothing is written; the lock is released by the rollback.
5. The existing value gate, then everything else, follow unchanged.

**The lock is now held longer — accepted.** The advisory lock (`pg_advisory_xact_lock` on the
request id) used to be taken "late in the transaction"; it is now taken near the start and held to
commit, **only for a basket that carries a quote mark**. Two placements of one quote take turns for
the whole placement instead of its tail — the serialisation FR-036's "no order already carries it"
needs to be true at the moment the exemption is granted. Ordinary baskets take no lock.

**The vouch still never refuses.** It decides provenance and, now, whether exemptions apply; the
refusal, if any, is the minimum check's. A basket of a cancelled quote whose lines all meet their
minimums places as an ordinary order, exactly as today.

**Checkout preview (`previewTotal`).** FR-008 / FR-036 require the preview to report the same lines.
`previewTotal` opens no transaction and holds no `EntityManager` (its comment, `:1192–1205`, records
why: a read handed one is a write seam — D-169, about reading **another** module's tables). The preview
uses a **lock-free read-only** assessment: the same `findById` / `listItems` through
`quoteRequestRead()`, the same judge and validity rule, and the "already ordered" count on `orders`'
**own** `Order` table through a fresh `emFactory()` fork — a read of the module's own table, which is
not the seam D-169 closes. Under a race (a second basket of the same quote placing between preview and
placement), preview and placement can disagree; placement is the binding answer and the preview is
advisory, as for stock today.

**One assertion per placement entry point (F3).** Checkout (`POST /api/v1/orders`), one-click, admin
create, API intake, and a direct `OrderPlacementPort.placeOrder` call each get an integration case
proving a below-minimum basket is refused at `placeOrder` itself (T056, T057, T067). For admin create
and API intake the batch step (R8) normally refuses first; their case seeds the transient basket
through `replaceItemsForCustomer` and calls the port to prove the backstop.

**Alternatives rejected.**
- *Check after the value gate* (the first plan) — still before stock, but the vouch it depends on ran
  after stock reservation; the check would have trusted the face-value mark at placement (the gap F2
  names).
- *Keep the vouch late and re-check minimums there* — refuses only after stock and the business id
  were written inside the transaction; rolled back, but the work and the lock ordering are wasted, and
  two sources of truth for one decision.
- *Import `validityHasLapsed` from `quote_requests`* — a module-internal function; Principle I.
- *Refuse placement when the vouch fails* — changes today's provenance behaviour for baskets that meet
  every minimum.

## R20 — Bounded batch sizes (FR-038; threat F4)

**Decision.** Two constants in `@endora-commerce/contracts` (contracts cannot import a module):
`QUICK_ORDER_BUILD_MAX_ITEMS = 200` and `ADMIN_ORDER_MAX_ITEMS = 200`, enforced as the **first
statement** of `QuickOrderBuildService.build`, `OrderCreationAdminService` (create) and the admin
preview handler: more items → `422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum:
200 }`, before any line is resolved, evaluated or added, for HTTP and in-process callers alike. The
request schemas (`quickOrderBuildRequestSchema.items`, `quick-order.ts:115`;
`adminCreateOrderRequestSchema.items`, `orders.ts:655`; `adminOrderPreviewRequestSchema.items`,
`:777`) are **not** given a `.max()`.
- **Why not in the schema — measured.** A Zod refusal answers **400** (`packages/platform/src/http/error-envelope.ts:219–248`,
  both the type-provider and the plain `ZodError` branch), and FR-038 / US4 #17 require **422**. A
  schema `.max()` would preempt the service check and make the required status unreachable. The cost
  is that the bound is not advertised in the OpenAPI document; if the product owner prefers the
  advertised bound with a 400, FR-038's wording changes and the bound moves into the schemas (plan
  § *Open for the owner*).
- **Why 200.** Both build targets already stop at 200: the cart's line cap (`CART_MAX_LINES = 200`,
  `cart-service.ts:59`) and the quote request's (`createQuoteRequestSchema.items.max(200)`,
  `quote-requests.ts:441`). Admin create builds a transient basket behind the same cart cap. So 200 is
  the largest request that can succeed; anything larger used to fail part-way, after writes.
  **Consequence, stated:** a quick-order build to `quote_request` with 201+ lines reached the
  service unbounded through the in-process port and created an oversized request; it is now refused —
  a deliberate tightening, stated in the `mod-quick-order` changeset.
- **Clamp.** The import preview's `quick_order.import_max_rows` Setting (`manifest.ts:50–57`, default
  2000, declared with **no maximum**) is clamped at read to `[1, QUICK_ORDER_IMPORT_ROWS_CEILING]` with
  `QUICK_ORDER_IMPORT_ROWS_CEILING = 10 000` (in `quick_order`, not a contract), so the preview's
  evaluation is bounded however the Setting is set. A value above the ceiling is logged once as
  out of range, like the existing out-of-scope branch (`index.ts:317–334`).
- **Evaluation cost.** R6.1 is linear and R8 runs two passes; a performance case evaluates the import
  ceiling (10 000 lines over 10 000 products) and a 200-line batch against a 200-line cart and asserts a
  generous wall-clock bound (catches a quadratic regression, not a micro-benchmark).

**Not in FR-038, flagged.** `apiPlaceOrderRequestSchema.lines` (`orders.ts:735–744`, API intake) is
likewise unbounded and reaches the same `addItems`. The cart cap already makes 201+ lines fail; the
same service-level bound would only change *where* it fails, but it is a public API behaviour change
outside the requirement's text — recommended, left for the owner (plan § *Open for the owner*).
**Ruled in scope by the owner on 2026-10-16**: FR-038 now covers the API intake; task T063b.

**Alternatives rejected.** A schema `.max()` (answers 400, FR-038 says 422 — above); aligning the
build cap with the import's 2000 (no 2000-line build can succeed into a cart; it would bound nothing
useful); no clamp on the Setting (an operator-set 1 000 000 would make the preview's work unbounded).

---

## Coordinator rulings

| # | Reading | Status |
| --- | --- | --- |
| 1 | R8 — batch paths judge a product's batch lines together with the cart | **Mandated** by FR-006a / FR-011 (product total across variants); no longer a reading |
| 2 | R4 — 5 → 12 → 5 regains the exemption | **Confirmed** by the owner (clarification P2); FR-028 amended |
| 3 | R12.1 — preview row granularity | **Superseded** by P1: the preview judges the file total per product |
| 4 | R14 — FR-018 shape: `eligible: false` + `no_returnable_lines` | **Confirmed** by the coordinator (2026-10-15) |
| 5 | R9 — minimum on an ineligible product type refused `422 VALIDATION_FAILED` (create and update) | **Confirmed** by the coordinator (2026-10-15) |
| 6 | R11 — D7: the cart view fails when the catalogue read fails | **Confirmed** by the coordinator (2026-10-15) |
| 7 | R14 — FR-033 by aggregation, entries stored as sent | **Confirmed** by the coordinator (2026-10-15) |
| 8 | R20 — 200-line bounds in the services (422), not the schemas (400); import ceiling 10 000 | **Confirmed** by the coordinator (2026-10-15) |
| 9 | R19 — the exemption also requires the quote's validity not to have lapsed; provenance stamping unchanged | **Confirmed** by the coordinator (2026-10-15) |
