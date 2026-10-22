# Implementation Plan: minimum order quantities (pieces and packaging units) and the returnable flag

**Branch**: `feat/155-catalog-order-constraints` (from `origin/master`) | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/155-catalog-order-constraints/spec.md` (clarified;
sessions 2026-10-13 and 2026-10-15: Q0–Q10, the analyze rulings P1–P4 and the threat-model line;
issues #285, #294). Every clarification is binding. Measured against `origin/master` at `39b9b9989`.
Revised 2026-10-15 after the analyze pass and the security threat model.

## Summary

An operator sets, on a product, a minimum order quantity in pieces and, per packaging unit, a minimum
number of units; and marks a product returnable. The platform enforces the minimums on every way a
buyer puts goods into a basket or a quote request, and limits `return`-kind cases to lines whose
product was returnable when the order was placed.

Technical approach, with the evidence in [research.md](./research.md):

- **Storage** — first-class columns, no new table: `products.min_order_quantity`,
  `products.returnable` (default `false`), `product_packaging_units.min_order_units` (all `catalog`,
  both minimums bounded 1…1 000 000); `order_items.returnable_at_purchase` (`orders`, `null` = before
  this feature, otherwise always an explicit boolean); and `quote_request_items.packaging_unit_id`
  (`quote_requests`). Three migrations, one per owner (R1–R5). The per-line FR-028 state is master's
  existing `cart_items.agreed_quantity` (`carts`), read as is — no migration of ours on `carts` (R4).
- **One rule** — a pure, linear `evaluateOrderMinimums` in `@endora-commerce/contracts`
  (`isProductVisibleTo` precedent) implementing FR-006a once, failing closed on a missing product record
  (FR-037). Consumers read rule data through `catalogProductReadPort`, which gains two record fields and
  one batch method whose callers pass only vetted ids (R6, R7).
- **Cart** — add's preconditions move into one resolver shared by the single add and a new in-process
  `CartWritePort.addItems`, which resolves every line first, then judges the batch with the cart in two
  bounded passes, used by every batch path (quick order, shopping list, quote → cart, admin create, API
  intake) (R8, R11).
- **Placement** — inside the transaction, right after the basket read and before any side effect,
  `placeOrder` vouches the basket's quote source (now also checking its validity) and re-validates
  the basket, honouring quote-line exemptions only for a valid source (FR-008, FR-036, R19). The
  checkout preview reports the same lines; the admin create preview gains a message code; one-click
  orders the minimum; batch requests are bounded (R20).
- **Quote requests** — packaging referenced by `packagingUnitId` and validated against the catalogue
  with one external reason for an unusable id (FR-026); buyer writes refused (FR-012) with draft-edit
  exemptions for unchanged lines (FR-031); representative writes warned through an in-process
  `minimums: 'warn'` option (FR-030) (R13).
- **Returns** — placement records the flag per line, fail-closed; `returns` reads it through
  `OrderReturnContextPort`, refuses `return` cases with a non-returnable line, sums duplicate entries
  per order line (FR-033), and tells the buyer when only a complaint is possible (R14).
- **Admin / storefront** — existing screens extended (product Inventory tab, packaging editor, bulk
  edit, quote-request detail, order preview, quick-order import; PDP, card, comparison, cart, checkout,
  quick order, quote draft, returns form, order detail); no new screen, permission, palette entry or
  Setting (R15, R16).

No new runtime dependency.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod (backend); React 19 + Vite through `@endora-commerce/admin-kit` (admin); Next.js 15 App Router, server components and server actions (storefront) — **no new runtime dependency**
**Storage**: PostgreSQL — five columns on four existing tables (`products`, `product_packaging_units`, `order_items`, `quote_request_items`), three additive migrations owned by `catalog`, `orders`, `quote_requests`; the FR-028 exemption reads the existing `cart_items.agreed_quantity` (no migration on `carts`); no new table, no FK, no backfill
**Testing**: Vitest — co-located unit tests under `packages/contracts/src` and `packages/modules/{catalog,carts,orders,quote_requests,quick_order,shopping_lists,returns,comparisons,search}/src/backend/**`; `backend/test/{contract,integration}/<module>/` against Postgres, one file per invocation; `admin/test/modules/{catalog,orders,quote_requests,quick_order}`; `storefront/test/{catalog,checkout,rfq,account}`
**Target Platform**: Linux server; backend, admin SPA and storefront deployed separately
**Project Type**: web application — monorepo (`backend/`, `admin/`, `storefront/`, `packages/`)
**Performance Goals**: one additional `listPackagingUnitsByProductIds` read per cart add / edit / full view / placement / preview / quote write; a batch path resolves each line once and evaluates the rule twice per batch (R8), never once per line; the rule is `O(lines + products + units)`, pinned by a performance case at the import ceiling (10 000 lines); the quote-draft page fans out at most 8 product reads at a time
**Constraints**: every rule enforced by the API, the storefront only mirrors it (spec *API vs UI*); existing 404s keep precedence over a minimum refusal and a line that fails them never discloses a name or a minimum (FR-035); a minimum or packaging refusal on a quote request writes nothing and costs no pricing call (FR-029); the placement check runs before the first side effect; `returns` off changes nothing that `orders` records
**Scale/Scope**: 9 modules (`catalog`, `carts`, `orders`, `quote_requests`, `quick_order`, `shopping_lists`, `returns`, `comparisons`, `search`) + `contracts`, `_i18n` core bundle, admin, storefront; 0 new routes; 1 new port method + 1 new in-process write-port method; 4 migrations; 4 error codes; 4 service-level request bounds; 23 task phases, 166 tasks incl. T063b (API intake bound, owner ruling 2026-10-16)

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design and after the analyze / threat-model
revision — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | `catalog` owns the minimums, the flag, their admin writes and the three catalogue error codes; `carts` owns the exemption state, the cart checks and the shared add resolver; `orders` owns the recorded flag, placement and the quote-source judgement (the validity rule is restated in `orders`' `domain/`, not imported from `quote_requests`); `quote_requests` owns line packaging and warnings; `returns` owns the returnability policy (`null` ⇒ returnable) and FR-033. Cross-module reads go through ports each consumer already resolves (`catalogProductReadPort`, `cartWritePort`, `cartPlacementApply`, `orderReturnContextPort`, `quoteRequestReadPort`, `rfqService`); the shared rule is a pure contract function. **No new lifecycle edge.** |
| **II. API-first** | Pass | Every HTTP shape, the bounds constants and the rule are written in `packages/contracts/` first (Phase 2); each record or port interface change is the first task of the phase that changes its producer (P4, P6, P7, P10, P12), so the tree compiles after every phase. All schema changes additive; the FR-038 bounds are service-level refusals, not schema changes (a Zod refusal answers 400 and FR-038 requires 422, R20); customer request schemas stay non-strict (146 M4). OpenAPI baseline re-recorded and reviewed (Phase 19). |
| **III. TDD (NN)** | Pass | Every implementation task in `tasks.md` follows a RED task; § *Requirement → test* maps every FR and SC, FR-033 – FR-038 and SC-006 included. |
| **IV. YAGNI, minimal dependencies** | Pass | No dependency. No new table, route, Setting, cache, queue or event. Bulk edit gains the flag only; no step/maximum quantities; the rule's `group` input dropped once P1 removed its only user; the draft page reuses the public product-detail route (R15). |
| **V. TypeScript everywhere** | Pass | Zod at every boundary; the rule is a typed pure function. |
| **VI. Naming (NN)** | Pass | snake_case columns, camelCase JSON, SCREAMING_SNAKE codes prefixed by their noun, migration slugs per owner. `check:naming` in the final phase (Docker on macOS). |
| **VII. SEO, performance** | Pass | PDP and listings stay server-rendered; the minimum is a field of the DTOs they already fetch. The draft page's reads are client-triggered server actions on a `noindex` page. |
| **VIII. English (NN)** | Pass | Code, specs, docs English; Polish only in bundles, `storefront/lib/i18n/messages.ts`, the draft view's inline dictionary and `docs/i18n/pl`. |
| **IX. UI reuse** | Pass | Admin-kit `Card`, `Checkbox`, `Input`, `Badge`/`Alert` in the existing tabs and dialogs; storefront reuses its cart line, notice and form primitives. |
| **X. Queue consumers** | N/A | Nothing asynchronous. The bulk-edit queued path (> 200 products) already exists and carries the new field through the same `applyToOneProduct`. |
| **XI. Tenant isolation (NN)** | Pass | No new entity; every touched table keeps its classification. Minimum checks run inside each path's existing tenant context. A quote line is exempt at placement only when the quote belongs to the placing buyer's organization (the existing `judgeQuoteRequestSource` check, now gating exemptions too, R19). Refusals never disclose a product the buyer may not see (FR-035, R8). The returns check reads the order through the port that already enforces ownership. |
| **XII. Sales-channel scoping (NN)** | Pass | Channel checks are untouched, shared verbatim by the batch through `#resolveLine`, and run before the minimum; minimums are global per product (spec Assumption). |
| **XIII. Command Bus (NN)** | Pass, recorded | Single product PATCH (`updateProductAudited`) and packaging-unit writes (`#audited`) run through `CommandBus.run`; their `before`/`after` gain the new fields (FR-005). **The bulk edit does not**: `applyToOneProduct` calls the legacy `CatalogAdminService.updateProduct` (`catalog-bulk-update.service.ts:274`), which writes one `product.update` row per product through `AuditPort.record` with `stateBefore`/`stateAfter` from the same `#applyProductUpdate`, plus a `product.bulk_update` summary row (sync and queued paths). That path predates the Command Bus; this feature adds `returnable` to it and does not migrate it — FR-003's per-product audit with before/after is met by those rows (T028 asserts it) and the queued undo covers the new column generically. Migration logged under *Deferred defects*. Cart writes keep their existing `command-coverage-ignore` reasons; placement and quote writes keep their existing audit. `check:command-coverage -- --strict` runs in Phases 5, 6 and 20. |
| **XIV. Entity-agnostic extensibility** | Pass, recorded | Custom fields rejected for the minimums and the flag: they are refused outside a product's attribute set and must be enforced by four modules (R1). |
| **XV. Untouched core, overlay** | Pass | Nothing deployment-specific. |
| **XVI. Command palette** | Pass | No new admin surface; the product editor, quote desk, order create and quick-order screens keep their palette entries. |
| **XVII. Operator-toggleable modules (NN)** | Pass | No new route, worker, subscriber, timer or boot hook. `returns` off: routes 503, recording continues in `orders`, correct after re-enable (new off-state case). `quote_requests` off: already-seeded baskets lose their exemptions at preview and placement because the source cannot be vouched — fail-closed, new off-state case (R17). `quick_order` / `shopping_lists` off: their entry points 503 as today; the cart's own enforcement is independent of them. |

**Verdict: PASS.** No violation needs justification; Complexity Tracking records the choices a
reviewer would otherwise ask about.

## Deviations from the spec, and reinterpretations

Nothing changes a requirement's text. These are technical readings; all were accepted on
2026-10-15 (D2 by the owner, the rest by the coordinator — research § *Coordinator rulings*):

| # | Spec text | What the plan does | Why |
| --- | --- | --- | --- |
| D1 (confirmed) | FR-009/FR-011 list batch paths; FR-006a "product total" | Batch paths judge all of a batch's resolved lines of one product together with the cart, in two passes (units, then pieces) | A per-line check refuses A-red × 5 + A-blue × 5 (min 10), which FR-006a accepts (R8). Mandated by FR-006a; recorded for the mechanism |
| D2 (confirmed, P2) | FR-028 "while its quantity equals the quote's quantity" | Exempt iff the current quantity equals the stored seeded quantity | **Confirmed** by the owner (clarification P2); kept as the record of why the state is a quantity, not a flag (R4) |
| D3 (confirmed) | FR-011 (a) "the response shape is the plan's" (operator import) | A below-minimum row stays in `recognized` with `warning: { reason: 'below_minimum', minimum, productTotal }`; the summary gains `warningCount` | Keeps the row buildable without a second list; the buyer's import keeps `rejected` (R12.1) |
| D4 (confirmed) | FR-018 "say that no `return` case can be opened and why … MUST NOT stop a complaint" | `eligible: false` + new reason `no_returnable_lines`, which the storefront treats as "complaint only"; `eligible` now answers for `return` cases | One enum value instead of a second order-level flag (R14); the meaning change is documented (T136, T138) |
| D5 (confirmed) | Edge case "Minimum ≤ 0 … rejected at save" | Also refuses a minimum on a grouped/bundle/virtual product (`422 VALIDATION_FAILED`), on create and update | The spec scopes minimums to simple/configurable; the control is not rendered for others (R9) |
| D6 (confirmed) | Assumption: unit count uses "the base quantity snapshotted on the line" | Snapshot when the line has one, else the unit's current value | Quote lines store the catalogue's value at write (FR-026); cart lines have their snapshot |
| D7 (confirmed) | FR-013 / FR-037 (read model reports the line) | The full cart view **fails** (`5xx`) when the catalogue read fails, instead of answering a cart without flags; a line whose product record is gone uses the existing `unavailable` / `not_purchasable` | Hiding a below-minimum flag behind the view's tolerant `catch` is fail-open (R11) |
| D8 (confirmed; spec US6 #9 to be reworded by the PO) | FR-037 "when a minimum check cannot read the product's record" | Applied to **every** basket line whose record is absent, whatever its type — at placement such a line is refused `404 PRODUCT_NOT_FOUND` | Without the record the type is unknown, so "outside the minimum scope" cannot be proven; today such a line is placed with a defaulted type (`order-service.ts:1087`). US6 #9's "type outside the scope" case is then reachable only through a record lacking the flag, which T090a covers |
| D9 (confirmed) | FR-036's list of invalid sources | Exemptions also end when the basket holds no agreed line at its agreed price any more (the existing `no-agreed-line` refusal of `judgeQuoteRequestSource`) | One judge for provenance and exemption; a basket with nothing of the quote left is not the quote's basket (R19) |
| D10 (confirmed) | FR-011 (`'throw'` callers) | A batch whose line fails resolution now fails **before** anything is added (today quick order adds the earlier lines first) | Resolution precedes evaluation (F1); the batch can only become more atomic. Stated in the changesets |

## Inferred, to be proven by the first test of the phase

| # | Assumption | Proved by | If refuted |
| --- | --- | --- | --- |
| I1 | A catalogue-owned code raised by `carts`, `orders` and `quote_requests` is translated from `catalog`'s bundle in the request's language. `PACKAGING_UNIT_NOT_FOUND` is only an **ownership** precedent (it carries no sentence); translation routing is what T039 proves | Phase 6 `[PG]` T039 asserting the Polish sentence for a cart add with `Accept-Language: pl` | Declare the code additionally where the routing requires it, following whatever `error-code-routing-equality` reports; record here |
| I2 | `check:port-shape` and `check:port-dependencies` accept a new method on an existing port with no manifest change (no new edge) | Phase 4 T027 | Add the documentation the check asks for; no design change |
| I3 | The OpenAPI baseline moves only by additions | Phase 19 T141 | A removal or rename is a defect in this feature, fixed before re-recording |
| I4 | `replaceItemsForCustomer` is the only writer of seeded cart lines | Phase 6 T040 (`git grep "CartItem, {"` outside `carts` returns nothing, pinned by the test) | Route the other writer through the port |
| I5 | The storefront's public product detail read (`GET /api/v1/catalog/products/:idOrSlug`) answers 404 for a product the buyer may not see, so a draft line of a hidden product simply shows no minimum | Phase 17 T127 | Treat any non-2xx as "minimum unknown"; the API refusal stays binding |
| I6 | `previewTotal` may count `orders`' own `Order` rows through an `emFactory()` fork without tripping `check:transaction-context` or D-169 (which is about reading another module's tables) | Phase 8 T060 + the phase's `check:transaction-context` | Expose the count on the existing placement-read seam instead; no behaviour change |
| I7 | Moving the vouch and its advisory lock to the start of placement does not deadlock with the inventory row locks (`lockAvailabilityForPlacement`) — the lock order becomes advisory-then-rows for every placement of a quote basket | Phase 8 T056a (two concurrent placements of one quote) and the existing `place-order-from-quote-request` file | **Shipped (Phase 8, recorded in `OrderService#vouchedQuoteRequestSource`):** one lock order for every placement — the advisory lock on the quote request's id (taken only for a basket carrying a quote mark), then the `stock_levels` row locks (`lockAvailabilityForPlacement`), then the business-id sequence, then the order rows. An ordinary basket never takes the advisory lock and no placement takes it after a row lock, so there is no cycle. Fallback if a deadlock is ever measured: take the lock after the stock block but keep the exemption decision before it, with a re-check after |

## Requirement → test

| FR / SC | Test (new unless it says "extend") |
| --- | --- |
| FR-001, FR-002, FR-003 | `packages/contracts/src/catalog-order-rules.test.ts`, `order-minimums.test.ts` (range); `backend/test/integration/catalog/order-rules-schema.test.ts` `[PG]` (check constraints); `backend/test/contract/catalog/product-order-rules.test.ts` `[PG]` (PATCH and create set/clear/refuse, range, ineligible type; bulk `returnable` with per-product audit, sync and queued); `backend/test/contract/catalog/packaging-unit-minimum.test.ts` `[PG]` (route and `CatalogPackagingPort` range); `admin/test/modules/catalog/ProductOrderRulesCard.test.tsx`, `PackagingUnitsEditor.min.test.tsx`, `ProductsBulkEditDialog.returnable.test.tsx` |
| FR-004 | `order-rules-schema.test.ts` (default `false`); `product-order-rules.test.ts` (untouched product reads `false`) |
| FR-005 | `product-order-rules.test.ts`: audit `before`/`after`; existing cart/order/quote/return lines unchanged after a minimum and flag change; `packaging-unit-minimum.test.ts` |
| FR-006a, FR-006, FR-007 | `packages/contracts/src/order-minimums.test.ts` (every row of data-model §6); `packages/modules/carts/src/backend/services/cart-minimums.test.ts`; `backend/test/integration/carts/minimums.test.ts` `[PG]` |
| FR-008 | `backend/test/integration/orders/place-order-minimums.test.ts` `[PG]` (US1 #5, US2 #7, US4 #4; preview parity; before any side effect; port entry point) |
| FR-009 | `backend/test/integration/orders/admin-create-minimums.test.ts`, `backend/test/contract/orders/api-intake-minimums.test.ts` `[PG]` (incl. the placement backstop); extend `admin-order-preview-availability.test.ts` |
| FR-010 | extend `one-click-service.test.ts` (type filter); extend `backend/test/contract/quick_order/one-click-place.test.ts` `[PG]` |
| FR-011 | `packages/modules/carts/src/backend/services/cart-batch-add.test.ts`; extend `import-pipeline.test.ts` (file totals, operator warning), `quick-order-build-service.test.ts`; extend `backend/test/contract/quick_order/{build,admin-build,csv-import}.test.ts` `[PG]` (US4 #1–#1d); extend `shopping_lists/crud-and-convert.test.ts`; extend `carts/cart-conversions.contract.test.ts` (US4 #8) |
| FR-012, FR-029 | `quote-minimums.test.ts`; `backend/test/integration/quote_requests/minimums.test.ts` `[PG]` |
| FR-013, FR-015 | `backend/test/contract/carts/cart-view-minimums.test.ts` `[PG]`; `storefront/test/checkout/cart-line-minimum.test.tsx` |
| FR-014, FR-016, SC-002 | `storefront/test/catalog/{pdp-minimum,product-card-minimum,compare-add-minimum}.test.tsx`; `backend/test/contract/catalog/storefront-minimum-dto.test.ts` `[PG]` |
| FR-016a, FR-017, FR-025 | `backend/test/integration/orders/returnable-at-purchase.test.ts` `[PG]`; `packages/modules/orders/src/backend/services/returnable-at-purchase.test.ts` (fail-closed); `packages/modules/returns/src/backend/services/return-eligibility.test.ts` |
| FR-018 – FR-020, FR-022, SC-003 | `backend/test/integration/returns/returnable-lines.test.ts` `[PG]` (US6 #1–#7, #9) |
| FR-021 | `storefront/test/account/{returns-new-returnable,order-detail-return-action}.test.tsx` |
| FR-023, SC-004 | `check:error-translations`, `check:bundle-pairing`, `registered-bundles-shape.test.ts`, `i18n:hardcoded`, storefront `tsc`; the sentence assertions in T039, T077, T078, T091 |
| FR-026, FR-027 | `packaging-resolution.test.ts`; `backend/test/integration/quote_requests/packaging-units.test.ts` `[PG]` (incl. one reason for any unusable id; modify carries the id; customer read exposes it) |
| FR-028 | `backend/test/integration/carts/quote-seeded-exemption.test.ts` `[PG]` (US4 #7–#7d) |
| FR-030 | `backend/test/contract/quote_requests/admin-minimum-warning.test.ts` `[PG]`; `admin/test/modules/quote_requests/RfqDetail.minimum-warning.test.tsx` |
| FR-031 | same integration file as FR-012 (US4 #5b, #5c, #5d) |
| FR-032 | `storefront/test/rfq/rfq-draft-minimum.test.tsx`, `rfq-draft-minimums-action.test.ts` |
| FR-033, SC-006 | `return-eligibility.test.ts`; `backend/test/integration/returns/duplicate-lines.test.ts` `[PG]` (US6 #8) |
| FR-034 | `ProductsBulkEditDialog.returnable.test.tsx` (hint); docs (T135, T137) and changesets (T138), checked by `check:docs-translations` and `check:release-intent` and reviewed |
| FR-035 | `cart-batch-add.test.ts`; `cart-conversions.contract.test.ts`; `admin-create-minimums.test.ts`; `admin-order-preview-availability.test.ts`; quick-order `build.test.ts`; `crud-and-convert.test.ts`; quote `minimums.test.ts` / `packaging-units.test.ts` |
| FR-036 | `backend/test/integration/orders/place-order-quote-source-exemption.test.ts` `[PG]` (US4 #7e); `packages/modules/orders/src/backend/domain/quote-source-exemption.test.ts`; extend `backend/test/integration/quote_requests/off-state.test.ts` |
| FR-037 | `order-minimums.test.ts`, `cart-minimums.test.ts`, `minimums.test.ts` (edit), `cart-view-minimums.test.ts`, `place-order-minimums.test.ts`, `cart-line-minimum.test.tsx`, `checkout-below-minimum.test.tsx` |
| FR-038 | `order-minimum-shapes.test.ts`; `backend/test/contract/orders/admin-order-bounds.test.ts` `[PG]`; `quick-order-build-service.test.ts`; quick-order `build.test.ts` (US4 #17) |
| SC-001 | the union of the FR-008/FR-009/FR-011/FR-012/FR-036 `[PG]` files — each entry point refused or reported |
| SC-005 | `ProductsBulkEditDialog.returnable.test.tsx` + bulk contract case (200 products in one request) |
| XVII | extend `backend/test/integration/returns/off-state.test.ts` and `quote_requests/off-state.test.ts`; re-run `quick_order`, `shopping_lists`, `carts` off-state files |

## Project Structure

### Documentation (this feature)

```text
specs/155-catalog-order-constraints/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R20
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── catalog-api.md
│   ├── cart-and-checkout-api.md
│   ├── quote-requests-api.md
│   ├── returns-api.md
│   └── error-codes.md
└── tasks.md
```

### Source code touched

```text
packages/contracts/src/
├── order-minimums.ts (+ .test.ts)        # new: bounds, evaluateOrderMinimums, minimumRefusal
├── catalog.ts                            # request/DTO/record/port additions
├── carts.ts                              # view line, dropped reason, addItems, isQuoteSeededLineExempt
├── orders.ts                             # preview-total belowMinimumLines, admin preview code, ADMIN_ORDER_MAX_ITEMS
├── quote-requests.ts                     # line packagingUnitId, options.minimums, minimumWarning
├── quick-order.ts, shopping-lists.ts     # below_minimum reports, operator warning, QUICK_ORDER_BUILD_MAX_ITEMS
├── returns.ts                            # returnable lines, no_returnable_lines, port field
├── comparisons.ts                        # minOrderQuantity
├── errors.ts                             # 4 codes
└── index.ts                              # export order-minimums

packages/modules/catalog/                 # entities, migration, admin + bulk + packaging services (range),
                                          # read port, query DTOs, manifest errorCodes, i18n, admin UI, docs
packages/modules/carts/                   # entity, migration, cart-service (#resolveLine, addItems),
                                          # cart-read-port, conversion service, routes (view), docs
packages/modules/orders/                  # entity, migration, order-service (placement, vouch, preview, stamp),
                                          # domain/quote-source-exemption, returnable-at-purchase, admin create,
                                          # API intake, admin preview, clone actor, return context
packages/modules/quote_requests/          # entity, migration, packaging-resolution, rfq-service, serializer,
                                          # admin RfqDetail badge (strings in packages/modules/_i18n/i18n)
packages/modules/quick_order/             # import pipeline, build service, one-click, admin route, index (clamp),
                                          # admin import UI, i18n, docs
packages/modules/shopping_lists/          # convertToCart, docs
packages/modules/returns/                 # return-eligibility, return-case-service, manifest errorCodes, i18n, docs
packages/modules/comparisons/             # DTO projection
packages/modules/search/                  # hit projection

storefront/
├── components/{ProductBuyActions, ProductCardActions, CompareAddToCartButton, ComparisonTable, CartLine, CartDroppedLinesBanner}.tsx
├── components/rfq/{RfqDraftView, AddToRfqButton}.tsx, components/pricing/QuoteRequestCta.tsx
├── lib/rfqDraft.ts, lib/api/{catalog,rfq,orders,quick-order}.ts, lib/i18n/messages.ts
├── app/(commerce)/cart/page.tsx, app/(commerce)/checkout/…
└── app/(account)/{quick-order/…, shopping-lists/…, returns/new/page.tsx, orders/[id]/page.tsx}

docs/i18n/pl/…/modules/{catalog/packaging-units, catalog, carts, orders, quote_requests,
                        quick_order, shopping_lists, returns}.md + translation-cache entries
backend/test/fixtures/{error-code-routing/reference-ledgers.ts, openapi-baseline.json}
.changeset/155-*.md
```

**Structure Decision**: extend existing modules; no new module. The minimum and the flag are catalogue
facts (R1); enforcement belongs to the module that owns each write path (Principle I); the rule is a
contract function so it has one implementation (R6).

## Migrations

Owned and scaffolded per module — never numbered by hand; registered by `composer:generate`; ordered
by the module graph (`specs/conventions/module-migrations.md`). No cross-module DDL or DML, no FK.

1. `catalog` — `pnpm --filter backend run migration:new -- --module catalog --name order_rules` —
   `products.min_order_quantity` (+ range check), `products.returnable` (default `false`),
   `product_packaging_units.min_order_units` (+ range check).
2. `carts` — none: the exemption reads the existing `cart_items.agreed_quantity` (`data-model.md` §2,
   R4).
3. `orders` — `--module orders --name order_item_returnable_at_purchase`.
4. `quote_requests` — `--module quote_requests --name item_packaging_unit_id`.

Each `down` drops what its `up` adds.

## Risks

| Risk | Mitigation |
| --- | --- |
| A path into the basket is missed | The spec's entry-point table is the checklist; SC-001 is proven per entry point in `[PG]` files; placement re-validates everything (FR-008) as the backstop, asserted per placement entry point |
| The batch and the single add drift apart on preconditions | One `#resolveLine` shared by both (T043); the existing add-item suites re-run in Phase 6 prove the extraction changed nothing |
| Batch evaluation mis-rejects or is slow | Two-pass rule in a pure unit matrix (`cart-batch-add.test.ts`); linear rule with performance cases at 200 × 200 and at the 10 000-row ceiling |
| Hidden product disclosed by a 422 or a report | Every check sits after resolution; tests assert the unknown-id answer, with no name or minimum, on every batch path and on quote writes (FR-035) |
| A quote line stays exempt after its quote stopped being valid | The exemption is decided by `orders` after the vouch with its lock, plus the validity rule (R19); five invalidity cases and the `quote_requests`-off case are tested |
| Longer advisory-lock hold at placement | Only for baskets carrying a quote mark; lock order proven against inventory row locks (I7) |
| Record/port additions red unrelated test doubles | Measured: 5 port literals in 3 files, 7 record literals (T026); `CartWritePort` doubles are casts and red at runtime only, measured in T052a |
| Error-code ledger reds (`error-code-routing-equality`) | Each code lands with ledger, manifest, both bundles and the regenerated module reference in one commit (T035, T095) |
| Stale generated artefacts (registries, package manifests, module reference pages, Polish mirrors) | `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` in every phase that adds a migration, a code or touches a manifest; Polish cache entry + materialised page refreshed in the same commit |
| `RfqDetail.tsx`, `ProductEditor.tsx` and the returns pages on the `i18n:hardcoded` ratchet | All new admin strings through `useTranslation`; storefront strings through `messages.ts`; the gate runs the check |
| `returns` storefront pages carry pre-existing hard-coded English | Only strings this feature adds or changes move to `messages.ts`; the rest is logged as a deferred defect |
| macOS host gives false reds/greens on four gate steps | Phase 20 runs them in Docker (`ubuntu:24.04`, `node:22.18-slim --init`) as `tasks.md` § *macOS host routing* describes |
| The development host runs out of memory | `pnpm -r` only in Phase 20; per-package typechecks and one `[PG]` file per invocation everywhere else |
| The PR is red on a workflow no local phase ran | Phase 20 runs `quality.yml`'s jobs; Phase 21 runs `pack-gate`, `boot-gate`, `build:docs`, `dco` |

## Security threat model — disposition

The security engineer's threat model (new validation rules on buyer paths) returned findings F1–F7
and F12 as stated below; the spec's threat-model clarification turned F1–F6 into FR-035 – FR-038 and
the amendments of FR-001, FR-002, FR-026; P3 turned F7 into FR-033. The design candidates S1–S9 were
the plan's own, written before the review.

**Design candidates S1–S9:**

| # | Threat | Disposition | Design answer | Tasks |
| --- | --- | --- | --- | --- |
| S1 | Client bypasses the storefront floor and posts below the minimum | Mitigated | Every check is server-side; the storefront mirrors only | T039, T078 |
| S2 | A minimum refusal discloses a product hidden from the buyer or outside the channel | Mitigated, extended by F1 | Checks after the existing 404s on single paths; on batch paths after the shared resolver (R8) | T039, T077, T078 (+ F1) |
| S3 | A buyer reaches `minimums: 'warn'` | Mitigated | In-process option only; the HTTP body schema has no such key and strips it | T006, T078 |
| S4 | A buyer forges the quote-line exemption | Mitigated | `agreed_quantity` is written only by `replaceItemsForCustomer` from an accepted quote; no route accepts it; at placement the source is vouched (F2) | T040, T056a |
| S5 | A buyer forges a packaging label on a quote line | Mitigated | FR-026 resolution; name/base only accepted when they match a catalogue unit | T077 |
| S6 | A buyer opens a `return` case for a non-returnable line by calling the API | Mitigated | `createCase` refuses from the recorded value read through the ownership-checked port | T091 |
| S7 | `minimumWarning` leaks to the customer | Mitigated | Customer serialisation is an allow-list; contract test | T083 |
| S8 | Draft page fan-out used for load | Mitigated | Bounded concurrency (8), distinct slugs, at most the draft's 200 lines | T127 |
| S9 | Concurrent edits leave a below-minimum basket | Mitigated | Cart checks take no lock; placement re-validates inside its transaction before any side effect; quote baskets serialised by the advisory lock (R19) | T056, T056a |

**Security engineer's findings:**

| # | Severity | Finding | Disposition | Design answer | Tasks |
| --- | --- | --- | --- | --- | --- |
| F1 | High | Batch paths evaluated minimums on lines that never passed `addItem`'s visibility / channel / unit checks, so a hidden product could be reported "below minimum" with its name and minimum | Fixed (FR-035) | `#resolveLine` shared by `addItem` and `addItems`; resolution before evaluation; unresolved lines get the unknown-id answer and count toward no total; quote → cart maps a 404 to `not_purchasable`, list → cart to `product_not_found` (R8, R12) | T043, T048, T049, T057, T067, T068 |
| F2 | High | Placement honoured the basket's quote mark at face value; a cancelled, expired, already-ordered or emptied quote kept its lines exempt | Fixed (FR-036) | The vouch and its lock move to right after the basket read; exemptions honoured only when `judgeQuoteRequestSource` accepts and the validity has not lapsed; the preview uses the read-only twin (R19) | T056a, T056b, T056c, T059a, T060 |
| F3 | Medium | The placement check's position and coverage were unspecified relative to side effects and entry points; a missing product record read as "no minimum" | Fixed (FR-037) | Check inside the transaction after the vouch, before the value gate, business id, stock and credit; fail-closed `product_unavailable`; one assertion per entry point (checkout, one-click, admin create, API intake, port) | T056, T057, T059, T067 |
| F4 | Medium | Unbounded batch inputs and a quadratic fix-point | Fixed (FR-038) | 200-item bound refused first by the quick-order build and admin create/preview services (422); import rows clamped to 10 000; linear rule, two-pass batch; performance cases (R6.1, R8, R20). API intake covered by the same bound (owner ruling 2026-10-16) | T003, T005, T048, T057a, T063b, T064, T066, T067 |
| F5 | Medium | No upper bound on minimums; the packaging port bypasses route validation | Fixed (FR-001, FR-002) | 1…1 000 000 in the schemas, the services (`isValidOrderMinimum`) and the column checks (R9) | T003, T004, T013, T028, T029 |
| F6 | Low | Distinct reasons for "unknown id" and "another product's unit" form an enumeration oracle | Fixed (FR-026) | One external reason `unknown_unit`; detail logged only (R10, R13.1) | T075, T077 |
| F7 | Medium | A return request naming one order line twice passes the per-entry remaining-quantity check | Fixed (FR-033, SC-006) | Sum per `orderItemId` before the check, both kinds; entries stored as sent (R14) | T089, T091a, T096a |
| F12 | Low | `listPackagingUnitsByProductIds` applies no policy; a caller passing unvetted ids would enumerate the catalogue | Mitigated by contract | Port doc states the vetted-ids obligation; every consumer's id source is listed (`contracts/catalog-api.md` §5) | T024, T080 |

**Informational findings (no new task unless stated):**

| # | Severity | Finding | Disposition | Instrument |
| --- | --- | --- | --- | --- |
| F8 | Info | State-based exemption: 5 → 6 → 5 regains it | Accepted — owner ruling P2 A, D2 | T040 (#7d) |
| F9 | Info | Forging the exemption through the API | Not possible: cart routes accept only `productId` / `variantId` / `quantity` / `packagingUnitId` (`carts/src/backend/routes.ts:316`, `:332`); the login merge sums into an existing line (which ends its exemption); guest lines are `null`; a reorder seeds `null` (`order-reorder-service.ts:133`). **Rule:** `quoteSeededQuantity` and `sourceQuoteRequestId` stay out of every request schema | T040's `git grep` assertion that only `replaceItemsForCustomer` writes the column |
| F10 | Info | Reaching `minimums: 'warn'` from HTTP | Not possible: `routes.customer.ts:156` passes no options; the create schema strips extras; `patchQuoteRequestSchema` is strict; the default is `'enforce'`. **Rule:** the new `actor` argument (`OrderCloneToQuoteService.clone`, `QuickOrderBuildService.build`) is set only by the route's own code, never from a request body. The admin quick-order build (`routes.admin.ts:90–120`, `orders:write`) creating below-minimum quotes is by design (warn, FR-012) | T006, T078 (body carrying `minimums`), T066 / T086 (actor from the route only) |
| F11 | Info | Refusals at placement, `updateItem` and the cart view name products | Accepted: they name products already in the buyer's own cart — no new information; 404-first matters only where the buyer supplies the id, which FR-035 covers | — |
| F13 | Info | Admin writes of the new fields outside audit | PATCH and packaging write through `updateProductAudited` / `#audited` (`catalog:write`); the bulk path keeps per-product legacy audit with context on both the synchronous and queued paths. **To verify at build:** no `pim_*` sync writer and no product clone sets `minOrderQuantity` / `returnable` / `minOrderUnits` outside an audited write | T028 (queued audit context); T036 + Phase 5 Verification (grep check) |
| F14 | Info | Returns creators and defaults | Confirmed single creators (`createCase`; `order-service.ts:1914`); a line missing from `productById` at placement records `false` (FR-016a fail-closed); existing products default to not returnable (owner P4: bulk action + docs, FR-034) | T090, T090a, T091, T135, T138 |
| F15 | Info | Storefront quote-draft fan-out | Bounded: concurrency 8, ≤ 200 slugs, `localStorage` draft. **Rule:** keep it client-triggered and cached; no new public batch endpoint | T127 |

## Deferred defects (outside this feature)

Logged here (no `specs/deferred-defects.md` in this repository); carried into the PR description.

- **Login merge ignores the packaging unit** — `cart-service.ts:616–620` matches on product and
  variant only, so a pallet line merges into a piece line. Pre-existing, Out of Scope; checkout
  re-validation still holds.
- **Packaging dropped on reorder, quote → cart, accepted quote → basket, order → quote, resubmit** —
  `cart-read-port.ts:85–101`, `cart-conversion-service.ts:209–216`, `rfq-service.ts:933–942`,
  `order-clone-to-quote-service.ts:45–50`, `rfq-service.ts:686–698`. Pre-existing, Out of Scope.
- **Returns storefront pages are hard-coded English** — `storefront/app/(account)/returns/new/page.tsx`
  beyond the strings this feature touches.
- **`resubmit` keeps the packaging suffix in `productName` while dropping the packaging** —
  `rfq-service.ts:690` copies `src.productName` (which carries " (Pallet)") into a line with no
  packaging. Cosmetic; found while measuring.
- **The catalogue bulk edit is not on the Command Bus** — `catalog-bulk-update.service.ts:274` writes
  through the legacy `updateProduct` + `AuditPort.record`; per-product rows exist but outside
  `CommandBus.run` (Principle XIII). Pre-existing; this feature only adds a field to it.
- **Two concurrent return requests for one order line** — `createCase` reads the consumed quantities
  without a lock (`return-case-service.ts:101`, `:238`), so two simultaneous requests can each pass
  the remaining-quantity check. FR-033 closes the single-request split; the cross-request race is
  pre-existing.
- **The provenance stamp ignores the quote's validity** — `judgeQuoteRequestSource` stamps
  `source_quote_request_id` for an `Approved` quote whose `expiresAt` has passed. This feature applies
  the validity rule to exemptions only (R19); whether provenance should follow is a separate decision.

## Complexity Tracking

No constitution violation. Recorded so a reviewer does not have to ask:

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A pure rule function in `@endora-commerce/contracts` | FR-006a must have one implementation across four modules | A `catalog` port adds a round trip and a vocabulary for others' lines; four copies drift (R6) |
| `CatalogProductReadPort.listPackagingUnitsByProductIds` | Batch unit data for the rule and FR-026's name match | The admin packaging port is a write surface; per-id reads cannot match by name (R7) |
| `CartWritePort.addItems` with a shared `#resolveLine` and a two-pass evaluation | Product totals across a batch (D1), the per-line reports of FR-011, FR-035's non-disclosure and FR-038's bound | Per-line `addItem` refuses valid batches; an iterate-until-stable fix-point is quadratic for the same answer (R8) |
| The exemption reads `cart_items.agreed_quantity` | Per-line state-based exemption (P2) that ends by construction | A boolean flag is fail-open and contradicts P2; a column of our own would hold the same value as `agreed_quantity` on every row (R4) |
| `quote_request_items.packaging_unit_id` | Current unit minimum for FR-030; stable identity for pairing | Name re-matching loses renamed units (R5) |
| The vouch moved to the start of placement, lock included | FR-036 must hold at the moment the exemption is granted, before any side effect | Re-checking at the old late position decides after stock and the business id were written (R19) |
| **New runtime dependency** | — | **None.** |

## Open for the owner

Nothing blocks Phase 1. The owner should see, before Phase 8:

Resolved (2026-10-15, coordinator):

- **SC-004** and **US6 #9** — the product owner amends the spec as recommended (SC-004: "…and, for a
  minimum refusal, the minimum"; US6 #9's example reworded); **D8 accepted**.
- **FR-038** stays **422** with the bound enforced in the services (R20).
- **D4, D5, D7, D8, D9, D10**, the **200 / 10 000** bounds, **FR-033 by aggregation** and the
  **validity rule for exemptions only** — confirmed.

- **API intake bound** — ruled **in scope** by the owner on 2026-10-16: task **T063b** (Phase 8a)
  puts the same 200-line service-level bound on `order-api-intake-service.ts` (422 `VALIDATION_FAILED`,
  `too_many_items`), documented in the `mod-orders` changeset as a public API change.

## Hand-off summary for `endora-commerce-dev`

- Work the phases of [tasks.md](./tasks.md) in order; each is sized for one builder spawn (≤ 10
  tasks) and ends with its own **Verification** block, one invocation per line:

  | Phase | Tag | Scope | Tasks |
  | --- | --- | --- | --- |
  | 1 | — | Setup, baseline | T001–T002 (2) |
  | 2 | [backend] | Contracts — the rule, the bounds and every HTTP shape | T003–T012 (10) |
  | 3 | [backend] | Schema — three migrations, entities, generated artefacts | T013–T021 (9) |
  | 4 | [backend] | Catalogue read port and records, typed stubs | T022–T027 (6) |
  | 5 | [backend] | Catalogue writes (range, audit), storefront DTOs, catalogue error codes | T028–T036 (9) |
  | 6 | [backend] | Cart single add / edit / view, shared resolver, quote-line exemption | T037–T046 (10) |
  | 7 | [backend] | Cart batch add, test doubles, quote → cart, cart → quote | T047–T055, T052a (10) |
  | 8 | [backend] | Placement and checkout preview: vouch, exemption validity, fail-closed | T056–T056c, T059, T059a, T060, T063 (8) |
  | 8a | [backend] | Admin create, API intake, admin preview, request bounds | T057, T057a, T058, T061, T062, T063a, T063b (7) |
  | 9 | [backend] | Quick order (file totals, operator warning, bounds) and shopping lists | T064–T073 (10) |
  | 10 | [backend] | Quote requests: packaging resolution, buyer checks | T074–T082 (9) |
  | 11 | [backend] | Quote requests: operator actor, admin warnings | T083–T087 (5) |
  | 12 | [backend] | Returns, orders side: fail-closed stamp, port, off-state | T088, T090, T090a, T092–T094, T097 (7) |
  | 12a | [backend] | Returns policy, refusal, per-line totals (FR-033) | T089, T091, T091a, T095, T096, T096a, T097a (7) |
  | 13 | [admin UI] | Catalogue admin (editor card, packaging, bulk edit) | T098–T105 (8) |
  | 14 | [admin UI] | Quote warning badge, order preview message, quick-order import | T106–T112 (7) |
  | 15 | [storefront] | PDP, product card, comparison | T113–T118 (6) |
  | 16 | [storefront] | Cart, checkout, quick order, lists | T119–T125 (7) |
  | 17 | [storefront] | Quote draft, returns form, order detail | T126–T133 (8) |
  | 18 | [docs] | Off-state re-runs, module docs EN/PL (FR-034), changesets, deferred defects | T134–T140 (7) |
  | 19 | — | OpenAPI baseline, `[PG]` sweep, quickstart walk | T141–T144 (4) |
  | 20 | — | `quality.yml` gate (macOS Docker routing) | T145–T150 (6) |
  | 21 | — | Other PR workflows | T151–T154 (4) |


- Phases 6–7 (`cart-service.ts`, `cart-read-port.ts`), 8, 8a and 12 (`order-service.ts`), 10–11
  (`rfq-service.ts`) share files: build in sequence on one checkout. Phases 13–17 may run in any order
  after Phase 12a; one builder at a time on the primary checkout.
- **Every commit `git commit -s`** (DCO); no AI trailer.
- Contracts first in every phase (Principle II); a failing test before every implementation task
  (Principle III).
- Never place a module test beside `src/manifest.ts`; module tests under `src/backend/**`.
- Rebuild a package after editing it: tests read `dist`, `tsc` reads sources. Test helpers import
  services from `dist`, never from a package's `src`.
- `[PG]` tests: from `backend/`, one file per invocation, with the environment in `tasks.md`
  § *Rules for every phase*. `pnpm -r` only in Phase 20.
- React component tests render inside `<StrictMode>`; a "done" state is set only after the answer
  arrives, and effects clean up.
- Contract tests use per-run unique fixture names and never permanently mutate shared roles.
- After a migration, a new error code or a manifest change: `composer:generate`, `manifests:generate`,
  `pnpm install --lockfile-only`; commit every artefact, including a moved module reference page and
  its Polish cache entry and mirror.
- New error code ⇒ enum + `MINTED_ERROR_CODES` + manifest + both bundles + regenerated reference in
  **one** commit.
- Changesets (`minor`, never `major`): `@endora-commerce/contracts`, `mod-catalog`, `mod-carts`,
  `mod-orders`, `mod-quote-requests`, `mod-quick-order`, `mod-shopping-lists`, `mod-returns`,
  `mod-comparisons`, `mod-search` — each written for the consumer (T138 lists what each names,
  including FR-034's behaviour change).
- Rulings: D2 confirmed by the owner (P2); D1, D3–D10, the bounds and FR-033's aggregation confirmed
  by the coordinator; T063b (API intake bound) ruled in scope by the owner on 2026-10-16.
