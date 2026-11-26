---
description: "Tasks for spec 193 — product visibility rules"
---

# Tasks: Product visibility rules — admin roles by catalogue price, and a configurable website rule

**Input**: `specs/193-product-visibility-rules/` — spec.md, plan.md, research.md (R-n), data-model.md,
contracts/ (ports.md, admin-api.md, events-and-errors.md), quickstart.md.
**Measured against**: `origin/master` `c3e8a8755`. Re-run before each phase:
`git log --oneline c3e8a8755..origin/master -- packages/modules/{catalog,price_lists,sales_channels,admin_users,orders,quote_requests,carts,inventory,import_export} packages/contracts/src packages/platform/src/kernel/sales-channels packages/platform/src/kernel/ports packages/admin-kit/src/components/{product-picker,product-browser} backend/src/db backend/test/fixtures/openapi-baseline.json`.
**Rebased (2026-11-25, after Phase 3)** onto `origin/master` **`26a40f13a`** (#1910, MikroORM 7.2.11 with legacy decorators): entity decorators come from `@mikro-orm/decorators/legacy`; no file this plan cites by line changed in that drift except entity imports (`price_lists` entities, catalog ordering). Phase 4 on is built on MikroORM 7; earlier line citations stay as measured at `c3e8a8755`.
**Conflict note (M8, L2)**: spec 192 (fork branch at `53db5236f`, not merged) also edits
`packages/contracts/src/errors.ts`, `packages/contracts/src/index.ts`,
`backend/test/.../error-code-routing/reference-ledgers.ts`, `packages/modules/_i18n/i18n/{en,pl}.json`,
`packages/modules/carts/docs/carts.md`, `docs/docs/upgrading-an-instance.md` (en + pl — T094's release
and upgrade note must merge there, not overwrite), `backend/test/fixtures/openapi-baseline.json` and the generated
migrations registry (`backend/src/db/migrations-registry.generated.ts`) — files of T003, T004, T008,
T025, T092, T094. Whichever merges
second regenerates the registry and the baseline (never hand-merges) and re-checks the error-code ledger.
**Tests**: required (Principle III). Every implementation task is preceded, in the same phase, by
its failing test task.

Abbreviations: `PVR/` = `packages/modules/product_visibility_rules/src/`, `CAT/` =
`packages/modules/catalog/src/`, `PL/` = `packages/modules/price_lists/src/`, `KSC/` =
`packages/platform/src/kernel/sales-channels/`, `CON/` = `packages/contracts/src/`,
`BT/` = `backend/test/`. Module package `@endora-commerce/mod-product-visibility-rules`.

## Format: `[ID] [P?] [Stream] [Story] Description`

- **[P]** parallel within the phase (different files, no dependency).
- **[A]/[B]** stream (plan.md § *Parallel builders*); no tag = foundation, single stream.
- Owner answers are recorded in spec.md (*Session 2026-11-25 — plan stage*): OQ-A A, OQ-B B, OQ-C A,
  OQ-D A, OQ-E A, OQ-F A, OQ-G 1, OQ-H signed off, I-2 A, I-3 A, I-4 A, plus Q1 A (first
  channel status write after admission exempt), Q2 A (rule keeps the previous price
  evaluation during a designation rebuild), Q3 (admin reorder / clone-to-quote and checkout of a
  converted quote also accept rule-excluded products), H2 A (only the channel-row status counts). No task is pending an owner answer. The
  release of the order checks before spec 192 is **not** decided: the gate stands.
- Threat model: `threat-model.md` (TM-1 – TM-16); mapping at the end of this file.

---

## Phase 1 — Foundation: module, contracts, schema (no behaviour)

- [x] T001 Scaffold `packages/modules/product_visibility_rules/` (package.json, tsconfig, `src/backend/index.ts`
  with empty `registerModule`, `i18n/{en,pl}.json`, `docs/`), mirroring a recent module package
  (`packages/modules/related_payers/`). Register in `pnpm-workspace` globs if needed.
- [x] T002 `PVR/manifest.ts`: id, `activation` deactivatable **default off** (R-3, OQ-C), permissions
  `product_visibility:read`, `product_visibility:manage` (`requires` read), `dependencies`
  [`catalog`, `price_lists`, `admin_roles`, `currencies`, `sales_channels`, `audit_logs`], palette
  action stubs, `errorCodes` (events-and-errors.md §2). Permission labels pl+en in the module's own
  bundle (`module-admin-surfaces.md` item 4).
  *Build note*: id, activation (default off), dependencies and the settings group landed in Phase 1;
  the permissions, the palette action and `errorCodes` landed in Phase 3 with the routes that enforce
  and raise them — the permission inventory refuses a grantable code no gate enforces. `errorCodes`
  grows with each later code's raise site (T004 note).
- [x] T003 [P] `CON/product-visibility.ts` (new) + export from `CON/index.ts`: scope (with an explicit
  `system` member — TM-3), predicate as the union `none | sql | deny` (no `null` — TM-3), rule
  definition with Zod bounds (TM-11), admin API request/response schemas (contracts/ports.md §1, §2, §4;
  admin-api.md §1). Tests first: `CON/product-visibility.test.ts` (rule definition limits, nesting,
  threshold enum, overview shape).
- [ ] T004 [P] `CON/errors.ts`: the ten codes of events-and-errors.md §2; `CON/price-lists.ts`:
  `CatalogueReferencePricePort`, `DesignationStatus`, `CataloguePricesChangedEventSchema`.
  *Build note (Phase 1)*: the `price-lists.ts` half and the spellings (`PRODUCT_VISIBILITY_ERROR_CODES`)
  landed in Phase 1; each code joins `ERROR_CODES`, the manifest and the minted-codes ledger with its
  first raise site (repo convention), and `CHANNEL_MEMBERSHIP_GOVERNED` with the kernel governor (T063).
- [x] T005 Migration 1 (configuration): `pnpm --filter backend run migration:new -- --module product_visibility_rules --name visibility_configuration`
  — `visibility_categories`, `visibility_category_conditions`, `visibility_role_mappings`,
  `catalogue_price_designations`, `product_rules`, `website_rule_attachments` (data-model.md §1;
  role mapping with the `target` column, I-2).
- [x] T006 Migration 2 (derived): `catalogue_price_generations`, `product_catalogue_prices`,
  `variant_catalogue_prices`, `catalogue_price_stale_products`, `website_rule_previews`,
  `website_rule_preview_changes`, `website_rule_admissions`, `website_rule_stale_products` (§2, §3)
  with the indexes listed.
- [x] T007 Entities under `PVR/backend/entities/`; classify each as platform-global in the tenancy
  classification the CI check reads (`specs/conventions/check-inventory.md`).
- [x] T008 Regenerate and commit: `pnpm --filter backend run composer:generate`,
  `manifests:generate`, `pnpm install --lockfile-only`.

**Verification**: `pnpm --filter @endora-commerce/contracts exec vitest run src/product-visibility.test.ts`;
`pnpm -r run typecheck`; `pnpm run check:naming && pnpm run check:language`;
`pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts test/unit/_i18n/registered-bundles-shape.test.ts`;
migration up/down on a fresh test DB (`backend-test-suite.md` § *Which backend test command*).

---

## Phase 2 — `price_lists`: catalogue reference price and change event (R-4, R-6)

- [x] T009 [P] Failing unit tests `PL/backend/services/book-pricing.catalogue-reference.test.ts`:
  fixed profile [base, designated]; designated row wins; designated silent → base (OQ-1 b);
  variant lines (fixed and adjustment of base); zero vs unpriced; sale books excluded.
- [x] T010 [P] Failing integration test `BT/integration/price_lists/catalogue-reference-identity.test.ts`:
  for a channel whose only everyone book is the designated one, `resolve` ≡ `resolveLinePrices`
  (guest, quantity 1) per line, every precedence preset; undesignated ≡ base book.
- [x] T011 [P] Failing test `…/catalogue-designation-status.test.ts`: every reason of
  `DesignationStatus` incl. `not_regular` (sale book), deleted, unbound, re-audienced, window.
- [x] T012 Implement `BookPricing.catalogueReference(...)` and `designationStatuses(...)` in
  `PL/backend/services/book-pricing.ts` (reuse `#listingLines`, `resolve(..., fixedProfile)`, the
  `namedBookPublishability` statement + type check); `PL/backend/services/catalogue-reference-price.ts`
  (port implementation incl. `designatableBooks` and `changeWatermark()` — a durable value read from
  `price_lists`' own tables that moves on every write or status flip that emits the event of T014;
  TM-7 (5); test in T011).
- [x] T013 Register `catalogueReferencePricePort` with `ctx.di.providePort` in `PL/backend/index.ts`;
  JSDoc per composition item 2/8.
- [x] T014 Failing test then implementation: `price_lists.catalogue_prices_changed` emitted once
  per bump by the writer from `PL/backend/services/pricing-generation.ts` `afterBump` path, payload
  mapped from `SurfaceChange` (none → not emitted); status-sweep flip emits
  (`BT/integration/price_lists/catalogue-prices-changed-event.test.ts`).
- [x] T015 [P] Pricing set in the same change (pricing.md): `specs/pricing/current-model.md`
  (consumer + entry point), `worked-examples.md` vectors for the three OQ-1 cases and their test under
  `BT/integration/price_lists/worked-examples/`, `PL` module docs en+pl.
- [x] T016 Changeset for `@endora-commerce/mod-price-lists` and `@endora-commerce/contracts`
  (`release-intent.md`).

**Verification**: `pnpm --filter @endora-commerce/mod-price-lists exec vitest run src/backend/services/book-pricing.catalogue-reference.test.ts`;
`pnpm --filter backend exec vitest run test/integration/price_lists/catalogue-reference-identity.test.ts test/integration/price_lists/catalogue-designation-status.test.ts test/integration/price_lists/catalogue-prices-changed-event.test.ts test/integration/price_lists/worked-examples test/integration/price_lists/listing-prices-batch.test.ts test/integration/price_lists/pricing-surfaces-agree.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`;
`pnpm --filter backend exec vitest run test/unit/docs/pricing-removed-mechanisms.test.ts`.


---

## Phase 3 — Configuration backend (US2; FR-001, FR-010 – FR-014, FR-020 – FR-026, FR-070, FR-071, FR-076, FR-077, FR-086; TM-4, TM-13)

- [x] T017 [P] Failing integration tests `BT/integration/product_visibility_rules/configuration.test.ts`:
  category CRUD, ≥1 condition, inactive currency kept and shown, delete of mapped category refused
  naming roles (FR-013), `platform_admin` mapping refused (FR-022), designation refused for
  non-regular / non-everyone / unbound / wrong-currency / missing book (RQ-1 A, US2-8) but a draft or
  scheduled book accepted and reported not in force, clear → base, ships no categories (FR-014);
  **TM-4 c** is no longer reachable end to end (FR-026 makes every `product_visibility:manage` holder
  unrestricted), so it is kept as defence in depth and tested in T020's unit test with a stubbed scope;
  **FR-060**: a mapping, category, condition or user's-role change applies to that user's next admin
  request (integration case: change, then one request, no sign-in);
  **FR-020 / FR-025 (I-2)**: a role can be mapped to a category **or to `unrestricted`**;
  **FR-026 (OQ-G 1)**: mapping a role holding a self-lifting permission (`*`,
  `product_visibility:manage`, `platform.modules.activate`, `admin_users:manage`) to a category or to
  unrestricted is refused (`409 ROLE_NOT_MAPPABLE`); a mapped role that later gains such a permission
  is reported `unrestricted — mapping without effect` on the overview (re-read on every request; role
  edits in `admin_roles` do not call this module); **FR-086**: overview warns on a mapped or
  fail-closed role holding `audit_logs:read`.
- [x] T018 [P] Failing test `…/configuration-audit.test.ts`: one audit entry per write with actor,
  before, after (FR-070, `audit-state.md`); read permission sees, cannot write (US2-4).
- [x] T019 Commands under `PVR/backend/commands/` (category, role mapping, designation) and
  `PVR/backend/services/visibility-config.service.ts`; designation validation through
  `catalogueReferencePricePort.designationStatus` + `designatableBooks`; the role-mapping Command
  takes a target `{ kind: 'category', id } | { kind: 'unrestricted' }` (I-2) and refuses
  `platform_admin` and every role holding a self-lifting permission (FR-022, FR-026, OQ-G 1).
- [x] T020 `PVR/backend/routes.admin.ts` (admin-api.md §1 config rows) through `ctx.routes`;
  `requireAdmin('product_visibility:read' | ':manage')` as route `preHandler`; every write route
  additionally resolves the caller's own scope and answers `403 FORBIDDEN` unless `unrestricted`
  (TM-4 c, defence in depth). Unit test first: `PVR/backend/routes.admin.config-guard.test.ts` with a
  stubbed `resolveScope` answering `restricted` / `no_category` for a holder of
  `product_visibility:manage` ⇒ every write route `403`, nothing written (M2).
- [x] T021 Overview read: role effects (`unrestricted` / `mapped_unrestricted` / `mapped` /
  `unmappable_unrestricted` / `mapping_without_effect` / `sees_no_products` — FR-023, FR-024, FR-026)
  from `permissionService` + `adminRolePort.list` (TM-4 b: `mapping_without_effect` flags a mapped role
  that gained a self-lifting permission); warning flag on a mapped or fail-closed role holding
  `audit_logs:read` (FR-086 — the only warning); designation statuses;
  served generation; `notApplied: true` is impossible while off (screens absent) — the off-state
  notice lives in the activation texts (T077).
- [x] T022 Audit references (`auditReferenceRegistry`) and history labels pl+en.
- [x] T023 Scheduling hooks: a designation set/clear enqueues a whole rebuild of the currency
  (consumed in Phase 4; until then the job type exists and is a no-op test double).
- [x] T024 Off-state test `BT/integration/product_visibility_rules/off-state.config.test.ts`: routes
  absent while off (deactivated-while-available case), configuration kept, restored on enable
  (`module-activation.md` item 6); **TM-4 d / TM-13**: the module's activation and deactivation each
  leave an audit entry naming the actor in the existing lifecycle ledger (verify; if it does not,
  record a defect for the platform rather than auditing from this module); **FR-077**: no
  configuration route answers while off (it cannot be prepared before the first enable); **FR-076**:
  installing / deploying with the module present and off changes no read, write or membership.
- [x] T025 Contract tests for the config API shapes `BT/contract/product_visibility_rules/config-api.contract.test.ts`
  (incl. the mapping target union and role effects) and OpenAPI baseline update.

**Verification**: `pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/routes.admin.config-guard.test.ts`;
`pnpm --filter backend exec vitest run test/integration/product_visibility_rules/configuration.test.ts test/integration/product_visibility_rules/configuration-audit.test.ts test/integration/product_visibility_rules/off-state.config.test.ts test/contract/product_visibility_rules`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:command-coverage && pnpm --filter backend run check:error-translations && pnpm --filter backend run check:off-state-coverage`;
`pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts`.

---

## Phase 4 — Catalogue-price flags and the admin scope (US1 core; FR-002 – FR-007, FR-060 – FR-062, SC-008; TM-3, TM-7, TM-8, TM-12)

OQ-A **A** (decided): ≤ 60 s targeted, ≤ 150 s catalogue-wide or designation change, line checks exact.

- [x] T026 [P] Failing integration test `BT/integration/product_visibility_rules/catalogue-price-flags.test.ts`:
  SC-001 matrix (4 categories × 5 price states + configurable product) from real price books;
  generation swap on designation change; targeted refresh after a row write; zero vs none; **TM-7**:
  (1) a price change landing between the refresh's engine read and its write keeps its mark;
  (2) a targeted refresh racing a swap never writes into the swapped-away generation;
  (3) marks taken while n+1 builds are applied to n+1 after the swap; (6) a crashed or partial build is
  never swapped and restarts; **Q2 A**: during a designation rebuild the served (previous) generation
  stays readable for the website-rule evaluator while admin scopes drop the currency.
- [x] T027 `PVR/backend/services/catalogue-price-flags.ts`: build generation (batches of 1 000 via
  `catalogueReferencePricePort.resolve`), swap only after a complete build, targeted refresh in one
  transaction holding the generation row lock (reads `served_generation` inside it), clear only marks
  with `marked_at` earlier than the refresh's read start, keep marks across a build and re-apply after
  the swap, delete of the old generation (data-model.md §2, R-5, R-17).
- [x] T028 `PVR/backend/workers/catalogue-price-flags-worker.ts` via `ctx.worker` (BullMQ, idempotent,
  `enterSystemScope`); **TM-12** coalescing: one running + one queued rebuild per currency
  (deduplicated job ids), mark batches deduplicated.
- [x] T029 Subscriber (`ctx.subscribe('price_lists.catalogue_prices_changed', …)`) → marks / whole
  rebuild per R-6. **TM-12**: payload parsed with `CataloguePricesChangedEventSchema`, treated as a
  **hint** only (no amount or flag ever copied from it), arrays over the cap (1 000 ids) degrade to a
  whole-currency rebuild. **TM-7 (5)**: the mark is written durably before the handler returns. Test
  `BT/integration/product_visibility_rules/flags-change-feed.test.ts` (targeted ≤ 60 s; catalogue-wide →
  rebuild; malformed / oversized / spoofed payload ⇒ only a rebuild, never a flag value).
- [x] T030 Drift poll (**TM-7 (5)**): each build and refresh records the `price_lists` change
  watermark it consumed; a repeatable job every 2 minutes compares it with the current one
  (`catalogueReferencePricePort.changeWatermark()`, T012 — contracts/ports.md §3) and enqueues a whole
  rebuild of the designated currencies when it moved without a matching mark; nightly rebuild stays the last
  resort. Test `…/flags-drift.test.ts` (an announcement dropped ⇒ corrected ≤ 2 min + build time).
- [x] T031 First-enable / re-enable bootstrap: on presence change to on (boot-time check of
  `catalogue_price_generations`), enqueue a build of every active currency; until a currency has a
  served generation its conditions are not met (fail-closed). Test in `…/flags-bootstrap.test.ts`;
  **off state (M3)** in `…/off-state.flags.test.ts`: module off ⇒ subscriber, drift poll and flags
  worker do not run (jobs left waiting), tables kept; on again ⇒ build enqueued.
- [x] T032 [P] Failing unit tests `PVR/backend/services/admin-visibility-scope.test.ts`: scope per role
  (platform_admin; each self-lifting permission ⇒ unrestricted even when mapped — FR-026, OQ-G 1;
  mapped to `unrestricted` — FR-025; mapped to a category; unmapped with `rfqs:handle` and no
  self-lifting permission ⇒ `no_category`; unmapped other ⇒ unrestricted — FR-021 – FR-023); designation not in force drops its currency; inactive currency drops; **TM-7 (4)** a
  currency whose served generation was built for another designation than the current one drops;
  predicate union `none` / `sql` / `deny` (**TM-3 (3)**, no `null`); **TM-3 (4)** a role-resolution
  refusal, an unreadable mapping or designation read gives `no_category` or throws — never
  `unrestricted`; **TM-8** identifier allow-list (`"alias"."column"` only, anything else throws),
  every fragment's `?` count equals `params.length`, no literal but constants; `checkLines` +
  `noFixedPrice` truth table (FR-043).
- [x] T033 `PVR/backend/services/admin-visibility-scope.ts`: `resolveScope` per request (role via
  `permissionService.resolveRole`, mapping, `designationStatuses`, active currencies via
  `currencyReadPort`, served-generation snapshot check), never catches; `productPredicate`,
  `variantPredicate`, `filterVisible`, `checkLines` (live, R-8); `systemScope()` constant for
  storefront / connector / system callers (**TM-3 (1)**). Every consumer applies `designationStatuses`
  at read time — flags and `resolve` answer the designation as if in force (R-4).
- [x] T034 Register `adminProductVisibilityPort` with `ctx.di.providePort` (JSDoc: owner-off sentence
  for `degrades-without` consumers; "embed the fragment inside parentheses with its params in order";
  no cross-request cache of scope or fragments — TM-8).
- [x] T035 Perf bench `BT/perf/product_visibility_rules/admin-list-visibility.bench.ts` (R-16; 50 000
  products, 150 000 variants, 3 currencies): rebuild time per currency, targeted refresh latency,
  predicate cost in isolation; **SC-008**: at 50 000 products a targeted change is reflected in admin
  reads ≤ 60 s and a catalogue-wide / designation change ≤ 150 s, with no product qualifying only
  through the rebuilding currency shown meanwhile (asserted). Record numbers in research.md R-5/R-16.

**Verification**: `pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/services/admin-visibility-scope.test.ts`;
`pnpm --filter backend exec vitest run test/integration/product_visibility_rules/catalogue-price-flags.test.ts test/integration/product_visibility_rules/flags-change-feed.test.ts test/integration/product_visibility_rules/flags-drift.test.ts test/integration/product_visibility_rules/flags-bootstrap.test.ts test/integration/product_visibility_rules/off-state.flags.test.ts`;
`pnpm --filter backend run check:subscribe-seam && pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:module-boundary && pnpm --filter backend run check:queue-names`;
`PERF_RUN=true pnpm --filter backend exec vitest run test/perf/product_visibility_rules/admin-list-visibility.bench.ts` (recorded, not CI).

---

## Phase 5a — [A] Catalog admin reads and writes (US1; FR-030 – FR-036, FR-038, RQ-3 A; TM-1, TM-3, TM-5, TM-6)

Stream A owns `packages/modules/catalog/**` and `PL/backend/services/price-book-reads.ts`.

- [x] T036 [P] [A] Failing contract test `BT/contract/catalog/visibility-route-inventory.test.ts`
  (**TM-1, TM-5**): derive **every** registered `/api/v1/admin/catalog/**` route from the app;
  each is either exercised or on an allow-list of routes proven product-free (the allow-list is in the
  test, reviewed). For each product-bearing route and method: a hidden product (and a hidden variant)
  answers exactly as a random non-existent id — full envelope (status, `error.code`, message,
  `details` shape, headers other than request id) — and writes nothing, for each request shape (valid
  body/query, schema-invalid body, schema-invalid query, semantically invalid body, non-UUID id,
  HEAD/OPTIONS); a **spy pre-interceptor** registered on a product route is **not invoked** for a
  hidden id; bulk-operations list / detail / undo (`CAT/backend/routes.admin.ts:479-560`) included;
  unrestricted unchanged. Price-book and SEO edits outside `catalog` unaffected (FR-038, US1-10).
  *Build note*: the route table comes from the OpenAPI document; `PRODUCT_FREE` and `COLLECTION_ROUTES` (each naming the test that covers it) are two-way. Bulk-operation list / detail / undo are held in T042's test (named there), price-book / SEO edits (FR-038) in T044's. Answers are compared with the ids the caller sent masked (a route echoing its own id tells nothing).
- [x] T037 [P] [A] Failing integration test `BT/integration/catalog/visibility-list.test.ts`: list both
  branches, `total`, `counts` (incl. early-empty return), paging 30/12 → pages 10 + 2 (US1-4, SC-002),
  `resolve-ids`, `batch-by-id`, `/variants`, `visibility` flag and no-category message (US1-6, US1-11),
  admin global search incl. `hasMore` (FR-034); platform admin and unrestricted **byte-identical**
  responses to a module-absent run (SC-003); a restricted user's PATCH / scoped-values / bulk write on
  a visible parent leaves non-qualifying variants unchanged (US1-12); **TM-6**: product detail's
  variant-derived aggregates (variant count, axis/option value lists, stock totals, price ranges,
  media) computed from visible variants only; a payload naming a hidden variant id answers as that
  route answers a non-existent id; option/axis changes never regenerate or delete hidden variants;
  list responses carry `Cache-Control: private, no-store` with the module on, off **and absent from
  the composition** (FR-036, L5,
  TM-14); **FR-079** (admin side): no visibility rule ever resurfaces an inactive, archived or deleted
  product on any admin read (each state × restricted / unrestricted). The governed-channel side of
  FR-079 is stream B's (T055, T056, T068 — N5).
  *Open*: the Cache-Control case "absent from the composition" is not tested (on and off are); the header is set unconditionally by the route.
- [x] T038 [A] `CAT/backend/index.ts`: resolve `adminProductVisibilityPort` per request behind
  `effectiveState.isPresent('product_visibility_rules')` (absent ⇒ `systemScope`-equivalent
  `unrestricted`; present and throwing ⇒ propagates, **TM-3 (4)**); `CAT/manifest.ts`
  `nonBindingDependencies` entry kind `degrades-without` with `whenAbsent` + reason.
- [x] T039 [A] `CAT/backend/services/catalog-admin.service.ts`: the scope is a **required** parameter
  of the named type (`AdminProductReadScope`, incl. the `system` member) on every read and write the
  admin routes use — `listProducts` (restricted ⇒ statement branch), `#adminListFilters`,
  `#productListCounts`, `resolveProductIds`, `listProductsByIds`, `listVariants`, product detail and
  its variant aggregates (FR-031, TM-6), writes through the parent merge hidden variants back untouched;
  an architecture test `CAT/backend/services/admin-scope-required.test.ts` fails on a call site that
  omits it (**TM-3 (1)**); `Cache-Control: private, no-store` on the list routes **regardless of the module's state** (FR-036,
  TM-14).
  *Build note*: the admin product detail carries no variant-derived aggregate (only `GET …/variants` lists variants), so TM-6 is held on that list; no admin route regenerates variants from options. Scope type is `AdminProductReadScope` (= contracts' `AdminProductVisibilityScope`); the architecture test also covers `narrowProductIds`, `isProductHidden`, `searchProducts`, `bulkUpdate` and the bulk-operation `list` / `get` / `undo`.
- [x] T040 [A] `CAT/backend/services/catalog-admin-search.service.ts` + `admin-search-provider.ts`:
  predicate inside the search statement; the provider passes `adminUserId` (`CON/admin-search.ts:267`).
- [x] T041 [A] Guard (**TM-5**, R-7): a plugin-scope `addHook('preHandler')` on the plugin that mounts
  the catalog admin routes — runs after schema validation and before the route-level `preHandler` chain
  and the API interceptor dispatcher (`packages/platform/src/http/interceptors/dispatch.ts:19-98`),
  keyed on `request.routeOptions.url`; when hidden it makes the route answer **its own** not-found
  (a per-route not-found map derived and checked by T036), never a generic 404. Hidden-vs-absent may be
  logged server-side at debug only.
  *Build note*: routes that parse their own body or query before the product is read (scoped values, scopes, editor preference, URL keys, content, links and their order) are `'in-handler'` in `HIDDEN_ANSWERS`: the guard abstains and the handler asks at its lookup, after parsing — an API pre-interceptor on those eight routes does see a hidden id (documented in `hidden-product-guard.ts`).
- [x] T042 [A] Bulk operations (**FR-033**, **TM-1**, `CAT/backend/routes.admin.ts:479-560`,
  `catalog-bulk-update.service.ts`, bulk-operation worker): request-time narrowing of ids and of the
  select-all set; operation **list / detail** for a restricted caller show only operations whose
  selection has no hidden product (hidden ids never appear in `payload` or results); **undo** answers
  not-found when any affected product is hidden from the caller; the worker resolves
  `resolveScope(requestedByAdminUserId)` at execution and re-checks **per product at write time**
  (**TM-3 (2)**). Test `BT/integration/catalog/bulk-operations-visibility.test.ts`.
  *Build note*: for a restricted caller the selection is narrowed to existing visible ids before it is applied or queued (a missing id is dropped as a hidden one is, so the two cannot be told apart); the per-product write-time re-check answers `product_not_found`.
- [x] T043 [A] Price book grid (spec edge): `catalog`'s `pageProductsByAdminName` port takes the caller's
  scope (required, TM-3) and applies `productPredicate` in its statement, count included
  (`PL/backend/services/price-book-reads.ts:426-440`).
  *Build note*: `CatalogAdminNamePageQuery.scope` is required — an incompatible change to a stable port input under `contract-surface.md`; the changeset says it needs the owner's sanctioned-break ruling (D-293.7) before release.
- [x] T044 [A] `PL/backend/services/price-book-reads.ts` `lines` page: pass the scope to T043, drop
  non-qualifying variant lines through `adminProductVisibilityPort.filterVisible`; `PL/manifest.ts`
  `degrades-without` entry (stream A owns `PL/manifest.ts` for this). Row **edits** stay unrestricted
  (FR-038). Test `BT/integration/price_lists/book-lines-visibility.test.ts`, including the **off
  state** (M3): module off ⇒ the grid's pages and counts identical to module-absent.
  *Open leak*: `GET /price-books/:id/rows` (labels name hidden products) and `GET …/product-lines` are **not** narrowed — the test asserts `rows` answers 200 to a restricted caller (FR-038 reading); FR-030 needs a decision for `rows`.

**Verification (5a)**: `pnpm --filter backend exec vitest run test/contract/catalog/visibility-route-inventory.test.ts test/integration/catalog/visibility-list.test.ts test/integration/catalog/bulk-operations-visibility.test.ts test/integration/price_lists/book-lines-visibility.test.ts test/contract/catalog/admin-list-routes.test.ts test/contract/catalog/products-resolve-ids.test.ts test/contract/catalog/products-admin-list-filters.test.ts test/contract/catalog/admin-product-variants-read.test.ts test/contract/catalog/admin-variants.test.ts`;
`pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/admin-search-provider.test.ts src/backend/services/admin-scope-required.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches && pnpm --filter backend run check:module-boundary`.

## Phase 5b — [A] Catalog: cross-references, error details, aggregates, assistant tools, hookable actions, off state (FR-080 – FR-082; TM-2, TM-3, TM-6)

- [x] T045 [A] FR-080 (OQ-D A): links / grouped items / bundle options omit hidden
  targets for restricted callers; adding a hidden target answers target-not-found. Test
  `BT/integration/catalog/visibility-cross-references.test.ts`.
  *Open*: update / remove / reorder of an existing link, grouped item or bundle option whose target is hidden are not guarded (the restricted caller never sees its id).
- [ ] T046 [A] FR-082, **TM-2**: `URL_KEY_TAKEN` (`CAT/backend/services/url-key.service.ts:324-337`) and the
  integration-mode issues (`:309-316`) drop `heldByProductId` / `heldByProductName` when the holder is
  hidden from the caller (key and channel only); sweep every `HttpError` message and `details` in
  `catalog` and `price_lists` that names a product other than the addressed one (grep `heldBy`,
  `productId`, `name` in details) and redact the same way (the `sales_channels` part of the sweep is
  stream B's, in T065). Test
  `BT/integration/catalog/visibility-error-details.test.ts` (product save, scoped values, bulk, variants).
  *Build note*: done for `URL_KEY_TAKEN` and `URL_KEY_REDIRECT_TAKEOVER_REQUIRED` on the operator's paths (`PUT …/url-keys`, the scoped-values save); integration mode (connector, CSV) holds no admin scope and keeps naming holders. The rest of the sweep found no catalog refusal naming a product other than one the caller sent (`SKU_ALREADY_EXISTS` names the SKU only); `price_lists` was **not** swept — open.
  *Open (why unticked)*: `price_lists` refusals not swept; the test covers `PUT …/url-keys` only (the scoped-values save path is wired the same way but untested; bulk and variant refusals name no other product).
- [x] T047 [A] **FR-031**, **TM-6** aggregate inventory: category `productCount`
  (`CAT/backend/services/catalog-category-read.service.ts:257-268`), attribute-set `productCount` and the
  `assertNotInUse` error details (`attribute-set.service.ts:118-140,319,536-545`),
  `attributes/:idOrKey/usage`, `attributes/:idOrKey/scope-change-preview`: narrowed with the same
  predicate for a restricted caller (narrowing chosen for every row: it follows FR-031 "no response
  counts hidden products"; listed in the FR-088 docs table, T094). Test
  `BT/integration/catalog/visibility-aggregates.test.ts`.
  *Build note*: the admin category tree carries no product count (`countLiveProductsByCategory` is a port read for system callers), so nothing to narrow there. The attribute delete Command's guard still counts every product; only the usage dialog is narrowed.
- [x] T048 [A] FR-081 (OQ-E A). **Failing test first** `BT/integration/catalog/visibility-assistant-tools.test.ts`
  (US1-17: a hidden product asked through each catalog tool is not found and not written; a confirm
  executed later re-resolves the scope), then: the assistant tools `catalog` contributes to
  `promptActionToolRegistry` resolve `resolveScope(invokingAdminUserId)` **at tool execution** (also on a
  later confirm), never from an ambient request (**TM-3 (2)**).
  *Build note*: search, the four bulk-field tools and Archive / Restore resolve the invoking admin's scope at preview and again at confirm; the bulk-progress reader reads as the system (the selection was narrowed when queued).
- [x] T049 [A] `CAT/manifest.ts`: declare hookable (`beforeCommit`), with hook data contracts carrying
  the before/after global status, archive flag and the channel-scoped status cells written (needed by
  T068), **every catalog Command that writes a global status, an archive flag, a channel-scoped status
  or channel-scoped values** (H1; inventory at `c3e8a8755`, research R-11 table):
  `product.update` (`catalog-admin.service.ts:693`), `product.restore` (`:1525`), `product.bulk_update`
  (`catalog-bulk-update.service.ts:599`), `product.bulk_update.undo` (`bulk-operation.service.ts:727`),
  `product.scopes.update` (`product-scopes.service.ts:862`), `product.scoped_values.save`
  (`commands/scoped-values.commands.ts:119`), `product.scoped_values.import`
  (`services/scoped-values-import.ts:304` — connector `catalogProductScopeWritePort.applyScopes` and the
  CSV import). **Verified, not hooked**: `product.scoped_values.copy_to_channels`
  (`scoped-values.commands.ts:324`) copies only text fields — `name`, `description`, gallery alt texts,
  attachment and packaging-unit names, string attributes scoped Channel × language (`copyable`,
  `scoped-values.commands.ts:259-266`) — never a status, so it cannot reactivate; its channel-scoped
  writes for a governed pending channel are covered by T070 (`resolveRequestScope` at `:284`, `:298`). A test
  in `CAT/backend/hookable-status-writers.test.ts` lists every Command action whose run writes
  `status` or a channel-scoped cell and fails on one not declared hookable. Contract-surface entry +
  changeset.
- [x] T050 [A] Off-state test `BT/integration/catalog/visibility-off-state.test.ts`: module off ⇒ every
  read/write above identical to module-absent; on again ⇒ narrowing back; **TM-3 (4)** module present
  but its port throwing ⇒ 5xx, never unfiltered.
  *Build note*: written after the code it holds (it is the off-state characterisation); green on its first run.

**Verification (5b)**: `pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/hookable-status-writers.test.ts`;
`pnpm --filter backend exec vitest run test/integration/catalog/visibility-assistant-tools.test.ts test/integration/catalog/visibility-cross-references.test.ts test/integration/catalog/visibility-error-details.test.ts test/integration/catalog/visibility-aggregates.test.ts test/integration/catalog/visibility-off-state.test.ts test/contract/catalog/visibility-route-inventory.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches && pnpm --filter backend run check:module-boundary`;
`PERF_RUN=true` bench of T035 extended to HTTP pages (budget R-16) — recorded.

## Phase 5c — [A] Other admin product read paths (FR-083 – FR-085, SC-009; TM-9 — OQ-H signed off)

Accepted rows of the signed-off table (inventory writes by id, price-book row writes, audit log and
notifications, feeds, CMS / blog / CRM / tasks — FR-086, FR-087) have no task here; they go into the
FR-088 docs table (T094).

- [ ] T051 [P] [A] Failing tests `BT/integration/product_visibility_rules/other-admin-reads.test.ts`,
  one block per narrowed / refused row: inventory admin lists with counts and paging (FR-083) and the
  set-stock assistant tool (FR-081), price history by product and change lines (FR-084), products
  export / import `403` (FR-085). **SC-009** sweep test `BT/integration/product_visibility_rules/sc-009-surfaces.test.ts`:
  for a restricted user every surface of FR-080 – FR-085 returns or acts on zero hidden products and
  no error answer names a hidden product (FR-082) — reuses the fixtures of T045, T046, T048.
  **Off state (M3)**: `BT/integration/product_visibility_rules/off-state.other-admin-reads.test.ts` —
  module off ⇒ every 5c surface identical to module-absent (no narrowing, no `403`).
  *Build state (wip)*: `other-admin-reads.test.ts` holds the price-history block (green with T053); the inventory (FR-083 + set-stock tool) and export/import (FR-085) blocks are `it.todo`. `sc-009-surfaces.test.ts` and `off-state.other-admin-reads.test.ts` are **not written**.
- [ ] T052 [A] `inventory` (`packages/modules/inventory/src/backend/routes.admin.ts:124-615`,
  `prompt-tools.ts:86-101`): admin lists narrowed through the port (product predicate on its product
  column); the set-stock tool resolves the product through the scoped lookup (hidden ⇒ not found);
  `inventory/manifest.ts` `degrades-without` entry.
  *Build state*: **not started**.
- [x] T053 [A] `price_lists` price history (`PL/backend/routes.price-books.ts:536-567`):
  `…/price-history/products/:productId` answers as absent for a hidden product; `…/:changeId/lines`
  drops hidden products' lines. Row **edits** stay unrestricted (FR-038).
  *Build note*: the product's history answers a hidden product as one with none (after the book is read through its scope); a change's lines keep lines naming no product. `price_lists` asks the port (`filterVisible`, `productPredicate`) — it never reads `products`.
  *Off state*: `other-admin-reads.test.ts` holds both history reads equal to the platform administrator's with the module off on both axes.
- [ ] T054 [A] `import_export` products adapter
  (`packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`): export and
  import of products refused `403` for a non-unrestricted scope, one check through the port, resolved
  at job execution for the requester.
  *Build state*: **not started**.

**Verification (5c)**: `pnpm --filter backend exec vitest run test/integration/product_visibility_rules/other-admin-reads.test.ts test/integration/product_visibility_rules/sc-009-surfaces.test.ts test/integration/product_visibility_rules/off-state.other-admin-reads.test.ts test/integration/inventory test/integration/import_export`;
`pnpm --filter @endora-commerce/mod-import-export exec vitest run src/backend/services/adapters/products.adapter.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`.

---

## Phase 6 — [B] Website rule backend (US4; FR-050 – FR-053, FR-055 – FR-058, FR-061, FR-072; TM-11)

Stream B owns the files listed in plan.md § *Parallel builders*.

- [x] T055 [P] [B] Failing unit tests `PVR/backend/services/product-rule-evaluator.test.ts`: all/any,
  one nesting level, boolean / choice / price conditions, missing value ⇒ not met (FR-057), inactive /
  archived / deleted never member (FR-079); **TM-11**: an attribute deleted or re-scoped after save evaluates
  "not met"; no definition value reaches SQL or a JSON path.
- [ ] T056 [P] [B] Failing integration tests `BT/integration/product_visibility_rules/website-rule.test.ts`:
  attach requires preview (FR-053); counts per channel; confirm applies **exactly** the snapshot
  (SC-004); stale preview refused; second rule on a channel refused, one rule on two channels (US4-7);
  detach leaves membership and deletes the channel's `website_rule_admissions` rows (FR-058); no rule ⇒ membership unchanged on install/enable (US4-1, FR-052);
  audit `source` names the rule (FR-072); **FR-079 (N5)**: attaching or changing a rule never adds an
  inactive, archived or deleted product to a governed channel, and the preview never counts one as a
  join; **TM-11**: confirm by anyone but the session admin who
  created the preview ⇒ not found; per-admin cap on concurrent previews (3) and a size cap on
  `website_rule_preview_changes` (2 000 000 rows) ⇒ `409 WEBSITE_RULE_PREVIEW_LIMIT`; Zod bounds on `sales_channel_ids` (≤ 50),
  conditions (≤ 20), option keys (≤ 100), string lengths, under the route `bodyLimit`.
- [x] T057 [B] `PVR/backend/services/product-rule-evaluator.ts` (pure, re-validates attribute keys at
  evaluation) + rule Commands and routes (create/update/delete; attribute validation through
  `catalogAttributeReadPort`).
- [x] T058 [B] Preview job + tables (caps of T056), confirm (`attach` / `change` Commands; creator check
  against the session), apply job writing the snapshot with the governor token in transactions of 500
  (`PVR/backend/services/website-rule.service.ts`, `PVR/backend/workers/website-rule-worker.ts`);
  **`website_rule_admissions` writers (M4, N2)**: the apply job inserts a row per governor-token add,
  deletes it per governor-token remove and deletes all rows of a channel on detach (LOW 17; asserted
  in T056); the reactivation hook (T068) deletes the row with every token removal it makes and sets
  `post_admission_status_seen` on the first channel-status write — no other writer.
- [x] T059 [B] Steady state: marks from `product.created.v1` / `product.updated.v1` /
  `product.archived.v1` / `product.deleted.v1` and from flag refreshes; debounced evaluation job (30 s);
  window-boundary delayed jobs from `designationStatus.window`; hourly reconcile per governed channel.
  **Q2 A**: while a currency's designation rebuild runs, the rule's price conditions on that currency
  read the served (previous) generation — no product leaves and re-joins the channel because of the
  rebuild; the swap marks only products whose flags changed.
  Test `…/website-rule-timing.test.ts` (US4-2, US4-5, US4-11, SC-005; designation change ⇒ zero
  transient leave/join events; a rule change emits exactly one `sales_channels.membership_changed` per
  product that joined or left — LOW 12) with a controllable clock.
- [x] T060 [B] `productRuleGovernancePort` (FR-055) via `ctx.di.providePort`; test
  `PVR/backend/services/product-rule-governance-port.test.ts` (`governedChannels`, `meetsRule`, owner
  off ⇒ 503).
- [x] T061 [B] Off-state test `…/off-state.website-rule.test.ts`: no evaluation, jobs left waiting,
  memberships as last computed; on again ⇒ reconcile enqueued.

**Verification**: `pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/services/product-rule-evaluator.test.ts src/backend/services/product-rule-governance-port.test.ts`;
`pnpm --filter backend exec vitest run test/integration/product_visibility_rules/website-rule.test.ts test/integration/product_visibility_rules/website-rule-timing.test.ts test/integration/product_visibility_rules/off-state.website-rule.test.ts`;
`pnpm --filter backend run check:subscribe-seam && pnpm --filter backend run check:port-dependencies`.

---

## Phase 7 — [B] Kernel governance and admission (US4; FR-054, FR-059, FR-092, FR-093; TM-10)

- [x] T062 [P] [B] Failing unit tests `KSC/sales-channel-membership.governor.test.ts`: per method
  (`addToChannel`, `removeFromChannel` incl. fallback, `bindToDefaultIfEmpty`, `copyMemberships`,
  `replaceChannelsForEntity`, `clearChannelsForEntity`) × (ungoverned, governed skip, governed refuse,
  governor token); zero-channel floor waived only for a token write and for a request that named a
  governed channel which was skipped — every other last-channel removal still refused (R-10); governor
  of an absent module ignored; non-product entity types untouched. **TM-10**: a token not issued by
  the registry (structurally identical object) is rejected (identity check); registration after boot
  or a second governor for one module id throws; `governs()` throwing ⇒ the write is refused, never
  "not governed"; a caller-supplied `source` without the token is ignored in the audit row.
- [x] T063 [B] `KSC/membership-governors.ts` (registry, module-private `WeakSet` of issued tokens,
  frozen after boot; the token type is opaque and not constructible from the `./kernel` barrel) and
  `KSC/sales-channel-membership.service.ts` semantics (R-10); `packages/platform/src/kernel/ports/sales-channel.ts`
  additive options/result; error code + pl/en message (rule label rendered as text only); audit
  `source` honoured only with the token. Changeset for `@endora-commerce/platform`.
- [x] T064 [B] **TM-10** bridge-writer inventory test `BT/unit/kernel/channel-product-bridge-writers.test.ts`:
  greps `packages/**` for statements writing the channel-product bridge table and fails on any file
  other than `KSC/sales-channel-membership.service.ts` (two-way: a listed writer that disappears fails
  too).
- [x] T065 [B] `packages/modules/sales_channels/src/backend/routes.admin.ts:387-431`: pass
  `onGoverned: 'refuse'`; contract test `BT/contract/sales_channels/governed-membership.contract.test.ts`
  (US4-3 manual refusal, translated, membership unchanged). Also the `sales_channels` part of the
  FR-082 error-details sweep (moved here from T046, stream B owns the module): no error answer names
  a product hidden from the caller other than the addressed one. **N8**: failing test first in
  `BT/contract/sales_channels/error-details-visibility.contract.test.ts` for every refusal of the
  channel-side membership routes; if the sweep finds no `details` / message naming another product,
  the task records that evidence (the grep and its empty result) in the PR and the test asserts the
  current shapes so a later regression fails.
- [x] T066 [B] `PVR/backend/services/membership-governor.ts`: `governs` reads `website_rule_attachments`
  on the passed `em`; contributed from the module's boot hook (contribution sink, filtered by
  presence); the token is held in a module-local closure of the website-rule service and **never
  registered in the DI container** (TM-10).
- [x] T100 [B] **FR-059 / TM-10: channel delete onto a governed default** (coordinator decision,
  option b — refuse; R-10, P9, spec.md:688-690). Failing test first
  `BT/integration/sales_channels/delete-governed-default.test.ts`: (1) default governed for
  product, the deleted channel holds product orphans, `fallbackToDefault=true` ⇒ `422
  ENTITY_WOULD_HAVE_ZERO_CHANNELS` naming the rule and a count, no product id, channel kept, no
  bridge, audit or lifecycle row changed; (2) non-product orphans only ⇒ rebind as today; (3)
  default ungoverned ⇒ rebind as today; (4) governed channel deleted onto an ungoverned default ⇒
  rebind as today; (5) module off with an attachment row ⇒ as today (in T069's
  `off-state.governance.test.ts`). Then an additive `isGoverned(entityType, channelId, { em? })` on
  the membership service and `SalesChannelMembershipPort` (a throwing governor propagates;
  changeset), the refusal in `sales_channels` `SalesChannelsService.delete` before any write, the
  plain refusal's details reduced to counts per entity type (FR-082), pl + en sentence, T064 ledger
  reason updated.
- [ ] T067 [A] (after T063 is on the shared branch) `CAT/backend/services/catalog-bulk-update.service.ts:562,570,576`:
  `onGoverned: 'refuse'` + enqueue-time refusal when the patch names a governed channel; test in
  `BT/integration/catalog/bulk-update-governed-channel.test.ts`.
- [ ] T068 [B] (after T049, T058, T066 and T070 — not parallel) Failing integration test
  `BT/integration/product_visibility_rules/admission.test.ts` then the `beforeCommit` hooks on **every**
  Command T049 declares (`product.update`, `product.restore`, `product.bulk_update`,
  `product.bulk_update.undo`, `product.scopes.update`, `product.scoped_values.save`,
  `product.scoped_values.import`); the connector cases are driven through
  `catalogProductScopeWritePort.applyScopes` (and the CSV import), not only the admin routes.
  **Owner H2 A**: only the **channel status (scope level `channel`)** counts for reactivation; a
  per-language status (`channel_language`) never does — test case: on an admitted product, a
  per-language status inactive → active written through `applyScopes` leaves the membership in place,
  marks nothing and leaves `post_admission_status_seen` **unset** (N3). Create / duplicate /
  import / connector-shaped calls skipped on a governed channel (US4-3); global transition to active /
  un-archive ⇒ governed memberships removed in the same transaction with the token and the product
  marked; a **channel status** (scope level `channel`) moving to active on a governed channel ⇒ that one
  membership removed (FR-092, OQ-F A) — **except** the first channel-status write on that channel
  after the product's admission, even inactive → active (FR-093, Q1 A; read from the admissions
  ledger; the hook sets `post_admission_status_seen`). **N2**: every token removal the hook makes
  deletes that (channel, product) admissions row in the same transaction; the next admission by the
  apply job inserts a fresh row, so the exemption applies again — test case: admit → first
  channel-status write (exempt) → later inactive → active (evicted, row deleted) → re-admit → first
  channel-status write after re-admission exempt again;
  **inherit cases (FR-092 as worded at `35b32350d`)**: (1) on a governed channel, a stored channel
  status `inactive` cleared to inherit while the global status is active ⇒ a reactivation: membership
  removed in the same transaction, re-admitted ≤ 5 min; (2) the same clear while the global status is
  inactive ⇒ not a reactivation (nothing removed, nothing marked); (3) the first channel-status write
  after admission that writes inherit is still exempt (FR-093); a write that does not move status to active is no reactivation; never on the governed
  channel before admission, admitted ≤ 5 min (US4-6, FR-059, SC-005); a product deactivated, archived
  or deleted is never re-admitted while so (FR-079, N5); remove + re-admit keeps
  channel-scoped values.
- [ ] T069 [B] Off-state test `BT/integration/product_visibility_rules/off-state.governance.test.ts`:
  module off ⇒ no write refused or skipped, hook not run, pending-admission scoped values refused as
  today (FR-073).
- [ ] T070 [A] (after T060, T063, T066) **FR-093 (I-4)** — the refusal seam is
  `resolveRequestScope` (`CAT/backend/services/scoped-values-state.ts:181-215`, `not_a_member` at
  `:204`), shared by the save (`commands/scoped-values.commands.ts:127,284,298`), the import / connector
  path (`services/scoped-values-import.ts:241`), the scope resolution of the scoped-values service
  (`services/scoped-values.service.ts:50`, L1) and the read (`scoped-values-read.service.ts:324`), plus
  the twin checks in `product-scopes.service.ts:243` and `url-key.service.ts:275`. **N6**: every one of
  these writers stores pending values for a governed channel (connector `applyScopes`, CSV import,
  admin save, copy to channels, scopes update, URL keys) — FR-093 as approved by the owner. Add an option
  `governedPending: ReadonlyMap<channelId, languages[]>` that **callers** build from
  `productRuleGovernancePort.governedChannels()` (presence-probed; absent ⇒ empty ⇒ today's
  `SCOPE_INVALID`) and the channel's own languages; `resolveRequestScope` itself stays pure. Writes
  for a governed channel the product is not a member of are stored and never add a membership.
  **Read side (decided, R-11)**: the admin read at `scoped-values-read.service.ts:324` accepts a
  governed pending channel for an unrestricted caller (shows the pending values, documented in T094);
  for a restricted caller the product is already subject to FR-033. Failing test first
  `BT/integration/product_visibility_rules/pending-admission-values.test.ts`, driven through
  `catalogProductScopeWritePort.applyScopes`, the CSV import, the admin save, copy to channels, the
  scopes update and the URL-key write: a write before
  admission is stored, readable by an unrestricted admin, the product appears on admission with those
  values, a write on an ungoverned non-member channel is still `SCOPE_INVALID`.

**Verification**: `pnpm --filter @endora-commerce/platform exec vitest run src/kernel/sales-channels`;
`pnpm --filter backend exec vitest run test/unit/kernel/channel-product-bridge-writers.test.ts test/contract/sales_channels/governed-membership.contract.test.ts test/contract/sales_channels/error-details-visibility.contract.test.ts test/integration/catalog/bulk-update-governed-channel.test.ts test/integration/product_visibility_rules/admission.test.ts test/integration/product_visibility_rules/pending-admission-values.test.ts test/integration/product_visibility_rules/off-state.governance.test.ts test/contract/kernel/harness-parity.test.ts`;
`pnpm --filter backend run check:kernel-boundary && pnpm --filter backend run check:platform-surface && pnpm --filter backend run check:port-catches && pnpm --filter backend run check:container-imports`.

### ✅ Review checkpoint 1 — backend block (after Phases 1 – 7)

`qa-engineer`, `code-reviewer`, `security-engineer` in parallel on a model other than the
author's, against `threat-model.md` TM-1 – TM-14 (re-review Phases 4, 5a/5b, 7); `product-owner`
checks the **ungated** backend FRs — FR-001 – FR-036, FR-038, FR-050 – FR-062, FR-070 – FR-073,
FR-075, FR-077 – FR-088, FR-092, FR-093 — traceability (M5, L6; FR-074 and FR-076 are UI strings and
the activation text, accepted at checkpoint 2). FR-037, FR-039 – FR-043, FR-090, FR-091 are gated on spec 192 and
are reviewed at checkpoint 3 only. Gate: findings closed before Phase 8.

---

## Phase 8 — Admin UI (US2, US4, FR-023 banner, FR-024, FR-071, FR-074; TM-4, TM-13, TM-14)

- [ ] T071 [P] Failing component tests `admin/test/modules/product_visibility_rules/ConfigurationPage.test.tsx`:
  categories, designations (only designatable books offered; not-in-force reason shown), role mapping
  (target `unrestricted` offered; `platform_admin` and self-lifting roles shown "unrestricted — cannot
  be mapped"; "sees no products" listed; `mapping_without_effect` and FR-086 warnings shown),
  read-only for `:read` and for a non-unrestricted caller (TM-4 c).
- [ ] T072 `PVR/admin/pages/ConfigurationPage.tsx` + API client; admin-kit primitives only (IX).
- [ ] T073 [P] Failing tests `…/WebsiteRulesPage.test.tsx`: rule editor (attribute picker limited to
  boolean/choice non-scoped), attach flow with mandatory preview → confirm, stale/expired/capped
  handling, detach; the rule label rendered as text only.
- [ ] T074 `PVR/admin/pages/WebsiteRulesPage.tsx` (+ preview polling).
- [ ] T075 Role screens (R-14): zones `admin_users.roles.list.columns` and
  `admin_users.roles.editor.aside` in `AdminZoneNameSchema` + props map, rendered in
  `packages/modules/admin_users/src/admin/pages/AdminRolesPage.tsx`; module contributions; test
  `admin/test/modules/admin_users/AdminRolesPage.visibility-zone.test.tsx`.
- [ ] T076 Product list banner for no-category / restricted callers from the list response's
  `visibility` field (catalog admin, stream A file `CAT/admin/…` — coordinate); test
  `admin/test/modules/catalog/ProductList.visibility-banner.test.tsx` (LOW 15); **TM-14**: confirm the
  admin SPA query cache is dropped on sign-out and on a `401` (admin-shell; fix there if not).
- [ ] T077 Failing test first (L3): `BT/unit/product_visibility_rules/activation-texts.test.ts` (moved
  from T078) and the palette-coverage case for the two actions; then palette actions (two), nav entry
  with `requiredPermission`, i18n pl+en for every string incl.
  the FR-073 warning; **TM-13**: the module's activation description and deactivation consequence
  text on `/platform/modules` state that every restricted role becomes unrestricted while off;
  **FR-076 (M10)**: the activation text states that turning it on applies FR-023 at once (unmapped
  roles holding `rfqs:handle` see no products until mapped).
- [ ] T078 Off-state UI test: no nav, palette, zone contribution, banner while off; **TM-14** test that
  a second admin signing in on the same tab sees no list rows cached from the first.
- [ ] T079 UX pass against `.claude/skills/ux-laws/SKILL.md` (states: loading, empty, error, refused,
  building generation).

**Verification**: `pnpm --filter admin exec vitest run test/modules/product_visibility_rules test/modules/admin_users/AdminRolesPage.visibility-zone.test.tsx test/modules/catalog/ProductList.visibility-banner.test.tsx test/unit/palette-coverage.test.ts`;
`pnpm --filter backend exec vitest run test/unit/product_visibility_rules/activation-texts.test.ts`;
`pnpm --filter backend run check:admin-zones`; `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`;
`pnpm --filter admin run typecheck && pnpm --filter admin run lint`.

### ✅ Review checkpoint 2 — UI block

`designer` + `code-reviewer` + `qa-engineer` in parallel (different model from the author);
`product-owner` accepts US1 (except its gated scenarios US1-9, US1-13, US1-14, US1-20), US2 and US4
(except its gated scenarios US4-10, US4-12 and US4-13 — N4, R1; accepted at checkpoint 3), plus FR-074 and FR-076,
against quickstart.md (M5). Release before checkpoint 3 ships no gated behaviour: Phases 9a/9b do
not start until spec 192 merges.

---

## Phase 9a — GATED: lines, picker, marker (US3, FR-037, FR-039 – FR-043, RQ-2 C; TM-15)

**Do not start until spec 192 (issue #1901) has merged to `master`.** Then rebase, re-measure
`quote_requests/backend/services/rfq-admin-service.ts`, `RfqCreatePage.tsx`, `RfqDetail.tsx`,
`packages/admin-kit/src/components/product-picker/ProductPicker.tsx`,
`packages/admin-kit/src/components/product-browser/product-browser-api.ts`, and update this phase's
paths. (Releasing T080 – T081 — and T093's create / preview part — before 192 is an option the owner
has **not** decided; the gate stands — plan.md § *Sequencing*.) **TM-15**: if 192
adds a SKU or paste-by-SKU line input, a hidden product's refusal there must equal that input's
not-found answer.

- [ ] T080 [P] Failing integration test `BT/integration/orders/admin-order-visibility.test.ts`: create,
  preview, reorder refuse an out-of-category product or variant naming the line, `details` limited to
  `items.<i>` (no category, price or flag — TM-15), nothing saved; no marker on order create; storefront
  reorder / clone untouched; unrestricted unchanged (US1-9, US1-13, FR-037, FR-039, RQ-2 C);
  **clone-to-quote** refused the same way, per variant, nothing created (C1: the failing case for
  T082); **US1-20**: a base-book row removed ⇒ an admin order line for that product is refused at once,
  before the flags refresh (line checks exact, OQ-A); one case submitted from a CRM opportunity hand-off
  (FR-087, R-19).
- [ ] T081 `packages/modules/orders/src/backend/routes.ts` (`/api/v1/admin/orders`, `/preview`,
  `/:id/reorder`): `checkLines` behind presence probe; `orders/manifest.ts` `degrades-without` entry.
- [ ] T082 Clone-to-quote (`orders/backend/services/order-clone-to-quote-service.ts`): same refusal
  (its failing case is in T080's file, written first).
- [ ] T083 [P] Failing test `BT/integration/quote_requests/visibility-lines.test.ts`: create / add line /
  change product refused naming lines (US3-1); existing out-of-category line editable and removable,
  product not changeable, not re-addable (US3-2, FR-042); per variant (US3-5); one case from a CRM
  opportunity hand-off (FR-087, R-19).
- [ ] T084 `quote_requests` (`RfqAdminService` create / modify as left by 192): `checkLines`;
  `quote_requests/manifest.ts` `degrades-without` entry.
- [ ] T085 [A] **Failing contract test first** `BT/contract/catalog/no-fixed-price-field.contract.test.ts`
  (C1): `noFixedPrice: true` on list and variant rows only for a restricted caller whose only met
  condition is `gte_zero` at price 0; absent for unrestricted callers (SC-003). Then the field on
  `catalog`'s list / variant rows (contracts additive). **M7**: the admin quote-request **line**
  projection gains the same optional `noFixedPrice` (restricted caller only; computed through
  `checkLines`) — contract case in the same test file against the quote-request admin read as left by
  192.
- [ ] T086 [P] Failing component tests for the admin-kit picker and browser: only qualifying variants;
  marker shown only when the host passes `showNoFixedPriceMarker` (quote screens), never for
  unrestricted (US3-3, OQ-12); **M7**: the quote line marker on `RfqDetail.tsx` / `RfqCreatePage.tsx`
  **as rewritten by spec 192** (`admin/test/modules/quote_requests/RfqDetail.no-fixed-price.test.tsx`),
  asserting the exact texts pinned in FR-043: en "no fixed price", pl "brak ustalonej ceny".
- [ ] T087 `packages/admin-kit/src/components/{product-picker,product-browser}` + quote screens pass the
  marker flag; i18n of the marker: en "no fixed price", pl "brak ustalonej ceny" (FR-043, fixed, not
  editable).
- [ ] T088 Off-state test `BT/integration/product_visibility_rules/off-state.lines.test.ts` for orders and
  quote lines (module off ⇒ no refusal, no marker).

**Verification**: `pnpm --filter backend exec vitest run test/integration/orders/admin-order-visibility.test.ts test/integration/quote_requests/visibility-lines.test.ts test/contract/catalog/no-fixed-price-field.contract.test.ts test/integration/product_visibility_rules/off-state.lines.test.ts test/integration/quote_requests test/contract/quote_requests`;
`pnpm --filter '@endora-commerce/admin-kit' exec vitest run src/components/product-picker src/components/product-browser`;
`pnpm --filter admin exec vitest run test/modules/quote_requests`; `check:port-dependencies`, `check:port-catches`.

## Phase 9b — GATED: sales-team purchase paths for rule-excluded products (FR-090, FR-091, OQ-B B, Q3)

Same gate as 9a: quote → cart conversion is in `carts/backend/services/cart-conversion-service.ts`,
which spec 192 changes; admin order create / preview / reorder share `orders/backend/routes.ts` with
9a's checks, whose gate the owner kept. Uses `productRuleGovernancePort.excludedOnlyByRule`
(contracts/ports.md §2): governed channel, not a member, active, not archived or deleted, channel
status not inactive. **Owner N1 / H2 A**: the product's **stored channel status** (scope level
`channel`) counts whenever it was written — before admission, after admission or left over from an
earlier membership; no stored value counts as not inactive. Per-language statuses never count: they
decide only storefront per-language visibility, never a sales-team path.

- [ ] T089 [P] Failing integration test `BT/integration/carts/quote-conversion-rule-excluded.test.ts`:
  an accepted quote's line whose product (or variant) is absent from the request channel **only**
  because of the website rule is kept on conversion and through checkout and order placement; a line
  absent for any other reason (inactive, archived, deleted, non-member of an ungoverned channel) is
  dropped / refused as today; **N1 (owner)**: the setup stores a channel status for the governed
  non-member product — `inactive` ⇒ the line is dropped / refused; `active` or inherited (no stored
  value) ⇒ kept; the stored value counts whenever it was written (before admission, after admission or
  left over from an earlier membership) — **US4-13**: a rule-excluded product with an inactive channel
  status, stored pending admission or left over, is absent for another reason and is dropped; storefront listing, search, type-ahead and URL
  still hide it; module off or rule detached ⇒ today's behaviour (FR-090). **H2 A case**: a
  sales-team-only product whose channel-row status is active but whose per-language status is inactive
  in **every** language of the channel (and which has FR-093 pending cells) is kept through conversion,
  checkout and placement (**US4-12**; spec terms: *channel status* = the channel row, *per-language
  status* = channel × language).
- [ ] T090 [P] Failing integration test `BT/integration/orders/admin-order-rule-excluded.test.ts`: admin
  order create, preview, reorder and clone-to-quote accept a rule-excluded product (Q3) and still
  refuse other out-of-channel products; for a restricted user the category check of T080 still applies
  first (FR-091, FR-037, FR-039); module off ⇒ today; **H2 A case**: the same product inactive in every
  language of the channel passes admin create, preview, reorder and clone-to-quote (US4-12); **R4 /
  US4-13**: a rule-excluded product whose stored channel status is inactive (pending or left over) is
  refused on admin order create, preview, reorder and clone-to-quote as today's out-of-channel refusal.
- [ ] T091 `productRuleGovernancePort.excludedOnlyByRule(channelId, refs)` in `PVR` — a simple read
  (N1): channel governed (own attachments table) ∧ not a member (membership port
  `filterEntityIdsInChannel`) ∧ active, not archived, not deleted ∧ the **currently stored channel
  status** (scope level `channel`, catalog read port) is not `inactive`; per-language statuses are never
  read. No SQL against another module's table (LOW 11); unit test (incl. US4-13: inactive channel status
  stored pending or left over ⇒ false)
  `PVR/backend/services/product-rule-governance.test.ts`.
- [ ] T092 `carts`: conversion (`cart-conversion-service.ts:239`, re-measured after 192) and the
  checkout / placement channel check keep lines from an accepted quote that are excluded only by the
  rule (the line's quote origin is the condition); `carts/manifest.ts` `degrades-without` entry.
- [ ] T093 `orders`: admin create / preview (`orders/backend/routes.ts:985-1000`), reorder and
  clone-to-quote accept rule-excluded lines; `orders/manifest.ts` entry shared with T081.

**Verification (9b)**: `pnpm --filter backend exec vitest run test/integration/carts/quote-conversion-rule-excluded.test.ts test/integration/orders/admin-order-rule-excluded.test.ts test/integration/carts/cart-read-equals-placement.test.ts test/contract/carts/cart-conversions.contract.test.ts`;
`pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/services/product-rule-governance.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`.

### ✅ Review checkpoint 3 — gated block

Same reviewers (security-engineer re-reviews against TM-15 and the rule-excluded acceptance of
9b); `product-owner` accepts US3, US4-10, US4-12, US4-13, FR-090, FR-091.

---

## Phase 10 — Documentation, release intent, final verification

- [ ] T094 [P] Module documentation en + pl (`PVR`'s package-root `docs/`, `module-documentation.md`):
  configuration, timing table (plan.md), off-state warning and "default off at upgrade: no restriction
  until enabled" (TM-13, also in the release note), connector note (R-10), accepted oracles (TM-15:
  SKU / URL-key "already taken", line refusal code, own category name), **"a `*` role is not a
  restrictable role" and the self-lifting permissions** (TM-4 e; FR-026: such roles are always
  unrestricted and unmappable), the **FR-088 table** of every admin surface returning product data
  (narrowed / refused / accepted, with reasons — the signed-off OQ-H table plus the TM-6 aggregates),
  the timing bounds of FR-060 / FR-062, "configure right after the first enable" (FR-077, I-3), and
  the FR-076 release note ("ships off; nothing changes until an operator turns it on").
- [ ] T095 [P] `docs/docs/architecture/` note on the membership governor (kernel) en + pl.
- [ ] T096 Changesets for every touched package (`release-intent.md`); contract-surface entries for the
  new ports and the kernel options (`contract-surface.md`).
- [ ] T097 Regenerate and verify generated artefacts (`composer:generate`, `manifests:generate`,
  lockfile); grep `backend/test/**` for anything derived from moved/added paths (AGENTS.md traps).
- [ ] T098 Perf: run T035 bench end to end; record restricted vs unrestricted p95 and rebuild times in
  research.md R-16 and `specs/pricing/read-paths-and-performance.md` §7 (new row).
- [ ] T099 Walk quickstart.md on a fresh `pnpm run setup` database; record results in the PR, including
  the **SC-006** timing (category + mapping + website rule configured in under 5 minutes, stopwatch
  from the first screen to the confirmed preview).

**Verification**: `pnpm -r run typecheck && pnpm -r run lint`; `pnpm --filter backend run test:unit:fast`;
`pnpm --filter '!backend' run test` for touched packages; `pnpm --filter backend run check:module-docs && pnpm --filter backend run check:docs-translations && pnpm --filter backend run check:release-intent`;
the targeted backend files of Phases 2 – 9b; full backend suite runs on `master` after merge (D-198).

---

## FR → test map

| FR / SC | Tests |
| --- | --- |
| FR-001 – FR-007 | T009 – T011, T017, T026, T032 |
| FR-010 – FR-014 | T003, T017 |
| FR-020 – FR-026 | T017, T032, T071, T075 |
| FR-030 – FR-036, FR-038 | T036, T037, T042 – T044, T047, T050 (FR-031 aggregates: T037, T047; FR-033 bulk operations: T036, T042; FR-036 `no-store`: T037) |
| FR-037, FR-039 | T080 (incl. clone-to-quote and US1-20) (gated) |
| FR-040 – FR-043 | T083, T085 (contract `noFixedPrice`, list and quote line), T086 (picker / browser / quote screens, pl + en texts) (gated) |
| FR-050 – FR-053, FR-056 – FR-058 | T055, T056 |
| FR-054, FR-055, FR-059 | T060, T062, T064, T065, T067, T068 |
| FR-060 – FR-062 | T017 (FR-060 next-request integration case), T026, T029, T030, T032, T035, T059 |
| FR-070 – FR-077 | T018, T024, T031, T044, T050, T051, T061, T069, T078, T088 |
| FR-079 | T037 (admin reads), T055, T056, T068 (governed channel, stream B) |
| FR-080 – FR-082 | T045, T046, T048 (assistant-tools test, 5b), T051 (SC-009 sweep), T065 (sales_channels details) |
| FR-083 – FR-085 | T051 – T054 |
| FR-086 – FR-088 | T017, T021, T094 (docs) |
| FR-090, FR-091 | T089 (incl. N1 setup, US4-12, US4-13), T090, T091 (gated) |
| FR-087 (CRM opportunity paths) | T080, T083 (one case each; R-19 verified no separate path) |
| FR-092, FR-093 | T049 (hookable inventory test), T068 (incl. H2 A: a per-language status write never reactivates), T070 |
| SC-001 – SC-007 | T026, T037, T056, T059, T068, T035/T098, T099 (SC-006 timing) |
| SC-008 | T035 (asserted at 50 000 products), T026, T032 |
| SC-009 | T051 (`sc-009-surfaces.test.ts`) |

## Threat-model finding → task map (`threat-model.md` at `868445291`)

| Finding | Tasks (each phase's Verification line runs the named tests) |
| --- | --- |
| TM-1 bulk operations outside the inventory | T036 (all `/api/v1/admin/catalog/**`), T042 (list/detail/undo, per-product worker check) |
| TM-2 `heldBy*` in URL-key conflicts | T046 (redaction + details sweep), T094 (residual oracle) |
| TM-3 required scope, union predicate, no catch | T003, T032, T033, T034, T038, T039 (architecture test), T042, T043, T048, T050 |
| TM-4 self-lifting roles | T017, T019 (mapping refused, OQ-G 1), T020 (403), T021 (`mapping_without_effect`), T024 (activation audit), T032 (always unrestricted), T071, T094 |
| TM-5 guard placement | T036 (spy interceptor, full envelope, HEAD/OPTIONS, non-UUID), T041 (plugin-scope hook, route's own not-found) |
| TM-6 aggregates | T037, T039, T047 (all narrowed), T094 (docs table) |
| TM-7 stale-visible races | T026, T027, T029, T030, T031, T032 |
| TM-8 SQL fragment surface | T032, T033, T034 |
| TM-9 other admin read paths | plan.md § *TM-9 surfaces* (signed off, OQ-H); T051 – T054; T021 warning; T094 table |
| TM-10 governor token | T062, T063, T064, T066 |
| TM-11 preview / confirm / evaluation | T055, T056, T057, T058 (the per-channel admin scope check is not applicable: the platform has no per-channel admin scope) |
| TM-12 event spoofing, rebuild amplification | T028, T029 |
| TM-13 module off lifts restrictions | T024, T077, T094 |
| TM-14 client caches | T037, T039 (`no-store`), T076, T078 |
| TM-15 accepted oracles (note) | T080, Phase 9a gate note, T094 |
| TM-16 checked items (note) | no task |
