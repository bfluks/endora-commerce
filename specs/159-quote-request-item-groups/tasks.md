---
description: "Task list for 159 — named, reorderable line-item groups on quote requests that carry over to orders"
---

# Tasks: Named, reorderable line-item groups on quote requests that carry over to orders

**Input**: `specs/159-quote-request-item-groups/` — plan.md, spec.md, research.md, data-model.md,
contracts/ (`line-groups.md`, `quote-requests-api.md`, `orders-api.md`, `document-sections.md`, `ui.md`),
quickstart.md
**Tests**: REQUIRED — Constitution III. Every implementation task follows the failing test it turns
green; a test task names the behaviour it must prove **red** first.

**Organization**: shared shapes, storage, ordering and the kit primitive first (Phase 2), then by user
story. MVP = US1 + US2 (P1). Owner answers of 2026-10-20 are built in: a grouping-only save is an
ordinary revision (Q-B), and there is no order PDF (Q-A) — groups reach the quote request PDF only.

## Format: `[ID] [P?] [Story] Description`

Paths: `CT` = `packages/contracts/src`, `AK` = `packages/admin-kit/src`, `QR` =
`packages/modules/quote_requests`, `OR` = `packages/modules/orders`, `DT` =
`packages/modules/document_templates`, `SF` = `storefront`, `BT` = `backend/test`, `AT` = `admin/test`.

---

## Phase 1: Setup

- [X] T001 Confirm the worktree builds and record baselines: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm --filter backend run test:unit:fast`, `pnpm --filter backend exec vitest run BT/contract/quote_requests BT/contract/orders BT/contract/document_templates`, `pnpm --filter '!backend' run test` — all green before any change
- [X] T002 List every read of quote and order lines that must adopt the display order (research R-1, R-6): `grep -rn "find(QuoteRequestItem\|find(OrderItem" packages/modules` — record the sites in the MR description (expected: `rfq-service.ts` ×5, `rfq-admin-service.ts` ×3, `quote-request-read-port.ts`, `document/document-service.ts`, `rfq-expiry-worker.ts` if it reads lines, `order-response.ts`, `order-service.ts`, `order-reorder-service.ts`, `order-clone-to-quote-service.ts`, `order-return-context.ts`)

---

## Phase 2: Foundational — shapes, storage, one ordering, the editor primitive

**⚠️ No user story starts before this phase is complete.**

### Shared contracts

- [X] T003 [P] Write `CT/line-groups.test.ts` — red, every row of `contracts/line-groups.md` §3 plus §1: name trimmed, empty/121-char refused; key regex; 51 groups refused; duplicate keys/ids refused with their paths; a `groupKey` naming no group refused at `items.<j>.groupKey`; `groups` without `items` refused (PATCH variant)
- [X] T004 Implement `CT/line-groups.ts` (`LINE_GROUP_LIMITS`, `lineGroupKeySchema`, `lineGroupNameSchema`, `lineGroupSchema`, `lineGroupInputSchema`, `newLineGroupInputSchema`, `refineLineGrouping`, `arrangeLineGroups`, `flattenSections`) and export from `CT/index.ts` — T003 green
- [X] T005 [P] Extend `CT/quote-requests.test.ts` — red: admin PATCH/POST bodies with `groups`/`groupKey` (valid, every refusal), item `groupId`/`position` defaults (an old reply parses), `itemGroups` default `[]`, the five history change kinds, `QuoteRequestDocumentData.groups` and line `groupId`/`position`
- [X] T006 Implement in `CT/quote-requests.ts` per `data-model.md` §4 and `contracts/quote-requests-api.md` — T005 green
- [X] T007 [P] Extend `CT/orders.test.ts` — red: `adminCreateOrderRequestSchema` with `groups`/`groupKey` and refusals; `adminOrderPreviewRequestSchema` unchanged (a `groupKey` is stripped, not refused); `orderSchema.itemGroups` default; item defaults
- [X] T008 Implement in `CT/orders.ts` per `data-model.md` §5 — T007 green; `pnpm run build:packages`

### Storage

- [X] T009 [P] Write `BT/integration/quote_requests/line-groups-schema.test.ts` — red: table and columns exist with the types, defaults and checks of `data-model.md` §1.3; deleting a group sets its lines' `group_id` to `null` and deletes no line (D2); deleting a quote cascades its groups; legacy rows read `position = 0`
- [X] T010 Scaffold `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_item_groups`, write `up()`/`down()` per `data-model.md` §1.3; add `QR/src/backend/entities/quote-request-item-group.entity.ts` (`@TransitivelyScoped('QuoteRequest', 'quoteRequestId')`), `groupId`/`position` on `QuoteRequestItem`, the optional snapshot keys on `QuoteRequestRevisionLine`; register the entity in `QR/src/backend/index.ts`; `pnpm --filter backend run composer:generate` — T009 green
- [X] T011 [P] Write `BT/integration/orders/order-item-groups-schema.test.ts` — red: `data-model.md` §2.3 shape; set-null and cascade; legacy `order_items` rows read `position = 0`
- [X] T012 Scaffold `migration:new -- --module orders --name order_item_groups`; add `OR/src/backend/entities/order-item-group.entity.ts` (`@TransitivelyScoped('Order', 'orderId')`), `groupId`/`position` on `OrderItem`; register; `composer:generate` — T011 green; run the entity tenant-classification check and `BT/unit/db/migrations-registry.test.ts`

### One ordering everywhere (FR-011)

- [X] T013 [P] Write `BT/contract/quote_requests/line-groups.test.ts` § *ordering* — red: a quote whose lines were written with positions 2,0,1 is answered 0,1,2 by the admin reply, the customer reply, `listItems` and the PDF data; a legacy quote (all `position = 0`) keeps `(createdAt, id)` order
- [X] T014 Adopt `orderBy: { position: 'asc', createdAt: 'asc', id: 'asc' }` + `arrangeLineGroups` at every quote site listed in T002 (`serializeFull`, `modify`, `patchDraft`, `respondToRevision`, `convertToOrder`, `QuoteRequestReadService.listItems`, `QuoteRequestDocumentDataBuilder`); `serializeFull` answers `itemGroups` (admin: all; customer: non-empty) and items in display order; `CUSTOMER_ITEM_KEYS` += `groupId`, `position` — T013 green, `BT/contract/quote_requests/customer-routes.test.ts` still green
- [X] T015 [P] Extend `BT/contract/orders/order-response-schema.contract.test.ts` — red: `itemGroups` (default `[]`) and items `groupId`/`position` in display order on admin, customer and external replies
- [X] T016 Implement in `OR/src/backend/order-response.ts` `serializeShared` (ordered read + groups read + arrange) and adopt the ordering at the other `OrderItem` reads from T002 — T015 green

### The editor primitive (admin-kit)

- [X] T017 [P] Write `AT/components/useGroupedReorder.test.tsx` (`<StrictMode>`) — red: pointer drop on a line inserts before it, on a section's drop area appends; keyboard lift/move/drop/cancel within a section and across a boundary into the neighbour section; groups move by keyboard and never below the fixed section; `moveItemBy`/`moveSectionBy`; every move announced with name, section, position, total; `disabled` turns everything off
- [X] T018 Implement `AK/components/reorder/useGroupedReorder.ts` (reusing `ReorderAnnouncer`) and export — T017 green
- [X] T019 [P] Write `AT/components/LineGroupsEditor.test.tsx` (`<StrictMode>`, `axe-core` light + dark) — red: no group → bare list (no headings); *Add group* focuses the new name; empty name error; delete moves lines to *Ungrouped* in order and announces it; empty group shows the drop hint; *Move to group* menu lists other sections and moves to the end; *Move up/down*; *Ungrouped* last with no controls; `maxGroups` disables *Add group* with its description; `readOnly` renders headings and summaries only; `renderSummary` receives each section's lines
- [X] T020 Implement `AK/components/line-groups/LineGroupsEditor.tsx` (+ `index.ts`, export from `AK/components/index.ts`) on `useGroupedReorder`, `TouchReorderButtons`, `DropdownMenu`, `Input` — T019 green; `pnpm run build:packages`

**Checkpoint**: shapes, tables, ordering and the editor exist; no screen uses them yet; every pre-existing
suite is green (SC-004 baseline).

---

## Phase 3: User Story 1 — Group the lines of a quote request (P1) 🎯 MVP

**Goal**: an administrator creates, renames, deletes and reorders groups and places lines in them on
*Modify* and *Create*, with summaries; saved atomically with the revision.
**Independent Test**: spec US1 *Independent Test*.

### Backend

- [X] T021 [P] [US1] Write `QR/src/backend/services/line-grouping.test.ts` — red, the pure planner `planLineGrouping({ storedGroups, body, pairedRows })`: upsert by `id`, create by `key`, delete unnamed stored groups; positions renumbered per section in body order; no `groups` in body → paired lines keep their stored group, new lines ungrouped, no group deleted (R-14); `groups.<i>.id` of another quote → 422 issue at that path; resulting shape `[{ name, lineCount }]` for the audit
- [X] T022 [US1] Implement `QR/src/backend/services/line-grouping.ts` — T021 green
- [X] T023 [P] [US1] Extend `BT/contract/quote_requests/line-groups.test.ts` § *modify / create* — red: PATCH with groups creates/renames/deletes/reorders and places lines; reply carries `itemGroups` incl. an empty group; totals unchanged vs. the same body without groups (SC-002); delete-group body moves lines to ungrouped (D2); PATCH without `groups` keeps paired lines' groups; `groups` without `items` → 400; foreign group id → 422; outside *Created from admin*/*Pending* → 409 `RFQ_NOT_QUOTED`; stale `If-Match` → 409; POST create with groups; audit entry `quote_request.modify` has `stateBefore.groups`/`stateAfter.groups`; sales rep of another organisation → 404 with no group data (FR-082)
- [X] T024 [US1] Implement in `QR/src/backend/services/rfq-admin-service.ts` `modify` and `createOnBehalf`: run the planner, write groups and lines (`groupId`, `position`) inside the existing `underRowLock` / flush, extend `#audit` before/after — T023 green
- [X] T025 [P] [US1] Extend `QR/src/backend/services/revision-diff.test.ts` and add a `record` case — red: `RfqRevisionService.record` writes lines in display order with `position`, `groupId`, `groupName`, `groupPosition`; only groups holding lines appear; `diffRevisions` returns `{ kind: 'grouping' }` when the shown sections differ and not otherwise; a legacy snapshot (no keys) vs. an ungrouped new one → no `grouping` entry
- [X] T026 [US1] Implement in `QR/src/backend/services/rfq-revision-service.ts` (`toSnapshotLine`, `diffRevisions`, `RfqDiffEntry`) — T025 green
- [X] T027 [P] [US1] Extend `QR/src/backend/services/line-carry-over.test.ts` (or a `patchDraft` case in `BT/integration/quote_requests/line-carry-over.test.ts`) — red: `patchDraft` keeps a paired line's group and section order, new lines ungrouped (R-13)
- [X] T028 [US1] Implement in `QR/src/backend/services/rfq-service.ts` `patchDraft` — T027 green
- [X] T029 [P] [US1] Write `BT/perf/quote_requests/grouped-save.bench.ts` — 200 lines, 20 groups, p95 < 1 s (SC-005)

### Admin

- [X] T030 [P] [US1] Write `AT/modules/quote_requests/RfqDetail.groups.test.tsx` (`<StrictMode>`, `axe-core`) — red: *Modify* seeds groups from `itemGroups` (empty ones included); add/rename/delete/move/reorder; section summaries (count, net, VAT, gross, discount when every line has a reference) recomputed on edit; per-group *Add product* adds into that group, the main control into *Ungrouped*; *Save revision* sends `groups` + `groupKey` in display order (extend the assertions of `RfqDetail.modify-payload.test.tsx`); read-only in *Approved*; *Overview* shows grouped read-only; no group → screens unchanged
- [X] T031 [US1] Implement in `QR/src/admin/pages/RfqDetail.tsx` (`ModifyCard` with `LineGroupsEditor`; *Overview* read-only) and bundle keys of `contracts/ui.md` §4 in `QR/i18n/{en,pl}.json` — T030 green; `pnpm --filter backend run i18n:hardcoded`
- [X] T032 [P] [US1] Write `AT/modules/quote_requests/RfqCreatePage.groups.test.tsx` — red: groups on create, payload shape, product-browser additions land in *Ungrouped* or the chosen group
- [X] T033 [US1] Implement in `QR/src/admin/pages/RfqCreatePage.tsx` — T032 green

**Checkpoint**: US1 complete — quickstart §1 passes.

---

## Phase 4: User Story 2 — The customer sees groups; history and acceptance (P1) 🎯 MVP

**Goal**: storefront quote view grouped read-only; comparison notice; admin history kinds; acceptance
unchanged.

- [X] T034 [P] [US2] Extend `QR/src/backend/services/history/history-diff.test.ts` — red: `group_added`, `group_removed`, `group_renamed`, `line_group` (incl. to/from ungrouped), `line_order` emitted once and only when unexplained; legacy-to-grouped first revision lists `group_added` + `line_group`; group pairing by `groupId`
- [X] T035 [US2] Implement in `history-diff.ts` (and projection plumbing in `history-projection.ts`) — T034 green
- [X] T036 [P] [US2] Extend `BT/contract/quote_requests/customer-routes.test.ts` — red: customer reply `itemGroups` holds non-empty groups only, items in display order with `groupId`/`position`; `comparisonAgainstLastSeen.diff` holds `{ kind: 'grouping' }` with no other key after a regroup; POST/PATCH with `groups` or `groupKey` → 400 (FR-025, SC-007); accept after a regroup revision succeeds (FR-024); resubmit copies no group (FR-026)
- [X] T037 [US2] Implement any remaining customer-reply wiring in `QR/src/backend/services/rfq-service.ts` / `customer-projection.ts` — T036 green
- [X] T038 [P] [US2] Extend `AT/modules/quote_requests/RfqDetail.history.test.tsx` — red: the five kinds render with their bundle sentences in en and pl; `null` side renders as *Ungrouped*
- [X] T039 [US2] Implement in `QR/src/admin/pages/RfqHistory.tsx` + bundle keys — T038 green
- [X] T040 [P] [US2] Write `SF/test/rfq/grouped-lines.test.tsx` — red: `GroupedLineRows` renders heading rows (`scope="colgroup"`), line rows, summary rows by the page's rule (agreed, else desired; every line or none) per section, *Other items* last; empty groups never; no non-empty group → markup identical to the line rows alone (SC-004); `describeDiff` of `grouping`; pl + en strings
- [X] T041 [US2] Implement `SF/components/line-groups/GroupedLineRows.tsx`, use it in `SF/app/(account)/quote-requests/[id]/page.tsx`, extend `SF/lib/api/rfq.ts` types and `SF/lib/i18n/messages.ts` (both catalogues) — T040 green; `pnpm --filter storefront run typecheck`

**Checkpoint**: MVP — quickstart §1–§2 pass.

---

## Phase 5: User Story 3 — Groups on the quote PDF (P2)

**Goal**: sections in the Line items table; existing templates print groups; ungrouped documents
unchanged.

### Facility

- [X] T042 [P] [US3] Extend `CT/document-templates.test.ts` — red: grouping union (null, absent, `sections` with defaults, `none`, legacy field shape with and without `by: 'field'`); `documentItemSectionSchema`; `isValidSectionPartition` (cover once, ascending, contiguous); every stored 153 built-in layout still validates
- [X] T043 [US3] Implement in `CT/document-templates.ts` (`DocumentItemSection`, `sections?` on the declaration, schema union, `isValidSectionPartition`, `sampleSections` on the type detail) — T042 green; `pnpm run build:packages`
- [X] T044 [P] [US3] Extend `DT/src/backend/rendering/items-table.test.ts` — red: **flat path byte-identical** to the pre-feature definition for null grouping and no group section (snapshot of the 153 fixtures); sections mode: heading row (name, item count with `Intl.PluralRules` texts in pl and en), rows, one subtotal row per table totals row over the section summary honouring `visibleWhen`, ungrouped heading from `otherItemsLabel` or the language default, striping continued, `row.number` continuous; `none` → flat; field grouping unchanged; invalid partition → flat
- [X] T045 [US3] Implement in `DT/src/backend/rendering/items-table.ts` (+ facility texts for *Other items* and item counts) — T044 green
- [X] T046 [P] [US3] Extend `DT/src/backend/rendering/document-renderer.test.ts` — red: `sections()` called once per collection per render; throwing `sections()` → flat table + one log line, document not failed; a test-only type declaring sections prints them with no facility change (FR-040, 153 SC-007 pattern)
- [X] T047 [US3] Implement in `document-renderer.ts` — T046 green
- [X] T048 [P] [US3] Extend `BT/contract/document_templates/admin-api.test.ts` (route 2) and `DT/src/backend/services/content-validation.test.ts` — red: `sampleSections` served (empty for the comparison and invoice types); grouping settings validated at save with paths; legacy templates still save — then implement in `document-template-service.ts` / `content-validation.ts` — green
- [X] T049 [P] [US3] Extend `AT/modules/document_templates/items-table-editor.test.tsx` — red: *Grouping* radios (Document's groups / By field / No grouping) write `null`→`{ by: 'sections' }` on option change, the 153 field shape, `{ by: 'none' }`; *Other items heading* and *Show item count*; the no-sections hint; canvas renders `sampleSections`
- [X] T050 [US3] Implement `DT/src/admin/blocks/items-table/{GroupingField,canvas}.tsx` + `DT/i18n/{en,pl}.json` keys — T049 green

### Quote host

- [X] T051 [P] [US3] Extend `QR/src/backend/document/quote-lines.test.ts` and `data-builder.test.ts` — red: data has non-empty `groups` and lines in display order; `sections()` partitions with `quoteSummary` per section (net/VAT/gross null when a section has an unpriced line; discount only where it applies); sum of section nets equals the document net (SC-002); sample has two groups and an ungrouped line
- [X] T052 [US3] Implement in `QR/src/backend/document/{data-builder,quote-lines,sample}.ts` — T051 green
- [X] T053 [P] [US3] Extend `BT/contract/quote_requests/pdf-export.test.ts` — red: grouped quote with the built-in layout and with a pre-feature template both print sections (assert on the render input / docDefinition through the test seam 153 uses); ungrouped quote → same definition as before

**Checkpoint**: quickstart §3 passes.

---

## Phase 6: User Story 4 — The order placed from a quote keeps its groups (P2)

- [X] T054 [P] [US4] Write `OR/src/backend/domain/quote-line-groups.test.ts` — red, `carryQuoteGrouping`: exact match by product+variant+price, fallback by product+variant, duplicate products in two groups each keep their own, unmatched lines ungrouped after the matched ones in basket order, groups receiving nothing dropped, positions renumbered, records without `group`/`position` → no grouping; and `adminLayout` for T060
- [X] T055 [US4] Implement `OR/src/backend/domain/quote-line-groups.ts` — T054 green
- [X] T056 [P] [US4] Extend `CT`-level and `QR` read-port tests (`BT/contract/quote_requests/line-groups.test.ts` § *read port*) — red: `listItems` answers `position` and `group` in display order (FR-087)
- [X] T057 [US4] Implement in `QR/src/backend/services/quote-request-read-port.ts` — T056 green
- [X] T058 [P] [US4] Write `BT/integration/orders/place-order-quote-groups.test.ts` — red: unchanged basket from a grouped accepted quote → order groups/lines identical (SC-003); an added product → *Other items*; a source refused (other org, not approved, already ordered) → no groups, placed; `quote_requests` switched off → no groups, placed (FR-052, FR-083); a later quote change leaves the order alone; the quote port is called once per placement (spy)
- [X] T059 [US4] Implement in `OR/src/backend/services/order-service.ts`: `#assessQuoteRequestSource` returns the lines it read; after `OrderItem` creation write `order_item_groups` and set `groupId`/`position` (basket order for every other order) inside the transaction — T058 green; `BT/integration/orders/place-order-from-quote-request.test.ts` and `quote-request-source-review.test.ts` still green

---

## Phase 7: User Story 5 — Group an order created in the Admin UI (P2)

- [X] T060 [P] [US5] Write `BT/contract/orders/admin-create-groups.test.ts` — red: create with groups → reply `itemGroups` and lines per the request; empty group not created; same product+variant in two groups → 422 `group_conflict` before the basket is touched (the customer's basket unchanged); a refused creation (minimum, method gate) writes no group; `order.place_on_behalf` audit carries `groups`; out-of-scope customer → refused as today; totals equal the ungrouped creation
- [X] T061 [US5] Implement in `OR/src/backend/services/order-creation-admin-service.ts` (validation, `lineGrouping`) and `order-service.ts` (`options.lineGrouping` → `adminLayout`), `OR/src/backend/routes.ts` body schema — T060 green; `BT/contract/orders/admin-create*.test.ts` still green
- [X] T062 [P] [US5] Write `AT/modules/orders/OrderCreatePage.groups.test.tsx` (`<StrictMode>`, `axe-core`) — red: editor around the items table; summaries from the preview lines; payload `groups` + `groupKey`; 422 `group_conflict` shown on the line; no group → page unchanged (existing `OrderCreatePage*.test.tsx` still green)
- [X] T063 [US5] Implement in `OR/src/admin/pages/OrderCreatePage.tsx` + `OR/i18n/{en,pl}.json` (`contracts/ui.md` §4) — T062 green

---

## Phase 8: User Story 6 — Order groups shown read-only (P2)

- [X] T064 [P] [US6] Write `AT/modules/orders/OrderDetail.groups.test.tsx` — red: grouped read-only with summaries; no control changes grouping; legacy order unchanged
- [X] T065 [US6] Implement in `OR/src/admin/pages/OrderDetail.tsx` — T064 green
- [X] T066 [P] [US6] Write `SF/test/account/order-groups.test.tsx` — red: storefront order detail grouped with summaries from `unitPrice`/`taxRate`/`lineTotal`; ungrouped order unchanged
- [X] T067 [US6] Implement in `SF/app/(account)/orders/[id]/page.tsx`, `SF/lib/api/orders.ts` — T066 green

---

## Phase 9: Polish & cross-cutting

- [X] T068 [P] Documentation (en + pl): `QR/docs/quote_requests.md`, `OR/docs/orders.md`, `DT/docs/document-templates.md` and their Polish pages under `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/` — grouping, what customers see, carry-over, admin order groups, the table's *Grouping* setting (FR-086); `pnpm --filter backend run check:module-docs` and `check:docs-translations`
- [X] T069 [P] Off-state sweep: extend `BT/integration/quote_requests/off-state.test.ts` — facility off: grouping screens/APIs unaffected, PDFs refused; quote requests off: existing orders still serve `itemGroups`
- [X] T070 [P] Changesets (minor) for `@endora-commerce/contracts`, `@endora-commerce/admin-kit`, `@endora-commerce/mod-document-templates` (state the `grouping: null` meaning change), `@endora-commerce/mod-quote-requests`, `@endora-commerce/mod-orders` (`specs/conventions/release-intent.md`)
- [X] T071 (nothing to re-record — research N-29) Re-record `BT/fixtures/openapi-baseline.json` for the changed admin/customer/external replies and request bodies; `composer:generate` clean (no diff); `manifests:generate` + `pnpm install --lockfile-only` only if a package body changed
- [X] T072 Checks: `pnpm run check:naming && pnpm run check:language`; `pnpm --filter backend run` each of `i18n:hardcoded`, `check:bundle-pairing`, `check:command-coverage` (the grouping writes sit inside `modify`/`createOnBehalf`/`placeOrder`, which already audit — no new ignore marker), `check:module-boundary`, `check:port-dependencies`, `check:off-state-coverage`, `check:test-ownership`, `check:release-intent`; the entity tenant-classification test; re-record a read size only if its band refuses it (`specs/conventions/check-estate.md`)
- [X] T073 Verify: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter backend run test:unit:fast`, targeted contract + integration suites of `quote_requests`, `orders`, `document_templates`, `pnpm --filter '!backend' run test` (admin, storefront, packages); report failures with output
- [ ] T074 Walk `quickstart.md` §0–§7 end to end — **not walked by hand**: no browser session was available to the implementer. Every step has an
  automated counterpart green on 2026-10-20 (contract/integration suites of `quote_requests`, `orders`,
  `carts`, `document_templates`, `tenancy`; the admin and storefront tests of US1–US6). The PDF heading
  that can close a page (§3.5) is a known limitation accepted by the owner on 2026-10-21 (research N-28). The manual walk is left to the owner

---

## Phase 10: One product on several lines, in different groups (owner decision D6, 2026-10-21)

**Goal**: spec D6, FR-014, FR-015, FR-054 and FR-062 as rewritten — one product and variant on several
lines of a quote or an order, in different groups or in one, through the whole chain; *Split line*.
Research N-31 … N-35. `CA` = `packages/modules/carts`.

### Orders and the basket

- [X] T075 [P] Extend `OR/src/backend/domain/quote-line-groups.test.ts` — red: `carryQuoteGrouping` keeps X×5 in Y and X×3 in Z at one price in their groups whatever the basket order (exact pass on quantity); `planAdminLineGrouping` keeps every request line, no conflict; `adminLayout` lays a split product out by request index and, with a shuffled basket, by quantity
- [X] T076 Implement in `OR/src/backend/domain/quote-line-groups.ts` (`claimInPasses`, `quantity` on both line shapes, `OrderLineGroupingInput.lines` as the request's list) and pass each basket line's quantity in `order-service.ts` — T075 green; drop `OrderService.productDisplayNames`
- [X] T077 [P] Extend `CA/src/backend/services/cart-batch-add.test.ts` — red: `keepRepeatedLines` keeps a repeated product two lines, in request order with increasing creation times, each priced at its own quantity; minimums still on the product total; refused without `replaceExisting`
- [X] T078 Implement `keepRepeatedLines` in `CA/src/backend/services/cart-service.ts` and on `CartWritePort.addItems` (`CT/carts.ts`, type test in `CT/order-minimum-shapes.test.ts`); seed lines a millisecond apart in `cart-read-port.ts` `replaceItemsForCustomer`; order placement's basket read by `(createdAt, id)` in `cart-placement-apply-port.ts` — T077 green
- [X] T079 [P] Extend `BT/integration/carts/seed-bookkeeping.test.ts` (a seed of repeated lines reads back in seed order), `BT/integration/orders/place-order-quote-groups.test.ts` (a split product at one price lands in the right groups, also with the basket re-timed to list it swapped) and `BT/contract/orders/admin-create-groups.test.ts` (one product in two groups and twice ungrouped is created line for line; the layout is the same on every run; the `group_conflict` case removed) — red on the previous build
- [X] T080 Implement in `OR/src/backend/services/order-creation-admin-service.ts`: no conflict check, seed with `keepRepeatedLines` — T079 green

### Quotes

- [X] T081 [P] Extend `QR/src/backend/services/line-carry-over.test.ts` — red: without ids a line pairs with a row of its group and quantity first (group + quantity, group, quantity), `groupId: null` is the ungrouped section, a line saying neither still pairs by position
- [X] T082 Implement the preferences in `QR/src/backend/services/line-carry-over.ts` `pairLines`; pass group and quantity from `rfq-admin-service.ts` `modify` — T081 green
- [X] T083 [P] Extend `history/history-diff.test.ts` and `revision-diff.test.ts` — red: a split product pairs by group whatever the order; a split-off line is an addition beside a quantity change; each entry about a product on several lines names its group (`null` = ungrouped); two swapped groups of a split product are only a grouping change
- [X] T084 Implement `QR/src/backend/services/snapshot-pairing.ts` (shared pairing, `disambiguatingGroupName`), use it in `history-diff.ts` and `rfq-revision-service.ts` `diffRevisions`; `groupName` on the diff entries and the history line reference (`CT/quote-requests.ts`, `CUSTOMER_DIFF_KEYS`) — T083 green
- [X] T085 [P] Extend `BT/contract/quote_requests/line-groups.test.ts` — red: a PATCH line with `splitFromId` keeps the source's proposal and note; the customer sees both lines and a comparison naming each line's group; a `splitFromId` of another quote is a plain new line
- [X] T086 Implement `splitFromId` on `adminPatchQuoteRequestLineSchema` and in `modify` — T085 green
- [X] T087 [P] Storefront: `SF/test/rfq/grouped-lines.test.tsx` — the comparison sentence names the group (`Other items` for `null`); implement in `SF/lib/quote-requests/describe-diff.ts`, `SF/lib/api/rfq.ts`
- [X] T088 [P] Admin History: `AT/modules/quote_requests/RfqDetail.history.test.tsx` — a line reference with `groupName` renders `rfq.detail.history.lineInGroup`; implement in `RfqHistory.tsx` and the `_i18n` bundles (en, pl); `history-bundle-coverage.test.ts` lists the key

### Admin screens

- [X] T089 [P] Write `AT/components/SplitLineDialog.test.tsx` (`<StrictMode>`, `axe-core`) — red: named dialog, half the quantity and the line's section to start, `null` for Ungrouped, out-of-range and off-step quantities refused with the reason on the field, Enter / Escape / Cancel; `splitLineInto` placement
- [X] T090 Implement `AK/components/line-groups/SplitLineDialog.tsx` (`SplitLineDialog`, `canSplitLine`, `splitLineInto`) and export — T089 green
- [X] T091 [P] Extend `AT/modules/quote_requests/RfqDetail.groups.test.tsx` — red: *Split line* into another group and within the line's own; the new line named after the line it came from and sent with `splitFromId`; no split for a line of quantity 1; no axe violation
- [X] T092 Implement *Split line* in `QR/src/admin/pages/RfqDetail.tsx` (`useQuoteSplitLineLabels`, bundle keys `lineGroups.split.*` en/pl) — T091 green
- [X] T093 [P] Extend `AT/modules/quote_requests/{RfqCreatePage.groups,RfqCreatePage.product-browser,price-prefill-queue}` — red: one product added twice, each line priced at its own quantity and sent on its own; the browser and the quick search offer a product already a line; the prefill queue keyed by line; one confirm applied once
- [X] T094 Implement in `QR/src/admin/pages/RfqCreatePage.tsx` and `QR/src/admin/lib/price-prefill-queue.ts` — T093 green
- [X] T095 [P] Extend `AT/modules/orders/{OrderCreatePage.groups,OrderCreatePage.product-browser,OrderCreatePage.catalog-permission}` — red: one product on two lines in two groups with their own quantity and summary; *Split line*; a product already a line offered again; the `group_conflict` test removed
- [X] T096 Implement in `OR/src/admin/pages/OrderCreatePage.tsx` (per-line keys, display-ordered request, per-line preview lookup, *Split line*, no conflict mapping) and `OR/i18n/{en,pl}.json` (`lineGroups.split.*`; `lineGroups.conflict` removed) — T095 green

### Polish

- [X] T097 [P] Spec, contracts (`orders-api.md`, `quote-requests-api.md`, `ui.md`), research N-31 … N-35; documentation en + pl of `quote_requests` and `orders`; changesets
- [X] T098 Verify: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, `test:unit:fast`, the contract and integration suites of `quote_requests`, `orders`, `carts`, `pnpm --filter '!backend' run test`, `check:naming`, `check:language` and the T072 checks — green on 2026-10-21 (190 contract/integration files, 1167 tests; `test:unit:fast` 7655 tests, its one timeout `check-module-boundary.test.ts` green when re-run alone; admin 3317 tests, three timeouts under the concurrent backend run green when re-run alone, two of them the known CRM flakes). `check:docs-translations` asked for the Polish cache entries of the two module pages to be refreshed

## Dependencies & execution order

- **Phase 1 → Phase 2 → stories.** Within Phase 2: T003–T004 before T005–T008; T009–T012 independent of
  T013–T016 except that T014/T016 need the entities (T010, T012); T017–T020 independent of the backend.
- **US1 (Phase 3)** needs Phase 2. **US2 (Phase 4)** needs US1's backend (T024, T026) for realistic data;
  its storefront tasks (T040–T041) can start after T006 with fixture replies.
- **US3 (Phase 5)** needs T006 and T014 (data in display order); the facility tasks T042–T050 can run in
  parallel with US1/US2.
- **US4 (Phase 6)** needs T010–T014; **US5 (Phase 7)** needs T012, T016, T020 and T055 (`adminLayout`);
  **US6 (Phase 8)** needs T016 and T020.
- **Phase 9 (polish)** last.

## Parallel opportunities

- Phase 2: T003, T005, T007, T009, T011, T017, T019 are separate files — all `[P]`.
- After Phase 2: the facility track (T042–T050), the quote track (T021–T041) and the order track
  (T054–T067) touch disjoint modules and can run in parallel; they meet only in T053 (quote PDF).

## Implementation strategy

1. **MVP** = Phases 1–4, **T001–T041** (US1 + US2): representatives group quotes; customers see them
   and accept revisions. Ship-able alone.
2. Add US3 (quote PDF, T042–T053), then US4 + US5 + US6 (orders, T054–T067) — each independently
   testable.
3. Finish with Phase 9 (T068–T074): documentation, off-state sweep, changesets, OpenAPI baseline, checks,
   verification and the quickstart walk.
