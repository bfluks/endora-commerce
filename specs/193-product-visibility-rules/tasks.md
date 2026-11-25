---
description: "Tasks for spec 193 — product visibility rules"
---

# Tasks: Product visibility rules — admin roles by catalogue price, and a configurable website rule

**Input**: `specs/193-product-visibility-rules/` — spec.md, plan.md, research.md (R-n), data-model.md,
contracts/ (ports.md, admin-api.md, events-and-errors.md), quickstart.md.
**Measured against**: `origin/master` `c3e8a8755`. Re-run before each phase:
`git log --oneline c3e8a8755..origin/master -- packages/modules/{catalog,price_lists,sales_channels,admin_users,orders,quote_requests} packages/platform/src/kernel/sales-channels packages/admin-kit/src/components/{product-picker,product-browser}`.
**Tests**: required (Principle III). Every implementation task is preceded, in the same phase, by
its failing test task.

Abbreviations: `PVR/` = `packages/modules/product_visibility_rules/src/`, `CAT/` =
`packages/modules/catalog/src/`, `PL/` = `packages/modules/price_lists/src/`, `KSC/` =
`packages/platform/src/kernel/sales-channels/`, `CON/` = `packages/contracts/src/`,
`BT/` = `backend/test/`. Module package `@endora-commerce/mod-product-visibility-rules`.

## Format: `[ID] [P?] [Stream] [Story] Description`

- **[P]** parallel within the phase (different files, no dependency).
- **[A]/[B]** stream (plan.md § *Parallel builders*); no tag = foundation, single stream.
- Owner answers that change a task: OQ-A → T028–T031; OQ-D → T042; OQ-E → T043; OQ-F → T044, T059;
  OQ-B (B) adds a phase after Phase 7; OQ-C → T002.

---

## Phase 1 — Foundation: module, contracts, schema (no behaviour)

- [ ] T001 Scaffold `packages/modules/product_visibility_rules/` (package.json, tsconfig, `src/backend/index.ts`
  with empty `registerModule`, `i18n/{en,pl}.json`, `docs/`), mirroring a recent module package
  (`packages/modules/related_payers/`). Register in `pnpm-workspace` globs if needed.
- [ ] T002 `PVR/manifest.ts`: id, `activation` deactivatable **default off** (R-3, OQ-C), permissions
  `product_visibility:read`, `product_visibility:manage` (`requires` read), `dependencies`
  [`catalog`, `price_lists`, `admin_roles`, `currencies`, `sales_channels`, `audit_logs`], palette
  action stubs, `errorCodes` (events-and-errors.md §2). Permission labels pl+en in the module's own
  bundle (`module-admin-surfaces.md` item 4).
- [ ] T003 [P] `CON/product-visibility.ts` (new) + export from `CON/index.ts`: scope, predicate,
  rule definition, admin API request/response schemas (contracts/ports.md §1, §2, §4;
  admin-api.md §1). Tests first: `CON/product-visibility.test.ts` (rule definition limits, nesting,
  threshold enum, overview shape).
- [ ] T004 [P] `CON/errors.ts`: the nine codes of events-and-errors.md §2; `CON/price-lists.ts`:
  `CatalogueReferencePricePort`, `DesignationStatus`, `CataloguePricesChangedEventSchema`.
- [ ] T005 Migration 1 (configuration): `pnpm --filter backend run migration:new -- --module product_visibility_rules --name visibility_configuration`
  — `visibility_categories`, `visibility_category_conditions`, `visibility_role_mappings`,
  `catalogue_price_designations`, `product_rules`, `website_rule_attachments` (data-model.md §1).
- [ ] T006 Migration 2 (derived): `catalogue_price_generations`, `product_catalogue_prices`,
  `variant_catalogue_prices`, `catalogue_price_stale_products`, `website_rule_previews`,
  `website_rule_preview_changes`, `website_rule_stale_products` (§2, §3) with the indexes listed.
- [ ] T007 Entities under `PVR/backend/entities/`; classify each as platform-global in the tenancy
  classification the CI check reads (`specs/conventions/check-inventory.md`).
- [ ] T008 Regenerate and commit: `pnpm --filter backend run composer:generate`,
  `manifests:generate`, `pnpm install --lockfile-only`.

**Verification**: `pnpm --filter @endora-commerce/contracts exec vitest run src/product-visibility.test.ts`;
`pnpm -r run typecheck`; `pnpm run check:naming && pnpm run check:language`;
`pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts test/unit/_i18n/registered-bundles-shape.test.ts`;
migration up/down on a fresh test DB (`backend-test-suite.md` § *Which backend test command*).

---

## Phase 2 — `price_lists`: catalogue reference price and change event (R-4, R-6)

- [ ] T009 [P] Failing unit tests `PL/backend/services/book-pricing.catalogue-reference.test.ts`:
  fixed profile [base, designated]; designated row wins; designated silent → base (OQ-1 b);
  variant lines (fixed and adjustment of base); zero vs unpriced; sale books excluded.
- [ ] T010 [P] Failing integration test `BT/integration/price_lists/catalogue-reference-identity.test.ts`:
  for a channel whose only everyone book is the designated one, `resolve` ≡ `resolveLinePrices`
  (guest, quantity 1) per line, every precedence preset; undesignated ≡ base book.
- [ ] T011 [P] Failing test `…/catalogue-designation-status.test.ts`: every reason of
  `DesignationStatus` incl. `not_regular` (sale book), deleted, unbound, re-audienced, window.
- [ ] T012 Implement `BookPricing.catalogueReference(...)` and `designationStatuses(...)` in
  `PL/backend/services/book-pricing.ts` (reuse `#listingLines`, `resolve(..., fixedProfile)`, the
  `namedBookPublishability` statement + type check); `PL/backend/services/catalogue-reference-price.ts`
  (port implementation incl. `designatableBooks`).
- [ ] T013 Register `catalogueReferencePricePort` with `ctx.di.providePort` in `PL/backend/index.ts`;
  JSDoc per composition item 2/8.
- [ ] T014 Failing test then implementation: `price_lists.catalogue_prices_changed` emitted once
  per bump by the writer from `PL/backend/services/pricing-generation.ts` `afterBump` path, payload
  mapped from `SurfaceChange` (none → not emitted); status-sweep flip emits
  (`BT/integration/price_lists/catalogue-prices-changed-event.test.ts`).
- [ ] T015 [P] Pricing set in the same change (pricing.md): `specs/pricing/current-model.md`
  (consumer + entry point), `worked-examples.md` vectors for the three OQ-1 cases and their test under
  `BT/integration/price_lists/worked-examples/`, `PL` module docs en+pl.
- [ ] T016 Changeset for `@endora-commerce/mod-price-lists` and `@endora-commerce/contracts`
  (`release-intent.md`).

**Verification**: `pnpm --filter @endora-commerce/mod-price-lists exec vitest run src/backend/services/book-pricing.catalogue-reference.test.ts`;
`pnpm --filter backend exec vitest run test/integration/price_lists/catalogue-reference-identity.test.ts test/integration/price_lists/catalogue-designation-status.test.ts test/integration/price_lists/catalogue-prices-changed-event.test.ts test/integration/price_lists/worked-examples test/integration/price_lists/listing-prices-batch.test.ts test/integration/price_lists/pricing-surfaces-agree.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`;
`pnpm --filter backend exec vitest run test/unit/docs/pricing-removed-mechanisms.test.ts`.

---

## Phase 3 — Configuration backend (US2; FR-001, FR-010 – FR-014, FR-020 – FR-024, FR-070, FR-071)

- [ ] T017 [P] Failing integration tests `BT/integration/product_visibility_rules/configuration.test.ts`:
  category CRUD, ≥1 condition, inactive currency kept and shown, delete of mapped category refused
  naming roles (FR-013), `platform_admin` mapping refused (FR-022), designation refused for
  non-regular / non-everyone / unbound / wrong-currency / missing book (RQ-1 A, US2-8) but a draft or
  scheduled book accepted and reported not in force, clear →
  base, ships no categories (FR-014).
- [ ] T018 [P] Failing test `…/configuration-audit.test.ts`: one audit entry per write with actor,
  before, after (FR-070, `audit-state.md`); read permission sees, cannot write (US2-4).
- [ ] T019 Commands under `PVR/backend/commands/` (category, role mapping, designation) and
  `PVR/backend/services/visibility-config.service.ts`; designation validation through
  `catalogueReferencePricePort.designationStatus` + `designatableBooks`.
- [ ] T020 `PVR/backend/routes.admin.ts` (admin-api.md §1 config rows) through `ctx.routes`;
  `requireAdmin('product_visibility:read' | ':manage')` as route `preHandler`.
- [ ] T021 Overview read: role effects (`unrestricted` / `mapped` / `sees_no_products` — OQ-2, OQ-10)
  from `permissionService` + `adminRolePort.list`; designation statuses; served generation.
- [ ] T022 Audit references (`auditReferenceRegistry`) and history labels pl+en.
- [ ] T023 Scheduling hooks: a designation set/clear enqueues a whole rebuild of the currency
  (consumed in Phase 4; until then the job type exists and is a no-op test double).
- [ ] T024 Off-state test `BT/integration/product_visibility_rules/off-state.config.test.ts`: routes
  absent while off (deactivated-while-available case), configuration kept, restored on enable
  (`module-activation.md` item 6).
- [ ] T025 Contract tests for the config API shapes `BT/contract/product_visibility_rules/config-api.contract.test.ts`
  and OpenAPI baseline update.

**Verification**: `pnpm --filter backend exec vitest run test/integration/product_visibility_rules/configuration.test.ts test/integration/product_visibility_rules/configuration-audit.test.ts test/integration/product_visibility_rules/off-state.config.test.ts test/contract/product_visibility_rules`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:command-coverage && pnpm --filter backend run check:error-translations && pnpm --filter backend run check:off-state-coverage`; permission inventory test.

---

## Phase 4 — Catalogue-price flags and the admin scope (US1 core; FR-002 – FR-007, FR-060 – FR-062)

OQ-A answer changes T028 – T031 (recommended A planned).

- [ ] T026 [P] Failing unit tests `PVR/backend/services/admin-visibility-scope.test.ts`: scope per role
  (platform_admin, mapped, unmapped with `rfqs:handle`, unmapped with `*`, unmapped other — FR-021 –
  FR-023); designation not in force drops its currency; inactive currency drops; predicate SQL for
  gt/gte, none ⇒ `null`, no_category ⇒ false; `checkLines` + `noFixedPrice` truth table (FR-043).
- [ ] T027 [P] Failing integration test `BT/integration/product_visibility_rules/catalogue-price-flags.test.ts`:
  SC-001 matrix (4 categories × 5 price states + configurable product) built from real price books;
  generation swap on designation change; targeted refresh after a row write; zero vs none.
- [ ] T028 `PVR/backend/services/catalogue-price-flags.ts`: build generation (batches of 1 000 via
  `catalogueReferencePricePort.resolve`), swap, targeted refresh of marks (batches of 500), delete of
  the old generation (data-model.md §2, R-5).
- [ ] T029 `PVR/backend/workers/catalogue-price-flags-worker.ts` via `ctx.worker` (BullMQ,
  deduplicated job ids per currency / per mark batch, idempotent, `enterSystemScope`).
- [ ] T030 Subscriber (`ctx.subscribe('price_lists.catalogue_prices_changed', …)`) → marks / whole
  rebuild per R-6; nightly safety rebuild (repeatable job). Test
  `BT/integration/product_visibility_rules/flags-change-feed.test.ts` (targeted ≤ 60 s path; catalogue-wide → rebuild).
- [ ] T031 `PVR/backend/services/admin-visibility-scope.ts`: `resolveScope` per request (role via
  `permissionService.resolveRole`, mapping, `designationStatuses`, active currencies via
  `currencyReadPort`), `productPredicate`, `variantPredicate`, `checkLines` (live, R-8). Every consumer applies `designationStatuses` at read time — flags and
  `resolve` answer the designation as if in force (R-4).
- [ ] T032 Register `adminProductVisibilityPort` with `ctx.di.providePort` (JSDoc: owner-off
  sentence for `degrades-without` consumers).
- [ ] T033 First-enable / re-enable bootstrap: on presence change to on (boot-time check of
  `catalogue_price_generations`), enqueue a build of every active currency; until a currency has a
  served generation its conditions are not met (fail-closed). Test in `…/flags-bootstrap.test.ts`.
- [ ] T034 Perf bench `BT/perf/product_visibility_rules/admin-list-visibility.bench.ts` (R-16; 50 000
  products, 150 000 variants, 3 currencies): rebuild time per currency, targeted refresh latency,
  predicate cost in isolation. Record numbers in research.md R-5/R-16.

**Verification**: `pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/services/admin-visibility-scope.test.ts`;
`pnpm --filter backend exec vitest run test/integration/product_visibility_rules/catalogue-price-flags.test.ts test/integration/product_visibility_rules/flags-change-feed.test.ts test/integration/product_visibility_rules/flags-bootstrap.test.ts`;
`pnpm --filter backend run check:subscribe-seam && pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:module-boundary`;
`PERF_RUN=true pnpm --filter backend exec vitest run test/perf/product_visibility_rules/admin-list-visibility.bench.ts` (recorded, not CI).

---

## Phase 5a — [A] Catalog admin reads and writes (US1; FR-030 – FR-036, FR-038, RQ-3 A)

Stream A owns `packages/modules/catalog/**`.

- [ ] T035 [P] [A] Failing contract test `BT/contract/catalog/visibility-by-id-inventory.test.ts`: derive
  every registered route under `/api/v1/admin/catalog/products/:id|:productId` (+ `variants/:variantId`)
  from the app; per route and method, a hidden product (and a hidden variant) answers exactly as a
  random non-existent id (status + `error.code`) and writes nothing — for each request shape: valid
  body/query, schema-invalid body, schema-invalid query, semantically invalid body (the guard must not
  answer before validation, R-7); unrestricted unchanged (FR-033, RQ-3 A). Price-book and SEO routes outside `catalog` unaffected (FR-038, US1-10).
- [ ] T036 [P] [A] Failing integration test `BT/integration/catalog/visibility-list.test.ts`: list both
  branches, `total`, `counts` (incl. early-empty return), paging 30/12 → pages 10 + 2 (US1-4, SC-002),
  `resolve-ids`, `batch-by-id`, `/variants`, `visibility` flag and no-category message (US1-6, US1-11),
  admin global search incl. `hasMore` (FR-034); platform admin and unrestricted **byte-identical**
  responses to a module-absent run (SC-003); a restricted user's PATCH / scoped-values / bulk write
  on a visible parent leaves its non-qualifying variants unchanged — never edited, dropped or replaced
  (spec edge case *Saving a visible product…*, US1-12).
- [ ] T037 [A] `CAT/backend/index.ts`: resolve `adminProductVisibilityPort` per request behind
  `effectiveState.isPresent('product_visibility_rules')`; `CAT/manifest.ts` `nonBindingDependencies`
  entry kind `degrades-without` with `whenAbsent` + reason (composition item 4a).
- [ ] T038 [A] `CAT/backend/services/catalog-admin.service.ts`: thread the scope into `listProducts`
  (restricted ⇒ statement branch), `#adminListFilters`, `#productListCounts`, `resolveProductIds`,
  `listProductsByIds`, `listVariants`; product detail's embedded variants (R-7); writes through the
  parent merge hidden variants back untouched (a payload that omits them never deletes them).
- [ ] T039 [A] `CAT/backend/services/catalog-admin-search.service.ts` + `admin-search-provider.ts`:
  predicate inside the search statement; the provider passes `adminUserId` (already on the contract,
  `CON/admin-search.ts:267`).
- [ ] T040 [A] `CAT/backend/routes.admin.ts` (+ `routes.admin.url-keys.ts`): one guard for the
  product-id route family that runs **after schema validation** (not in the declared `preHandler` chain,
  which the platform moves to `preValidation` — `packages/platform/src/http/guards-before-validation.ts`),
  answering the canonical not-found; routes that answer a non-existent id differently before their own
  lookup get the check inside that lookup (R-7). T035 decides which.
- [ ] T041 [A] Bulk update (`CAT/backend/services/catalog-bulk-update.service.ts`, bulk-operation
  worker): hidden ids absent at request and again for the requester in the worker; select-all
  resolution narrowed.
- [ ] T041a [A] Price book grid (spec edge: *the price book grid itself lists only visible products
  and … only its qualifying variants*): the grid's product segment is cut by `catalog`'s
  `pageProductsByAdminName` port (`PL/backend/services/price-book-reads.ts:426-440`); the port takes
  the caller's admin id and applies `productPredicate` in its statement (count included).
- [ ] T041b [A] `PL/backend/services/price-book-reads.ts` `lines` page: pass the admin id to T041a,
  drop non-qualifying variant lines through `adminProductVisibilityPort.filterVisible`; `PL/manifest.ts`
  `degrades-without` entry. Row **edits** by product id stay unrestricted (FR-038). Test
  `BT/integration/price_lists/book-lines-visibility.test.ts`.

**Verification (5a)**: `pnpm --filter backend exec vitest run test/contract/catalog/visibility-by-id-inventory.test.ts test/integration/catalog/visibility-list.test.ts test/integration/price_lists/book-lines-visibility.test.ts test/contract/catalog/admin-list-routes.test.ts test/contract/catalog/products-resolve-ids.test.ts test/contract/catalog/products-admin-list-filters.test.ts test/contract/catalog/admin-product-variants-read.test.ts test/contract/catalog/admin-variants.test.ts`;
`pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/admin-search-provider.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches && pnpm --filter backend run check:module-boundary`.

## Phase 5b — [A] Catalog: cross-references, assistant tools, hookable actions, off state

- [ ] T042 [A] OQ-D (recommended A): links / grouped items / bundle options omit hidden targets for
  restricted callers; adding a hidden target answers target-not-found. Tests in
  `BT/integration/catalog/visibility-cross-references.test.ts`.
- [ ] T043 [A] OQ-E (recommended A): assistant tools `catalog` contributes to `promptActionToolRegistry`
  narrow product reads by the invoking admin's scope; document the unique-key oracle in the module docs.
- [ ] T044 [A] `CAT/manifest.ts`: declare `product.update`, `product.restore`, `product.bulk_update`
  (and, per OQ-F, `product.scopes.update`, `product.scoped_values.save`) hookable (`beforeCommit`) with their hook data contracts (needed by T059); contract-surface entry +
  changeset.
- [ ] T045 [A] Off-state test `BT/integration/catalog/visibility-off-state.test.ts`: module off ⇒
  every read/write above identical to module-absent; on again ⇒ narrowing back.

**Verification (5b)**: `pnpm --filter backend exec vitest run test/integration/catalog/visibility-cross-references.test.ts test/integration/catalog/visibility-off-state.test.ts test/contract/catalog/visibility-by-id-inventory.test.ts`;
`pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches && pnpm --filter backend run check:module-boundary`;
`PERF_RUN=true` bench of T034 extended to HTTP pages (budget R-16) — recorded.

---

## Phase 6 — [B] Website rule backend (US4; FR-050 – FR-053, FR-055 – FR-058, FR-061, FR-072)

Stream B owns the files listed in plan.md § *Parallel builders*.

- [ ] T046 [P] [B] Failing unit tests `PVR/backend/services/product-rule-evaluator.test.ts`: all/any,
  one nesting level, boolean / choice / price conditions, missing value ⇒ not met (FR-057),
  inactive / archived / deleted never member.
- [ ] T047 [P] [B] Failing integration tests `BT/integration/product_visibility_rules/website-rule.test.ts`:
  attach requires preview (FR-053); counts per channel; confirm applies **exactly** the snapshot
  (SC-004); stale preview refused; second rule on a channel refused, one rule on two channels
  (US4-7); detach leaves membership (FR-058); no rule ⇒ membership unchanged on install/enable
  (US4-1, FR-052); audit `source` names the rule (FR-072).
- [ ] T048 [B] `PVR/backend/services/product-rule-evaluator.ts` (pure) + rule Commands and routes
  (create/update/delete; attribute validation through `catalogAttributeReadPort`).
- [ ] T049 [B] Preview job + tables, confirm (`attach` / `change` Commands), apply job writing the
  snapshot with the governor token in transactions of 500 (`PVR/backend/services/website-rule.service.ts`,
  `PVR/backend/workers/website-rule-worker.ts`).
- [ ] T050 [B] Steady state: marks from `product.created.v1` / `product.updated.v1` /
  `product.archived.v1` / `product.deleted.v1` and from flag refreshes; debounced evaluation job (30 s);
  window-boundary delayed jobs from `designationStatus.window`; hourly reconcile per governed channel.
  Test `…/website-rule-timing.test.ts`: attribute, price, schedule and rule changes reach membership
  within the bound (US4-2, US4-5, SC-005) — with a controllable clock.
- [ ] T051 [B] `productRuleGovernancePort` (FR-055) via `ctx.di.providePort` + test.
- [ ] T052 [B] Off-state test `…/off-state.website-rule.test.ts`: no evaluation, jobs left waiting,
  memberships as last computed; on again ⇒ reconcile enqueued.

**Verification**: `pnpm --filter @endora-commerce/mod-product-visibility-rules exec vitest run src/backend/services/product-rule-evaluator.test.ts`;
`pnpm --filter backend exec vitest run test/integration/product_visibility_rules/website-rule.test.ts test/integration/product_visibility_rules/website-rule-timing.test.ts test/integration/product_visibility_rules/off-state.website-rule.test.ts`;
`pnpm --filter backend run check:subscribe-seam && pnpm --filter backend run check:port-dependencies`.

---

## Phase 7 — [B] Kernel governance and admission (US4; FR-054, FR-059)

- [ ] T053 [P] [B] Failing unit tests `KSC/sales-channel-membership.governor.test.ts`: per method
  (`addToChannel`, `removeFromChannel` incl. fallback, `bindToDefaultIfEmpty`, `copyMemberships`,
  `replaceChannelsForEntity`, `clearChannelsForEntity`) × (ungoverned, governed skip, governed refuse,
  governor token); zero-channel floor waived only for a token write and for a request that named a
  governed channel which was skipped (`bindToDefaultIfEmpty` onto a governed default,
  `replaceChannelsForEntity` naming only governed channels) — every other last-channel removal still
  refused (R-10); governor of an absent module ignored; non-product entity types untouched.
- [ ] T054 [B] `KSC/membership-governors.ts` (registry + token) and
  `KSC/sales-channel-membership.service.ts` semantics (R-10); `packages/platform/src/kernel/ports/sales-channel.ts`
  additive options/result; error code + pl/en message; audit `source`. Changeset for
  `@endora-commerce/platform` (contract-surface: additive).
- [ ] T055 [B] `packages/modules/sales_channels/src/backend/routes.admin.ts:387-431`: pass
  `onGoverned: 'refuse'`; contract test `BT/contract/sales_channels/governed-membership.contract.test.ts`
  (US4-3 manual refusal, translated, membership unchanged).
- [ ] T056 [B] `PVR/backend/services/membership-governor.ts`: `governs` reads
  `website_rule_attachments` on the passed `em`; contributed from the module's boot hook (contribution
  sink, filtered by presence); token held by the website-rule service only.
- [ ] T057 [A] (after T054 is on the shared branch) `CAT/backend/services/catalog-bulk-update.service.ts:562,570,576`:
  `onGoverned: 'refuse'` + enqueue-time refusal when the patch names a governed channel; test in
  `BT/integration/catalog/bulk-update-governed-channel.test.ts`.
- [ ] T058 [P] [B] Failing integration test `BT/integration/product_visibility_rules/admission.test.ts`:
  create / duplicate / import / a connector-shaped `replaceChannelsForEntity` + `addToChannel` call on
  a governed channel are skipped, other channels written (US4-3); new and reactivated products are
  never on the governed channel before admission and are admitted ≤ 5 min (US4-6, FR-059, SC-005).
- [ ] T059 [B] `beforeCommit` command hooks (needs T044) on `product.update`, `product.restore`,
  `product.bulk_update` (and, per OQ-F recommendation, `product.scopes.update` and the scoped-values
  save for a channel-scoped status moving to active on a governed channel): transition to active /
  un-archive ⇒ remove the governed membership(s) in the same transaction with the token and mark the
  product (R-11). Prove that remove + re-admit keeps the product's channel-scoped values. Catalog must
  declare those two actions hookable too (extend T044).
- [ ] T060 [B] Off-state test `BT/integration/product_visibility_rules/off-state.governance.test.ts`:
  module off ⇒ no write refused or skipped, hook not run (FR-073).

**Verification**: `pnpm --filter @endora-commerce/platform exec vitest run src/kernel/sales-channels`;
`pnpm --filter backend exec vitest run test/contract/sales_channels/governed-membership.contract.test.ts test/integration/catalog/bulk-update-governed-channel.test.ts test/integration/product_visibility_rules/admission.test.ts test/integration/product_visibility_rules/off-state.governance.test.ts test/contract/kernel/harness-parity.test.ts`;
`pnpm --filter backend run check:kernel-boundary && pnpm --filter backend run check:platform-surface && pnpm --filter backend run check:port-catches`.

### ✅ Review checkpoint 1 — backend block (after Phases 1 – 7)

`qa-engineer`, `code-reviewer`, `security-engineer` in parallel on a model other than the
author's, against the threat model below; `product-owner` checks FR-001 – FR-038, FR-050 – FR-075
traceability. Gate: findings closed before Phase 8.

---

## Phase 8 — Admin UI (US2, US4, FR-023 banner, FR-024, FR-071, FR-074)

- [ ] T061 [P] Failing component tests `admin/test/modules/product_visibility_rules/ConfigurationPage.test.tsx`:
  categories, designations (only designatable books offered; not-in-force reason shown), role
  mapping (`platform_admin` not offered; "sees no products" listed), read-only for `:read`.
- [ ] T062 `PVR/admin/pages/ConfigurationPage.tsx` + API client; admin-kit primitives only (IX).
- [ ] T063 [P] Failing tests `…/WebsiteRulesPage.test.tsx`: rule editor (attribute picker limited to
  boolean/choice non-scoped), attach flow with mandatory preview → confirm, stale/expired handling,
  detach.
- [ ] T064 `PVR/admin/pages/WebsiteRulesPage.tsx` (+ preview polling).
- [ ] T065 Role screens (R-14): add zones `admin_users.roles.list.columns` and
  `admin_users.roles.editor.aside` to `AdminZoneNameSchema` + props map and render them in
  `packages/modules/admin_users/src/admin/pages/AdminRolesPage.tsx`; module contributions; test
  `admin/test/modules/admin_users/AdminRolesPage.visibility-zone.test.tsx`.
- [ ] T066 Product list banner for no-category / restricted callers from the list response's
  `visibility` field (catalog admin, stream A file `CAT/admin/…` — coordinate) — FR-023 message.
- [ ] T067 Palette actions (two), nav entry with `requiredPermission`, i18n pl+en for every string
  incl. the FR-073 warning on the module screen.
- [ ] T068 Off-state UI test: no nav, palette, zone contribution, banner while off.
- [ ] T069 UX pass against `.claude/skills/ux-laws/SKILL.md` (states: loading, empty, error,
  refused, building generation).

**Verification**: `pnpm --filter admin exec vitest run test/modules/product_visibility_rules test/modules/admin_users/AdminRolesPage.visibility-zone.test.tsx test/unit/palette-coverage.test.ts`;
`pnpm --filter backend run check:admin-zones`; `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`;
`pnpm --filter admin run typecheck && pnpm --filter admin run lint`.

### ✅ Review checkpoint 2 — UI block

`designer` + `code-reviewer` + `qa-engineer` in parallel (different model from the author);
`product-owner` accepts US1, US2, US4 against quickstart.md.

---

## Phase 9 — GATED: lines, picker, marker (US3, FR-037, FR-040 – FR-043, RQ-2 C)

**Do not start until spec 192 (issue #1901) has merged to `master`.** Then rebase, re-measure
`quote_requests/backend/services/rfq-admin-service.ts`, `RfqCreatePage.tsx`, `RfqDetail.tsx`,
`packages/admin-kit/src/components/product-picker/ProductPicker.tsx`,
`packages/admin-kit/src/components/product-browser/product-browser-api.ts`, and update this phase's
paths. (The coordinator may release T070 – T071 earlier — plan.md § *Sequencing*.)

- [ ] T070 [P] Failing integration test `BT/integration/orders/admin-order-visibility.test.ts`: create,
  preview, reorder refuse an out-of-category product or variant naming the line, nothing saved; no
  marker on order create; storefront reorder / clone untouched; unrestricted unchanged (US1-9,
  US1-13, FR-037, FR-039, RQ-2 C).
- [ ] T071 `packages/modules/orders/src/backend/routes.ts` (`/api/v1/admin/orders`, `/preview`,
  `/:id/reorder`): `checkLines` behind presence probe; `orders/manifest.ts` `degrades-without` entry.
- [ ] T072 Clone-to-quote (`orders/backend/services/order-clone-to-quote-service.ts`): same refusal.
- [ ] T073 [P] Failing test `BT/integration/quote_requests/visibility-lines.test.ts`: create / add line /
  change product refused naming lines (US3-1); existing out-of-category line editable and removable,
  product not changeable, not re-addable (US3-2, FR-042); per variant (US3-5).
- [ ] T074 `quote_requests` (`RfqAdminService` create / modify as left by 192): `checkLines`;
  `quote_requests/manifest.ts` `degrades-without` entry.
- [ ] T075 `catalog` list/variant rows: `noFixedPrice` for restricted callers (contracts additive,
  stream A file).
- [ ] T076 [P] Failing component tests for the admin-kit picker and browser: only qualifying variants;
  marker shown only when the host passes `showNoFixedPriceMarker` (quote screens), never for
  unrestricted (US3-3, OQ-12).
- [ ] T077 `packages/admin-kit/src/components/{product-picker,product-browser}` + quote screens pass the
  marker flag; i18n pl+en of the marker (fixed text).
- [ ] T078 Off-state tests for orders and quote lines (module off ⇒ no refusal, no marker).

**Verification**: `pnpm --filter backend exec vitest run test/integration/orders/admin-order-visibility.test.ts test/integration/quote_requests/visibility-lines.test.ts test/integration/quote_requests test/contract/quote_requests`;
`pnpm --filter '@endora-commerce/admin-kit' exec vitest run src/components/product-picker src/components/product-browser`;
`pnpm --filter admin exec vitest run test/modules/quote_requests`; `check:port-dependencies`, `check:port-catches`.

### ✅ Review checkpoint 3 — gated block

Same reviewers; `product-owner` accepts US3.

---

## Phase 10 — Documentation, release intent, final verification

- [ ] T079 [P] Module documentation en + pl (`PVR`'s package-root `docs/`, `module-documentation.md`):
  configuration, timing table (plan.md), off-state warning, connector note (R-10), unique-key oracle (OQ-E).
- [ ] T080 [P] `docs/docs/architecture/` note on the membership governor (kernel) en + pl.
- [ ] T081 Changesets for every touched package (`release-intent.md`); contract-surface entries for
  the new ports and the kernel options (`contract-surface.md`).
- [ ] T082 Regenerate and verify generated artefacts (`composer:generate`, `manifests:generate`,
  lockfile); grep `backend/test/**` for anything derived from moved/added paths (AGENTS.md traps).
- [ ] T083 Perf: run T034 bench end to end; record restricted vs unrestricted p95 and rebuild times in
  research.md R-16 and `specs/pricing/read-paths-and-performance.md` §7 (new row).
- [ ] T084 Walk quickstart.md on a fresh `pnpm run setup` database; record results in the PR.

**Verification**: `pnpm -r run typecheck && pnpm -r run lint`; `pnpm --filter backend run test:unit:fast`;
`pnpm --filter '!backend' run test` for touched packages; the targeted backend files of Phases 2 – 9;
full backend suite runs on `master` after merge (D-198).

---

## FR → test map

| FR | Tests |
| --- | --- |
| FR-001 – FR-007 | T009 – T011, T017, T026, T027 |
| FR-010 – FR-014 | T003, T017 |
| FR-020 – FR-024 | T017, T026, T061, T065 |
| FR-030 – FR-036, FR-038 | T035, T036, T041a, T041b, T042, T043, T045 |
| FR-037, FR-039 | T070, T072 (gated) |
| FR-040 – FR-043 | T073, T076 (gated) |
| FR-050 – FR-053, FR-056 – FR-058 | T046, T047 |
| FR-054, FR-055, FR-059 | T053, T055, T057, T058, T051 |
| FR-060 – FR-062 | T026, T030, T050 (bounds per OQ-A) |
| FR-070 – FR-075 | T018, T024, T045, T052, T060, T068, T078, T067 |
| SC-001 – SC-007 | T027, T036, T047, T050, T058, T034/T083 |

## Threat-model items (for `security-engineer`, before Phase 4 and on the diff)

1. Role-based read filtering is server-side on every listed surface; client hiding never counts
   (FR-036). Scope derived from the session's admin id only, never from a request field.
2. Enumeration: `total`, status `counts`, `hasMore`, page sizes, select-all and batch-by-id totals
   must not reveal hidden products (FR-031, FR-034); by-id answers byte-equal to non-existent
   (T035), including timing-insensitive paths (no extra lookups that differ observably).
3. Existence oracles left open by design: unique SKU / URL-key conflicts (OQ-E); line refusal code
   distinct from not-found (R-8) — the caller supplied the id.
4. Cross-references naming hidden products (links, grouped items, bundle options — OQ-D);
   audit-log / history views showing product names of hidden products (out of scope, note).
5. Non-request contexts: bulk-operation worker re-checks the requester's scope; assistant tools
   (OQ-E); exports and product feeds are out of scope (FR-038).
6. Caching: no server-side response cache keyed without the scope; the module caches nothing per
   role (R-7); admin-kit client caches are per session.
7. Fail-closed: no-category roles see nothing; a currency whose designation is not in force or not
   yet built contributes nothing; module present but failing ⇒ 5xx, never unfiltered.
8. Off switch lifts every restriction (FR-073): who holds the module-activation permission; the
   activation control's warning; audit of the flip.
9. Governor token: unforgeable in-process; only the website-rule service holds it; a connector
   cannot write a governed channel; manual writes refused with a message that names the rule only
   to callers who already hold channel write permission.
10. Audit: every configuration write and every rule-driven membership change attributable
    (FR-070, FR-072); no amounts in event payloads (events-and-errors.md §1).
