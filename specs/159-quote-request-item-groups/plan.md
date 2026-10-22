# Implementation Plan: Named, reorderable line-item groups on quote requests that carry over to orders

**Branch**: `feat/159-quote-request-item-groups` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/159-quote-request-item-groups/spec.md` — GitHub issue #375;
owner decisions D1–D5 of 2026-10-20 fixed; the owner answered Q-A (**no order PDF** — groups reach the
quote request PDF only; D4 amended) and Q-B (**a grouping-only save is an ordinary revision**) the same
day.

## Summary

An administrator groups a quote request's lines into named, ordered groups — drag and drop, keyboard and
a *Move to group* menu — on the *Modify* tab and the create screen, with a live summary per group; the
customer sees the groups read-only on the storefront; the quote PDF prints them; the order placed from
the quote inherits them; an administrator creating an order groups its lines the same way; orders show
their groups read-only. With evidence and rejected alternatives in [research.md](./research.md):

- **Storage per owning module** (R-5, R-6, R-7): `quote_request_item_groups` + `group_id`/`position` on
  `quote_request_items` (owner `quote_requests`); `order_item_groups` + `group_id`/`position` on
  `order_items` (owner `orders`). `on delete set null` makes D2 structural; `position not null default 0`
  needs no backfill; new entities `@TransitivelyScoped`.
- **One ordering everywhere** (R-6): `CT/line-groups.ts` `arrangeLineGroups` — pure, shared by backend
  readers, admin, storefront and document builders. Fixes today's unordered `serializeFull` read.
- **Groups travel with the line edit** (R-8, R-14): `groups` + `items[].groupKey` on the existing admin
  `PATCH` / `POST`, written in the same row lock and audit entry; a body without `groups` keeps the
  grouping by the existing line pairing.
- **Revisions record the grouping in the line snapshots** (R-10) — no revision migration; history gains
  five change kinds, the customer comparison one (R-11). A grouping-only save is a revision (owner
  answer Q-B, R-9; the silent alternative is recorded as rejected).
- **Summaries are computed, never stored** (R-15): each surface applies its own totals rule to a
  section's lines.
- **Carry-over inside placement** (R-16): the vouched quote source already reads the quote's lines through
  `quoteRequestReadPort.listItems`; the record gains optional `group`/`position`, and a pure
  `carryQuoteGrouping` maps basket lines to quote lines in the placement transaction. No new port method,
  edge or event.
- **Admin order creation** passes a `lineGrouping` option into `placeOrder` (R-17); order groups are
  read-only after placement because order lines are (R-18).
- **PDF** (R-19): collections may declare `sections`; the Line items table's grouping becomes *Document's
  groups* (default for `null`) / *By field* / *None*; per-group heading and the table's own totals rows as
  subtotals. Ungrouped documents render byte-identically.
- **No order PDF** (R-20, owner answer Q-A): orders show their groups on the storefront and admin
  screens only; the facility's `sections` stay generic for any later document type.
- **UI** (R-21): an admin-kit `useGroupedReorder` + `LineGroupsEditor` on the native `useReorderList` idiom
  — **no new dependency**.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, `pdfmake` (backend); React 19 + Vite through `@endora-commerce/admin-kit` (admin); Next.js 15 App Router server components (storefront) — **no new runtime or dev dependency**
**Storage**: PostgreSQL — two new tables (`quote_request_item_groups` owned by `quote_requests`, `order_item_groups` owned by `orders`), two columns each on `quote_request_items` and `order_items`, two migrations; new optional keys in the existing `quote_request_revisions.items_snapshot` jsonb; table grouping settings inside the existing `document_templates.content` jsonb
**Testing**: Vitest — co-located `*.test.ts` in `packages/contracts/src`, `packages/modules/{quote_requests,orders,document_templates}/src/**`; `backend/test/contract/{quote_requests,orders,document_templates}/`; `backend/test/integration/{quote_requests,orders}/`; `backend/test/perf/quote_requests/`; `admin/test/components/` and `admin/test/modules/{quote_requests,orders,document_templates}/` (`<StrictMode>`, `axe-core`); `storefront/test/{rfq,account}/`
**Target Platform**: Linux server; admin SPA and storefront in evergreen browsers
**Project Type**: web application — monorepo (`backend/`, `admin/`, `storefront/`, `packages/`)
**Performance Goals**: save of a 200-line, 20-group quote p95 < 1 s (SC-005) — one extra insert/update batch of ≤ 50 group rows inside the existing lock; reads add one indexed query per document; PDF within 153's 5 s budget
**Constraints**: ≤ 50 groups per document; names 1–120 chars; no customer write path; ungrouped documents byte-identical on every surface (SC-004); grouping writes atomic with the document write; WCAG 2.2 AA with a non-drag alternative for every move
**Scale/Scope**: contracts (1 new file, 3 extended); admin-kit (1 hook, 1 component); `quote_requests` (1 entity, 1 migration, 2 services + revision/history, 2 admin pages + history, document data/sections/sample); `orders` (1 entity, 1 migration, placement + admin creation + serializer, 2 admin pages); `document_templates` (sections + grouping modes in renderer, schema, descriptor, editor, canvas); storefront (1 component, 2 pages, 2 API types, messages); docs (3 module pages × 2 languages)

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | Each module owns its document's groups (tables, entities, migrations, services, routes, bundles, docs, tests). Cross-module: `orders` reads quote grouping only through the existing `quoteRequestReadPort` record (optional fields); `document_templates` learns sections through the existing collection declaration; the shared editor is an admin-kit primitive. No table read or write across modules, no cross-module FK, no new `dependencies` entry. |
| **II. API-first** | Pass | `CT/line-groups.ts` (new) and additive changes to `CT/quote-requests.ts`, `CT/orders.ts`, `CT/document-templates.ts` land first (Phase 2). All additions are optional or defaulted — not breaking; OpenAPI baseline re-recorded. |
| **III. TDD (NN)** | Pass | [tasks.md](./tasks.md) puts a failing test before every implementation task; § *Requirement → test* maps every FR/SC. |
| **IV. YAGNI & minimal deps** | Pass | No new dependency (R-21 rejects `@dnd-kit/sortable`); no setting, permission, cache, event or error code; summaries not stored; no revision migration. |
| **V. TypeScript** | Pass | Zod at every route body, on stored table settings, and on document data. |
| **VI. Naming (NN)** | Pass | `quote_request_item_groups`, `order_item_groups`, `group_id`, `position`, `itemGroups`, `groupKey`, `arrangeLineGroups`, `useGroupedReorder`, `LineGroupsEditor`; migration classes `Migration…QuoteRequests…` / `Migration…Orders…` from the scaffolder. |
| **VII. SEO, performance** | Pass | Storefront pages stay server components; one indexed read added per page; SC-005 bench. |
| **VIII. English (NN)** | Pass | Polish only in bundles, `messages.ts`, the per-language PDF text maps and the Polish docs tree. |
| **IX. UI reuse** | Pass | Built on `useReorderList`'s idiom, `ReorderAnnouncer`, `TouchReorderButtons`, `DropdownMenu`, `Input`; one kit component serves three screens and two read-only views. |
| **X. Queue consumers** | N/A | All work is request-bounded. |
| **XI. Multi-tenant isolation (NN)** | Pass | New entities `@TransitivelyScoped` to their org-scoped parents; every read/write goes through the parent's existing visibility (sales-rep scope, customer scope, order access); out-of-scope = 404 indistinguishable from missing; cross-organisation tests in Phase 3 and Phase 6. No "no-organization" path. |
| **XII. Channel scoping (NN)** | Pass | No channel-scoped read is added; the quote PDF keeps 153's channel-scoped template resolution. |
| **XIII. Command Bus (NN)** | Pass, with note | Grouping is written only inside existing audited writes (`quote_request.modify`, `quote_request.create_on_behalf`, `order.place_on_behalf`), co-transactionally, with the grouping's shape in before/after — no new write path, no double audit (R-22). `quote_requests`' line writes predate the bus (hand audit through `recordAuditFromContext`); migrating `modify` is the module's own Command Bus migration, not this feature. |
| **XIV. Entity-agnostic extensibility** | Pass | Groups are a structural feature of documents, not "add a field"; the facility stays opaque (sections are host-declared data). |
| **XV. Overlay** | Pass | An overlay document type can declare `sections` and gets grouped tables; nothing in core is edited per deployment. |
| **XVI. Palette** | Pass | No new admin surface; grouping lives on screens reached by `open-rfq-inbox` / `open-orders`. |
| **XVII. Toggleable (NN)** | Pass | No new edge; carry-over rides the existing `degrades-without` read; off-state tests: facility off (screens unaffected, PDFs refused), quote requests off (orders keep groups, placement without carry-over). |

## Project Structure

### Documentation (this feature)

```text
specs/159-quote-request-item-groups/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md  tasks.md
├── checklists/requirements.md
└── contracts/
    ├── line-groups.md          # shared schemas + arrangeLineGroups
    ├── quote-requests-api.md   # admin/customer API, history, read port, PDF data
    ├── orders-api.md           # admin create, placement carry-over, replies
    ├── document-sections.md    # facility sections + grouping modes; quote and order sections
    └── ui.md                   # kit primitive, admin + storefront screens, i18n keys
```

### Source code (repository root)

```text
packages/contracts/src/
├── line-groups.ts (+ .test.ts)                 # NEW
├── quote-requests.ts (+ .test.ts)              # groups on admin bodies/replies, history kinds, read record, doc data
├── orders.ts (+ .test.ts)                      # groups on admin create/replies
├── document-templates.ts (+ .test.ts)          # DocumentItemSection, grouping union, sampleSections
└── index.ts                                    # export line-groups

packages/admin-kit/src/components/
├── reorder/useGroupedReorder.ts                # NEW
├── line-groups/LineGroupsEditor.tsx (+ index)  # NEW
└── index.ts                                    # exports

packages/modules/quote_requests/
├── src/migrations/<stamp>_quote_requests_quote_request_item_groups.ts      # via migration:new
├── src/backend/entities/{quote-request-item-group.entity.ts (NEW), quote-request-item.entity.ts, quote-request-revision.entity.ts}
├── src/backend/services/line-grouping.ts (+ .test.ts)                      # NEW — plan/apply a grouping write (pure planner)
├── src/backend/services/{rfq-admin-service,rfq-service,rfq-revision-service,quote-request-read-port,customer-projection}.ts
├── src/backend/services/history/{history-diff,history-projection}.ts (+ tests)
├── src/backend/document/{data-builder,quote-lines,sample,texts}.ts (+ tests)
├── src/backend/index.ts                         # entity registration
├── src/admin/pages/{RfqDetail,RfqCreatePage,RfqHistory}.tsx
├── i18n/{en,pl}.json   docs/quote_requests.md

packages/modules/orders/
├── src/migrations/<stamp>_orders_order_item_groups.ts                      # via migration:new
├── src/backend/entities/{order-item-group.entity.ts (NEW), order-item.entity.ts}
├── src/backend/domain/quote-line-groups.ts (+ .test.ts)                    # NEW — carryQuoteGrouping, adminLayout
├── src/backend/services/{order-service,order-creation-admin-service}.ts
├── src/backend/order-response.ts
├── src/admin/pages/{OrderCreatePage,OrderDetail}.tsx
├── i18n/{en,pl}.json   docs/orders.md

packages/modules/document_templates/
├── src/backend/rendering/{items-table,document-renderer}.ts (+ tests)
├── src/backend/services/{content-validation,document-template-service}.ts (+ tests)
├── src/admin/blocks/items-table/{GroupingField,canvas}.tsx
├── i18n/{en,pl}.json   docs/document-templates.md

storefront/
├── components/line-groups/GroupedLineRows.tsx                               # NEW
├── app/(account)/quote-requests/[id]/page.tsx   app/(account)/orders/[id]/page.tsx
├── lib/api/{rfq,orders}.ts   lib/i18n/messages.ts

backend/test/contract/quote_requests/line-groups.test.ts                      # NEW
backend/test/contract/orders/admin-create-groups.test.ts                      # NEW
backend/test/integration/quote_requests/line-groups-schema.test.ts            # NEW (schema, FK set null, tenancy)
backend/test/integration/orders/place-order-quote-groups.test.ts              # NEW (carry-over)
backend/test/integration/orders/order-item-groups-schema.test.ts              # NEW
backend/test/perf/quote_requests/grouped-save.bench.ts                        # NEW
backend/test/fixtures/openapi-baseline.json                                   # re-recorded
admin/test/components/useGroupedReorder.test.tsx, LineGroupsEditor.test.tsx  # NEW
admin/test/modules/quote_requests/RfqDetail.groups.test.tsx, RfqCreatePage.groups.test.tsx   # NEW
admin/test/modules/orders/OrderCreatePage.groups.test.tsx, OrderDetail.groups.test.tsx        # NEW
storefront/test/rfq/grouped-lines.test.tsx, storefront/test/account/order-groups.test.tsx     # NEW
docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/{quote_requests,orders}.md (+ document-templates)
.changeset/*.md
```

Regenerated and committed in the same MR: `composer:generate` (migration and entity registries),
`manifests:generate` only if a package body changes, with `pnpm install --lockfile-only` beside it.

**Structure Decision**: no new module — grouping is a property of the quote's and the order's documents,
owned by the modules that own those documents (Principle I, "prefer extending"). Generic pieces go where
the platform already keeps generic pieces: shapes in `contracts`, UI in `admin-kit`, PDF machinery in
`document_templates`.

## Migration plan

| Step | Owner | Mechanism |
| --- | --- | --- |
| create `quote_request_item_groups`; add `group_id` (FK set null), `position` (not null default 0) to `quote_request_items` | `quote_requests` | `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_item_groups`; `composer:generate` |
| create `order_item_groups`; add `group_id`, `position` to `order_items` | `orders` | `migration:new -- --module orders --name order_item_groups`; `composer:generate` |

FKs point only at each module's own tables (`quote_requests` → its own; `order_items` → `orders`' own),
so `fk-dependency-drift` and `check:module-boundary` stay clean. Execution order is derived from the
manifest graph as usual. No backfill (R-6). Both migrations are additive and reversible; `down()` tested
by the migration integration tests.

## Composition (design)

- `quote_requests/src/backend/index.ts`: register `QuoteRequestItemGroup` in the module's entity list; no
  new service registration (the planner is a pure module function used by `RfqAdminService`/`RfqService`).
- `orders/src/backend/index.ts`: register `OrderItemGroup`; nothing else — no new port, hook or edge.
- `document_templates`: no composition change.

## Cross-cutting concerns

| Concern | Design |
| --- | --- |
| Admin permissions | none new: `rfqs:handle` (+ organisation visibility) for quote grouping; `orders:write` for creation |
| Command palette | no new surface and no keyword change |
| pl + en | module bundles (`quote_requests`, `orders`, `document_templates`), storefront `messages.ts`, PDF text maps; docs pl + en |
| Settings | none — no knob requested, no secret |
| Auditing | inside `quote_request.modify`, `quote_request.create_on_behalf`, `order.place_on_behalf` (R-22) |
| Tenancy | `@TransitivelyScoped` entities; parent visibility; cross-organisation tests |
| Redis cache invalidation | none — no cache on these reads (R-25) |
| Module activation | no new edge; off-state tests for `document_templates` and `quote_requests` off |
| Release intent | changesets (minor): `@endora-commerce/contracts`, `@endora-commerce/admin-kit`, `@endora-commerce/mod-document-templates` (states the `grouping: null` meaning change, R-19), `@endora-commerce/mod-quote-requests`, `@endora-commerce/mod-orders` |
| Check estate | `check:naming`, `check:language`, `i18n:hardcoded`, `check:bundle-pairing`, entity tenant classification, `check:module-boundary`, `check:module-docs`, `check:release-intent`; re-record a read size only if the band refuses it (`specs/conventions/check-estate.md`) |

## Owner decisions and what they changed

| Decision | Effect on this plan |
| --- | --- |
| D1 optional groups, ungrouped allowed | ungrouped section last; no-group documents byte-identical (SC-004 tests on every surface) |
| D2 delete never deletes lines; empty groups omitted on PDF/storefront | FK `on delete set null`; admin replies include empty groups, customer replies/PDF/revisions/orders exclude them |
| D3 presentation only; summaries from lines | no price path touched; summaries computed per surface (R-15) |
| D4 (amended by Q-A) storefront quote + order, quote request PDF only, not invoices | US2, US3, US6; no order PDF; invoices untouched |
| D5 carry-over, admin order creation, editability | US4 (R-16), US5 (R-17), read-only after placement (R-18) |
| Q-A answered: no order PDF | the minimal `orders.order` type is not built (R-20 records it as rejected); FR-070 = invoices carry no groups |
| Q-B answered: grouping-only save is a revision | built as the only save path; the silent alternative is rejected (R-9) |

## Requirement → test

| Requirement | Test |
| --- | --- |
| FR-002, FR-011, FR-033, FR-034 (ordering, limits) | `CT/line-groups.test.ts` |
| FR-001, FR-003, FR-009, FR-010, FR-012, FR-013, FR-081, FR-082 | `backend/test/contract/quote_requests/line-groups.test.ts`; `QR/src/backend/services/line-grouping.test.ts` |
| FR-004–FR-008, FR-085 | `admin/test/components/{useGroupedReorder,LineGroupsEditor}.test.tsx`; `admin/test/modules/quote_requests/{RfqDetail,RfqCreatePage}.groups.test.tsx` |
| FR-020–FR-024 | `QR/src/backend/services/history/history-diff.test.ts`, `revision-diff.test.ts`; contract test (accept after regroup) |
| FR-025, FR-026, SC-007 | `backend/test/contract/quote_requests/customer-routes.test.ts` (extended); `QR/…/line-carry-over.test.ts` |
| FR-030, FR-031, FR-033 | `storefront/test/rfq/grouped-lines.test.tsx`, `storefront/test/account/order-groups.test.tsx` |
| FR-032 | `RfqDetail.groups.test.tsx`, `OrderDetail.groups.test.tsx` |
| FR-040–FR-045, SC-004 (PDF) | `DT/src/backend/rendering/items-table.test.ts`, `document-renderer.test.ts`, `CT/document-templates.test.ts`, `admin/test/modules/document_templates/items-table-editor.test.tsx`; `QR/src/backend/document/quote-lines.test.ts` |
| FR-050–FR-053, SC-003 | `OR/src/backend/domain/quote-line-groups.test.ts`; `backend/test/integration/orders/place-order-quote-groups.test.ts` |
| FR-060–FR-063 | `backend/test/contract/orders/admin-create-groups.test.ts`; `admin/test/modules/orders/OrderCreatePage.groups.test.tsx` |
| FR-070 | invoice contract tests unchanged and green |
| FR-083 | `backend/test/integration/quote_requests/off-state.test.ts`, `place-order-quote-groups.test.ts` (quote requests off), `pdf-export.test.ts` (facility off) |
| FR-087 | `backend/test/contract/orders/order-response-schema.contract.test.ts`, read-port test in `line-groups.test.ts` |
| SC-002 | `quote-lines.test.ts`, `line-groups.test.ts` (document totals identical grouped/ungrouped) |
| SC-005 | `backend/test/perf/quote_requests/grouped-save.bench.ts` |
| SC-006 | `axe-core` cases in the admin tests above |

## Complexity Tracking

No constitution violation; **no new runtime or dev dependency**. Choices that add surface:

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Two group tables (one per owning module) | a group has identity across renames and is referenced by lines (R-5) | jsonb on the parent has no referential integrity; a name column merges same-named groups and cannot hold an empty group (D2) |
| `position` on two line tables | groups need a stored order, and lines have none today (R-1) | relying on `created_at` is already nondeterministic within one save |
| A new admin-kit hook + component | two modules' screens need the same multi-section reorder and cannot import each other (R-21) | `@dnd-kit/sortable` is a new dependency; `KanbanBoard` has no order within lanes |
| Facility `sections` + grouping union | existing templates must print groups without edits; same-named groups must not merge (R-19) | field grouping by group name merges groups and has one subtotal |

## Handoff summary for `endora-commerce-dev`

1. Read research R-1–R-3 (facts), R-8, R-14, R-16, R-19, R-21 and the five contracts first. Implement
   **test-first** in `tasks.md` order. `CT` first; `pnpm run build:packages` after editing any package.
2. Phase 2 lands the shared shapes, the two migrations (scaffolded with `migration:new`, never numbered;
   `composer:generate` committed) and the entities — nothing visible yet.
3. Ordering: replace every quote/order line read listed in research R-1 with the
   `(position, createdAt, id)` order + `arrangeLineGroups`; `serializeFull` currently has **no** order.
4. Quote writes: grouping inside `modify`/`createOnBehalf`'s existing row lock and audit; keep the
   pairing rule for clients that send no `groups`. Do not add a separate endpoint (R-8).
5. Placement: extend `#assessQuoteRequestSource` to return the lines it read; write groups inside the
   transaction; never call the quote port twice.
6. PDF: `null` grouping now means *Document's groups*; prove the flat path byte-identical first.
7. Off-states: quote requests off ⇒ placement without carry-over; facility off ⇒ PDFs refused, screens
   unaffected.
8. Owner answers are final: a grouping-only save is an ordinary revision (no `regroup` path), and there
   is no order PDF — do not register an order document type or add an order PDF route.
9. Changesets for the five packages; re-record the OpenAPI baseline; regenerate artefacts; run the
   deletion/derivation traps of `AGENTS.md` (nothing is deleted by this plan). Verify per the final
   phase and walk `quickstart.md` before merge.
