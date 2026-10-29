# Implementation Plan: Custom fields as admin list filters, and editing a definition after it is created

**Branch**: `feat/157-custom-fields-list-filters` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/157-custom-fields-list-filters/spec.md` (clarified
2026-10-16; issue #286). Sibling `custom-fields-value-carry` (#287) builds on the editor
delivered here and is not planned here.

## Summary

An operator marks a custom field on Orders, Quote Requests or Sales Opportunities as a list
filter, and the matching admin list offers it, narrowing on the server. An existing definition
becomes editable on `/custom-fields`. The approach, with evidence and rejected alternatives in
[research.md](./research.md):

- **The option is a definition attribute, `listFilter`** (R-1): one boolean column owned by
  `custom_fields`, not a `config` key — the core interprets it, and `config` is documented as the
  host's. Which types offer it is a generic registry marker served by `GET …/entity-types` (R-2).
- **One port does the filtering** (R-4): `custom_fields` publishes `customFieldListFilterPort`,
  which lists a type's filterable fields and turns a request's filters into **one** id-subquery
  condition — one scan of the host table it already binds for its change guards, every key's
  predicate ANDed inside — or refuses, naming the keys (FR-011). Caps of 10 keys and 100 `in`
  values hold at the boundary and again in the port (threat model F-1). Each host ANDs the
  condition into its **own** tenant- and assignment-scoped query, wrapping it in a fresh raw
  fragment per statement (F-2), so visibility can only narrow (FR-012).
- **CRM's operator vocabulary becomes the shared one** (R-6): `customFieldFilterSchema` in
  contracts, with CRM's `OpportunityFieldFilterSchema` re-pointed at the same object. The board's
  predicates are left alone (R-5) because its boolean "No" deliberately differs.
- **Each list offers its fields through a route gated by its own permission** (R-10), so an
  operator with `orders:read` alone gets filters; no new permission code.
- **Quote Requests narrow inside today's whole-set read** (R-9), which satisfies FR-009 at any
  size without pre-empting #317's paging redesign.
- **The Opportunities list follows FR-011a; the board's lane continuation does not** (R-8,
  **spec-confirmed** — FR-011a now states the board mode): `cardValues=true` — sent only by the
  board's *Show more* — keeps card semantics on the shared endpoint. It is a mode switch, never a
  security boundary (F-8).
- **`quote_request` follows its owner module** (R-3, FR-005a): one registry line, the generic
  `ownerModuleId` behaviour `crm` already has.
- **The editor is a dialog with a behaviour block value-carry extends** (R-12); *Save* sends only the
  members that changed (F-6); options apply one action at a time through today's routes, each a
  Command. The block receives the definition being edited, so value-carry can add carry toggles, a
  warning slot in Options and a confirm step before save through additive props.
- **One kit composite and helper set for three lists** (R-13), including the saved-view
  sanitising that keeps a stale saved filter from ever reaching the server (R-14).

No new runtime dependency. One migration (`custom_fields`). One minted error code.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod (backend); React 19 + Vite through `@endora-commerce/admin-kit` (admin) — **no new runtime or dev dependency**
**Storage**: PostgreSQL — one new column `custom_field_definitions.list_filter boolean not null default false` owned by `custom_fields`; no new table; host tables unchanged
**Testing**: Vitest — co-located contracts and `custom_fields` unit tests; `backend/test/{contract,integration}` for routes, the port's SQL against Postgres and the off states; `admin/test/{components,modules}` for the kit and the four pages, every render in `<StrictMode>`; `axe-core` (already an `admin` devDependency since 147) for the editor dialog and the filter controls
**Target Platform**: Linux server (backend) and the admin SPA in evergreen browsers
**Project Type**: web application — monorepo with `backend/`, `admin/`, `packages/`
**Performance Goals**: one cached definitions read per list request; **one** semi-join over the host table's JSONB column per statement however many keys are filtered (≤ 10 keys, ≤ 20 predicates, ≤ 100 `in` values); SC-002's dataset (> one page, ≤ 2 000 matches) answers within the list's current latency envelope
**Constraints**: filters never widen visibility (FR-012); unavailable filters refused, never ignored (FR-011/FR-011a); the board's behaviour and tests unchanged (FR-016, SC-005); no stored value changes on any definition edit (FR-004); `quote_requests` or `crm` off ⇒ their types, definitions and filters absent, data kept (FR-005, FR-005a); no storefront or API-key filter (FR-017)
**Scale/Scope**: 1 column, 1 port, 1 error code, 3 new read routes, 3 changed list routes (+ export), 1 kit composite with 7 helpers and 1 hook, 4 pages changed, 1 module-local dialog, ~25 `core` keys and ~40 `custom_fields` keys × 2 languages, 1 new module docs page and 3 updated ones × 2 languages; 13 phases, 78 tasks (refreshed 2026-10-19: T000 added, T077 – T080 folded into the fork-CI gate)

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | `custom_fields` owns the column, the migration, the registry marker, the port, the predicates, the error code and its sentences. Each host owns its routes, its query and its scope; it reaches `custom_fields` only through the published port (`lazyPort<CustomFieldListFilterPort>`), and the CRM/Orders/Quote Requests modules never read each other. Shared pieces live in `contracts` (shapes, a guard) and `admin-kit` (UI) — packages every module already depends on. |
| **II. API-first** | Pass | Every shape — the filter, the parameter, the field DTO, the port, the failure, the definition attribute, the entity-type flag — is in `packages/contracts/` with its test before any route ([contracts/list-filter-api.md](./contracts/list-filter-api.md)). All additive except the Opportunities list's `custom:` filter rule, which FR-011a mandates and the `mod-crm` changeset announces. |
| **III. TDD (NN)** | Pass | Every implementation task in [tasks.md](./tasks.md) follows the RED test it turns green; § *Requirement → test* maps every FR and SC, including the off-state tests for `crm` and `quote_requests`. |
| **IV. YAGNI, minimal dependencies** | Pass | No dependency. No index (R-16), no composite options endpoint (R-12), no edit page, no lane endpoint (R-8), no custom-field list columns or sorting (out of scope). |
| **V. TypeScript everywhere** | Pass | Zod at every new boundary; the port and failure are plain TS interfaces in contracts, as `CustomFieldValuePort` is. |
| **VI. Naming (NN)** | Pass | Routes kebab-case (`…/custom-field-filters`); column snake_case (`list_filter`); JSON camelCase (`listFilter`, `customFieldFilters`); migration class tail begins with `CustomFields` as `migration:new` produces it; port container name camelCase literal. |
| **VII. SEO, performance** | N/A | Storefront untouched (FR-017). |
| **VIII. English (NN)** | Pass | Code, comments, specs, docs in English; Polish only in bundles and the Polish docs tree. |
| **IX. UI reuse** | Pass | Kit `ModalDialog`, `MultiSelect`, `Select`, `Input`, `Checkbox`, `TouchReorderButtons`, `ReorderAnnouncer`, `Alert`; one new kit composite (`CustomFieldListFilters`) because three lists need it — Complexity Tracking. |
| **X. Queue consumers** | N/A | Nothing asynchronous. |
| **XI. Tenant isolation (NN)** | Pass | No tenant-scoped entity added; `custom_field_definitions` stays `@GlobalEntity()`. The one condition is an id subquery ANDed into the host's scoped statement (Orders' `allowedOrganizationIds`, Quote Requests' visibility/scope passes, CRM's scoped EntityManager) — it can only narrow. The refusal is decided by global definitions, never by rows, so it is no existence oracle. Contract tests run as a sales representative on all three lists. |
| **XII. Sales-channel scoping (NN)** | N/A | No channel-scoped read is added; Orders' channel filter is untouched. |
| **XIII. Command Bus auditing (NN)** | Pass | Every definition and option edit — including the option toggle — runs through the existing `custom_fields` Commands; `snapshotDefinition` gains `listFilter`, and a test asserts the audit entry. List reads write nothing. |
| **XIV. Entity-agnostic extensibility** | Pass | The option is a generic definition capability; the registry marker and the host storage binding are data, not host logic; `custom_fields` knows no list, route, permission or query of any host. `no-entity-capability-logic.test.ts` stays green. |
| **XV. Untouched core / overlay** | N/A | No overlay. |
| **XVI. Command palette** | Pass | No new surface: the editor is a dialog on `/custom-fields` (palette action `open-custom-fields` exists); the three lists keep their entries. |
| **XVII. Operator-toggleable modules (NN)** | Pass | `quote_request` gains `ownerModuleId` (FR-005a): with `quote_requests` off, its definitions are not listed, served, created or edited and nothing is deleted. The three filter-field routes are registered in their hosts' route functions and vanish with them. `custom_fields` is non-deactivatable, so the port is always present. Proved by `entity-owner-presence.test.ts` (both owned types, both axes) and the extended `quote_requests` and `crm` off-state tests. |

**Admin permission manifest** — no new code (FR-019). The new routes reuse `orders:read`,
`rfqs:handle`, `crm:read`; definition writes keep `custom_fields:write`.
`check:action-route-permissions` is unaffected (no manifest action changes).
**Settings module** — nothing configurable is introduced.
**Redis cache invalidation** — no new cache. The definitions cache already fans out on every
committed definition Command (`CustomFieldDefinitionsCache.publishInvalidate`) and the port reads
through it; a toggled option reaches every process within the existing TTL fallback.

## Security (threat model, 2026-10-16 — no Critical or High)

Every finding is applied; research R-17 maps each to its decision and test. The ones that shape
the design:

- **F-1 (Medium, DoS)** — one condition per request (one scan, not one semi-join per key); caps of
  10 keys and 100 `in` values in `customFieldFiltersSchema`, re-applied by the port so the CRM list
  (whose record allows 20 references) cannot exceed them. Backstops are the Orders `pageSize` cap
  and `ORDER_EXPORT_MAX_ROWS` (10 000). **No statement timeout exists in the platform** and none is
  added here (R-16); the Quote Request whole-set read stays uncapped until #317. The expression
  index stays R-16's follow-up.
- **F-2 (Medium)** — hosts wrap the port's `{ sql, params }` in a fresh `raw()` per statement
  (Orders: two count statements and the page; export through the same path; Quote Requests and
  CRM: one each); a contract test holds `counts`, `paymentStatusCounts`, `total` and the CSV row
  count to each other under a filter.
- **F-7 (FR-017's consequence, accepted)** — an operator holding only a list's read permission
  sees the key, labels and options of that type's list-filter fields, `internal` ones included.
  This is no wider than what they already read: each list's admin detail serves the full value
  bag (Quote Requests: `rfq-service.ts:1334-1347`; Orders: `order-response.ts:32`; Opportunities:
  `opportunity-service.ts:208-210`). The offered-field DTO carries no `audience`, `required`, `config`
  or `listFilter`, and `listFilter` reaches no customer-facing projection.
- **F-3, F-4, F-5, F-6, F-8, F-9, F-11, F-13** — parameter shape (arrays refused; RFQ checks before
  parsing and pushes into `$and`), prototype-free key lookups (`constructor` is a valid key),
  text-only rendering with 64-character truncation, changed-members-only `PATCH` (`If-Match`
  deferred to value-carry), `cardValues` documented as a mode switch, bound SQL with no `::date` and no
  jsonb `?` operator, off-state tests on every write route, and the board's reference regex
  (confirmed, `crm.ts:285-287`).

## Project Structure

### Documentation (this feature)

```text
specs/157-custom-fields-list-filters/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R-1 … R-16
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── list-filter-api.md          # Zod, port, routes, error code, FR-011a modes
│   └── admin-surfaces.md           # kit composite + helpers, list pages, editor, keys
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/
├── custom-fields.ts                # + filter schemas, field DTO, port, failure guard, listFilter members
├── custom-fields.test.ts           # NEW
├── crm.ts                          # OpportunityFieldFilterSchema = customFieldFilterSchema; fieldFilters doc
├── orders.ts                       # adminOrdersListQuerySchema + customFieldFilters
└── errors.ts                       # + CUSTOM_FIELD_FILTER_UNAVAILABLE

packages/modules/custom_fields/
├── src/migrations/<stamp>_custom_fields_definition_list_filter.ts   # NEW (scaffolded)
├── src/backend/entities/custom-field-definition.entity.ts           # + listFilter
├── src/backend/services/custom-field-registry.ts                    # + listFilter markers, quote_request owner
├── src/backend/services/host-storage-binding.ts                     # NEW — the {table,column} map, moved
├── src/backend/services/custom-field-list-filter.service.ts         # NEW — the port
├── src/backend/services/custom-field-list-filter.service.test.ts    # NEW (pure predicates)
├── src/backend/services/custom-field-definition-apply.ts, …definition.service.ts, …read-port.ts, …value.service.ts
├── src/backend/commands/definition-commands.ts                      # snapshot + listFilter
├── src/backend/routes.admin.ts, index.ts                            # serialize, entity-types flag, providePort
├── src/admin/pages/CustomFieldsPage.tsx                             # column, edit action, translations, fallback
├── src/admin/components/{DefinitionEditorDialog,DefinitionOptionsEditor,DefinitionBehaviourFields}.tsx  # NEW
├── src/admin/api/custom-fields-client.ts                            # + option calls
├── src/manifest.ts                                                  # errorCodes + docs
├── i18n/{en,pl}.json
├── docs/custom_fields.md                                            # NEW
└── package.json                                                     # files += docs (manifests:generate)

packages/modules/orders/        src/backend/{index.ts,routes.ts,services/order-list-service.ts}, src/admin/pages/OrdersList.tsx, docs/orders.md
packages/modules/quote_requests/ src/backend/{index.ts,routes.admin.ts,services/rfq-admin-service.ts}, src/admin/pages/RfqList.tsx, docs/quote_requests.md
packages/modules/crm/           src/backend/{index.ts,routes/routes.opportunities.ts,services/opportunity-service.ts}, src/admin/{api.ts,pages/OpportunitiesList.tsx}, docs/crm.md

packages/admin-kit/src/components/custom-field-filters/   # NEW — CustomFieldListFilters, helpers, hook
packages/modules/_i18n/i18n/{en,pl}.json                   # + customFieldFilters.*

backend/
├── src/db/migrations-registry.generated.ts               # regenerated
├── scripts/i18n-hardcoded-strings.ts                     # CustomFieldsPage entry drained
├── test/fixtures/error-code-routing/reference-ledgers.ts # + MINTED entry
├── test/fixtures/openapi-baseline.json                   # + 3 routes
├── test/helpers/test-actors.ts                           # + own stub sessions
├── test/integration/custom_fields/{entity-owner-presence,list-filter-option,list-filter-conditions}.test.ts
├── test/contract/{orders,quote_requests}/custom-field-filters.test.ts      # NEW
├── test/integration/crm/list-custom-field-filters.test.ts                  # NEW
└── test/integration/{quote_requests,crm}/off-state.test.ts                 # extended

admin/test/
├── components/{custom-field-filters.helpers,CustomFieldListFilters}.test.tsx                # NEW
└── modules/{orders/OrdersList,quote_requests/RfqList,crm/OpportunitiesList}.custom-field-filters.test.tsx,
    custom_fields/CustomFieldsPage.{editor,list-filter}.test.tsx                             # NEW

docs/docs/architecture/custom-fields.md; docs/i18n/pl/…/{architecture/custom-fields,modules/{custom_fields,orders,quote_requests,crm}}.md;
docs/translation-cache/pl/*.json
.changeset/157-*.md                                        # one per meaning
```

**Structure Decision**: the existing layout; nothing is placed next to a module's
`src/manifest.ts`.

## Migrations

One, scaffolded — never numbered by hand (`specs/conventions/module-migrations.md`):

| Module | Scaffold | Content | Depends on |
| --- | --- | --- | --- |
| `custom_fields` | `pnpm --filter backend run migration:new -- --module custom_fields --name definition_list_filter` | `alter table "custom_field_definitions" add column "list_filter" boolean not null default false`; `down` drops the column | nothing outside `custom_fields` |

Lands with `pnpm --filter backend run composer:generate` and the regenerated
`backend/src/db/migrations-registry.generated.ts` in the same commit.

## Phasing

Thirteen phases, each independently committable and ≤ 10 tasks, detailed in
[tasks.md](./tasks.md). **[admin UI]** phases may be routed to `endora-commerce-designer` for copy,
layout and focus review.

| # | Phase | Kind | Story |
| --- | --- | --- | --- |
| 1 | Shared contracts and the minted error code | backend (shared) | all |
| 2 | `custom_fields`: the `listFilter` attribute and the `quote_request` owner | backend | US3, FR-005a |
| 3 | `custom_fields`: the list-filter port | backend | US1, US2 |
| 4 | Orders backend: list, export, offered fields | backend | US1 |
| 5 | Quote Requests backend and off state | backend | US2 |
| 6 | CRM backend: FR-011a, the board mode, offered fields, off state | backend | US2 |
| 7 | Kit composite, helpers, `core` keys | admin UI | all |
| 8 | Orders and Quote Requests lists | admin UI | US1, US2 |
| 9 | Opportunities list | admin UI | US2 |
| 10 | `/custom-fields` editor | admin UI | US3 |
| 11 | Documentation, en + pl | docs | all |
| 12 | CI gate, part 1: final rebase, generated artefacts, local cheap checks, release intent | gate | all |
| 13 | CI gate, part 2: fork CI (quality, static, unit, frontend, pack, boot, docs, DCO) and the service-backed `ci-pg` run | gate | all |

Dependencies: 1 → all; 2 → 3 → 4, 5, 6; 7 → 8, 9; 4, 5 → 8; 6 → 9; 2 → 10; 8, 9, 10 → 11 →
12 → 13. Phases 4, 5 and 6 are independent of each other once 3 has landed, as are 8–9 and 10.

## Risks

| Risk | Mitigation |
| --- | --- |
| FR-011a applied literally breaks the board's *Show more* (it reads lanes from the list endpoint) | R-8's `cardValues` mode; a contract test for both modes; the board's admin and backend tests run unchanged in Phase 6 and Phase 13 |
| `CustomFieldDefinitionRecord.listFilter` (required) breaks hand-built records in other modules' tests | Phase 1 sweep: the sites that had to add `audience` when it became required are the sites that need `listFilter` (`grep -rn "audience: '"` over `packages`, `backend/test`, `admin/test`); `pnpm -r run typecheck` in Phase 12 |
| `orders` resolves `customFieldValueService` without `custom_fields` in its manifest `dependencies` today; a second resolution may make `check:port-dependencies` ask for it | Phase 4 runs the check; add the dependency only if it reports, and say why in the commit |
| A JSONB predicate is slow on a large host table, or a request asks for many | One scan per statement whatever the key count; caps 10 keys / 100 values at the boundary and in the port; SC-002 sized test; Orders `pageSize` and `ORDER_EXPORT_MAX_ROWS` as backstops (no platform statement timeout exists); R-16 names the expression index as the follow-up, not built speculatively |
| A raw fragment reused across statements answers inconsistent counts | Fresh `raw()` per statement (contract §1.4); T023 holds counts, payment counts, total and CSV rows to each other |
| Service ports differ between the two build machines | Every Postgres-backed command derives its URLs from the root `.env` inline (`tasks.md` standing rule 5, `[PG]` line form); nothing exported, nothing hard-coded |
| Static `…/custom-field-filters` shadowed by `/:id` | One contract test per host asserting the envelope, not a 404 |
| StrictMode double mount leaves the fields hook or the editor busy | Every admin test in `<StrictMode>`; contract `admin-surfaces.md` §1.1 states the alive-flag rule |
| `useAuth` throws without a provider, and the editor/permission gating makes `CustomFieldsPage` call it | The existing `CustomFieldsPage.audience.test.tsx` is wrapped in `AuthProvider` with `custom_fields:write` (no assertion changes), stated in T057 |
| A derived artefact goes stale — migrations registry, error-code ledger, OpenAPI baseline, `HARDCODED_STRINGS_BASELINE`, module docs sidebar, package `files`, lockfile, Polish docs cache, `entity-owner-presence`'s `UNOWNED` | Each is regenerated or edited in the task that changes its input; Phase 12 runs `overlay:check`, `manifests:check`, `check:docs-translations`, `i18n:hardcoded`, `pnpm install --frozen-lockfile` |
| Postgres suites do not run in merge-request pipelines (owner ruling 2026-09-03) | Each phase runs its own `[PG]` files locally; Phase 13 runs every touched or custom-field server-bound file on the fork's service-backed CI |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A new published port, `customFieldListFilterPort` | Three hosts must filter by custom fields server-side and refuse unavailable keys (FR-009, FR-011) | Host-written predicates triplicate six value types' SQL and the availability rule; a pure builder in contracts puts SQL in a browser-compiled package and still needs the definitions port (R-4) |
| A second statement of custom-field predicates beside CRM's board | The list's boolean "No" must not match a missing value (spec edge case); the board's must (FR-016, test at `board-card-fields.test.ts:199`) | Delegating the board to the port changes the board or puts a host mode into `custom_fields` (R-5). The port's predicates are adapted from CRM's, with its type-drift and wildcard cases as tests |
| A new kit composite (`CustomFieldListFilters`) + seven helpers | Three lists need the same controls, address encoding, chips, stale-filter handling and saved-view sanitising | Per-page composition triplicates the stale-filter flow (FR-011, FR-014) — 147's `SavedViewsControl` argument |
| Three small host routes (`…/custom-field-filters`) | Each list must offer fields to operators holding only the list's permission (FR-007, FR-019) | `custom_fields:read` gating denies them; a generic route needs host permission codes in the core (R-10) |
| `cardValues=true` selects board semantics on the Opportunities list endpoint | The board's lane continuation shares the endpoint and must not change (FR-016) | A lane endpoint rewrites pinned board tests (SC-005); refusing regardless breaks the board (R-8) |

No runtime dependency is added.

## Constitution Check — post-design

Re-evaluated after research, data model and contracts, and again after `speckit.analyze` and the
threat model (2026-10-16): **PASS**. No principle is violated; the five complexity entries are
justified above, and the security revisions add no dependency, entity, permission or route.
Nothing is left `[NEEDS CLARIFICATION]`. R-8 (FR-011a applies to Opportunities list requests
without `cardValues=true`; with it the board's card rule governs) is **spec-confirmed**. The
list's boolean *No* matches a stored `false` only (the board keeps "false or never set") — R-5,
confirmed by the product owner 2026-10-16.

## Refresh 2026-10-19

Re-checked against `origin/master` `3d9ca98cd`. The spec and research were read on `fda284a45`, the
plan on `194698a9e`.

**What landed since.** Between `fda284a45` and `194698a9e`: global search contributions
(`specs/150-admin-global-search/` — `orders`/`quote_requests`/`crm` `index.ts`,
`rfq-admin-service.ts` +117, `opportunity-service.ts` +72), the quote PDF template
(`specs/153-quote-request-pdf-template/` — `quote_requests` manifest and `index.ts`) and a
quote-expiry fix. Between `194698a9e` and `3d9ca98cd` (14 commits): sales-channel access PR A
(`specs/154-sales-channel-access/`), newsletter engagement tracking, customer sign-in throttling,
admin grant ceilings. None touches `custom_fields`, `saved-list-views`, `admin-kit`, the CRM board,
the three list endpoints or the Orders export. **No plan step is already done and none is
invalidated**; the threat-model premises (board reference regex `crm.ts:285-287`, no platform
`statement_timeout`) still hold.

**Anchors corrected** (everything else re-verified unchanged):

| Where | Was | Now (`3d9ca98cd`) |
| --- | --- | --- |
| spec.md "Current state" | `quote_requests/src/manifest.ts:186` | `:232` (the `activation` declaration; `:186` is the admin-search contribution) |
| spec.md "Current state" | `opportunity-service.ts:531` (card values) | `:546-556` |
| research.md R-7 | `board-fields.ts:115` | `:91` (`FIELD_PARAM`), read by `readBoardFilters` at `:123` |
| research.md, plan.md § Security F-7 | `opportunity-service.ts:207` | `:208-210` (the value bag in the detail) |
| research.md, plan.md § Security F-7 | `rfq-service.ts:1336-1343` | `:1334-1347` (`quoteCustomFieldValuesFor`) |

`orders/src/backend/routes.ts:604` (T005's double parse) is correct on master.

**Process changes**: T000 (drift check, worktree, renumber sweep) added to Phase 1; per-phase
verification narrowed to the phase's own tests (whole-directory admin runs and the whole
`test/unit/_i18n` / `test/unit/db` directories replaced by named files); the docs build moved from
Phase 11 to the fork CI; Phases 12–13 rewritten for the remote-CI rule (standing rule 12) —
local: rebase, generated artefacts, the checks this feature feeds, release intent, sign-off;
remote: every pull-request job on the fork plus the service-backed `ci-pg` run of every touched or
custom-field server-bound file. Standing rule 6 now says buyers must be assigned to the store they
shop on (feature 154). 78 tasks.

## Overlap with feat/155 (catalog-order-constraints)

feat/155 (`637c6a3a1`, 124 commits on `3d9ca98cd`) and this plan share **no logic**. They share these
files; every overlap is a disjoint hunk or a regenerated/appended artefact:

| File | feat/155 | This feature | On rebase |
| --- | --- | --- | --- |
| `packages/contracts/src/orders.ts` | new schemas at `:370`, `:648`, `:801-847`, `:1250` | one member in `adminOrdersListQuerySchema` (`:493-525` → `:510-542` after feat/155) | auto-merges; re-derive T006's anchor |
| `packages/contracts/src/orders.test.ts` | one hunk at `:112` | appended cases (T005) | auto-merges |
| `packages/contracts/src/errors.ts` | new order/catalog codes | `CUSTOM_FIELD_FILTER_UNAVAILABLE` (custom-field block) | adjacent at worst; keep both |
| `packages/modules/orders/src/backend/routes.ts` | hunks at `:43`, `:334-357`, `:786-1012`, `:1291-1341` | the list route (`:601`), the export route (`:620`), one new route beside them | auto-merges; T005's `:604` → `:607` |
| `packages/modules/orders/src/backend/index.ts` | registration hunk `:882-915` | the port wired into `OrderListService` | small manual merge possible |
| `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` | `modify` at `:679` | `listAll` at `:150` | auto-merges |
| `backend/test/integration/quote_requests/off-state.test.ts` | imports `:21`, a 71-line block at `:217` | T030's offered-fields cases | manual: keep both blocks |
| `backend/test/fixtures/error-code-routing/reference-ledgers.ts` | new `MINTED` entries | one `MINTED` entry | manual: keep both |
| `backend/src/db/migrations-registry.generated.ts` | two migrations (`orders`, `quote_requests`) | one (`custom_fields`) | regenerate with `composer:generate`, never hand-merge |
| `packages/modules/_i18n/i18n/{en,pl}.json` | six keys | `customFieldFilters.*` | adjacent at worst; keep both |
| `packages/modules/orders/docs/orders.md`, `packages/modules/quote_requests/docs/quote_requests.md` (+ Polish pages) | new sections | new sections | manual: keep both |
| `backend/test/helpers/test-server.ts` | two hunks | **not changed** by this plan (read by T019) | none |
| `packages/platform/src/http/error-envelope.ts` | response language resolved once per request (`installResponseLanguage`); token/params step unchanged | **cited only** (`:236` ZodError branch, `:479-484` token and params) | anchors move by +4/+5 lines; behaviour this plan relies on is unchanged |
| `packages/contracts/src/catalog.ts` | product/packaging schemas | **cited only** (`:942` `isFilterable`) | re-derive the line if T000 shows it moved |

**Verdict**: this feature does not have to wait for feat/155. It can branch from `origin/master`
now and rebase over feat/155 in T069 (four mechanical resolutions: the registry, the ledger, the QR
off-state test, the module docs). Stacking on feat/155 buys nothing — there is no code dependency.
`feat/156-asset-stable-url` overlaps only in shared artefacts (`errors.ts`, `reference-ledgers.ts`,
`openapi-baseline.json`, the migrations registry, `module-map.generated.md`), all regenerated or
appended.

## Handoff to `endora-commerce-dev`

- Work the phases of [tasks.md](./tasks.md) in order on `feat/157-custom-fields-list-filters`
  (branched from `origin/master`); commit each phase on its own with `git commit -s`, conventional
  English messages, no AI trailer. Phases 7–10 are admin UI and may go to
  `endora-commerce-designer` for copy, layout and focus review.
- Read first: [research.md](./research.md) R-1, R-4, R-8, R-9, R-12;
  [contracts/list-filter-api.md](./contracts/list-filter-api.md);
  [contracts/admin-surfaces.md](./contracts/admin-surfaces.md).
- Do not touch: the board's `boardFieldFilterConditions`, `BoardFieldFilters`,
  `OpportunityBoardPage.tsx`, or the Quote Request list's client-side status/search/sort/paging
  (#317 owns those).
- After editing any package, rebuild it before running a test that imports it.
- Build in a `git worktree` from `origin/master` (T000). Each phase verifies **only its own new or
  changed tests, the derived-artefact tests its inputs feed, and its `[PG]` files**, locally, in
  `tasks.md` standing rule 5's `[PG]` line form (ports from the root `.env`, copied into the
  worktree; never a hard-coded port). Contract and integration suites do not run before merge
  (owner ruling 2026-09-03), so Phase 13 runs every touched or custom-field server-bound file on the fork's
  service-backed CI (`ci-pg/<branch>`), and the heavy suites — whole-workspace typecheck/lint,
  `test:backend:unit`, `test:frontend`, `quality:static`, `pack-gate`, `boot-gate`, the docs build —
  run on the fork's CI on the pushed tip (standing rule 12). Nothing is routed to a local Docker
  container any more.
- Security revisions are binding, not advisory: the port returns one condition; hosts never reuse
  a raw fragment; key lookups are prototype-free; refused keys render as text (research R-17).
- `custom-fields-value-carry` extends `DefinitionBehaviourFields` (which receives the
  definition being edited) and the editor dialog — carry toggles, a warning slot in Options, a
  confirm step before save; keep every one of those props additive.
