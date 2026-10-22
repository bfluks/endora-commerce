# Tasks: product data scopes per sales channel and language

**Feature**: `specs/162-product-data-scopes/` | **Issues**: #385, depends on #384
**Input**: `spec.md` (clarify rounds 1–4), `plan.md`, `research.md` (R0–R29), `data-model.md`,
`contracts/{product-scopes,admin-scopes-api,url-keys-and-redirects,consumers,seo-media-attachments,error-codes}.md`,
`quickstart.md`. Measured on `origin/master` `aa6891d63`.

**Organisation**: 25 phases, each ≤ 10 tasks and sized for part of one builder spawn, grouped into **7
blocks of ≤ 4 phases** (one builder spawn each), with a **review checkpoint after every backend block and
every UI block**. Tests are mandatory (Principle III): inside every phase each `RED` task precedes the task
that makes it pass — run it and see it fail first. Task ids are stable: a task added later takes a letter
suffix (`T056a`), never a renumbering.

## Format

`- [ ] T### [P?] [US?] [PG?] [S#] description — file path(s)`

- **[P]** — parallel with its neighbours (different files, no unfinished dependency).
- **[US1…US10]** — the spec's user story; none = foundational or cross-cutting.
- **[PG]** — needs Postgres + Redis + Meilisearch. **Not run on the workstation**: it runs in the fork's
  `ci-pg` job on the draft PR (the hosted gate). Write it, make it compile, push, read the job.
- **[S1] / [S2] / [S3]** — the stream that owns the task (see *Streams*).
- **RED** — the deliverable is a failing test.
- **⛔384** — the phase edits a file #384 changes; do not start it before #384 is on `origin/master`
  and this branch is rebased onto it (or the coordinator has chosen to stack on
  `fork/fix/storefront-channel-value-overrides`).

## Rules for every phase (read once)

- **Every commit `git commit -s`** (the `dco` job). Never add `Co-Authored-By` or any AI trailer. English,
  conventional commits: `feat(catalog): …`, `test(search): …`, `docs(162): …`.
- After editing anything under `packages/`, rebuild it (`pnpm --filter <package> run build`) **before**
  running any backend, admin or storefront test — tests read `dist`, `tsc` reads sources.
- **Test helpers import services from `dist`** through the package specifier
  (`@endora-commerce/mod-<id>`, `backend/test/helpers/package-entities.ts`), never from a package's `src`.
- Module unit tests live beside their subject (`packages/modules/<id>/src/backend/**/*.test.ts`); never
  beside `src/manifest.ts`. Admin tests: `admin/test/modules/<module>/`; storefront:
  `storefront/test/<area>/`; backend contract/integration: `backend/test/{contract,integration}/<module>/`.
- Non-`[PG]` commands: contracts `pnpm --filter @endora-commerce/contracts exec vitest run <src path>`;
  a module `pnpm --filter @endora-commerce/mod-<name> exec vitest run <path under the package>`; backend
  unit `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <path>`; admin
  `pnpm --filter admin exec vitest run <path>`; storefront `pnpm --filter storefront exec vitest run <path>`.
- **`pnpm -r` is reserved for the final gate (Phase 25).** In a phase, type-check each package it touched
  by name, plus `backend` when backend tests changed.
- After a migration, an entity, a manifest or an error-code change: `pnpm --filter backend run
  composer:generate`, `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`; commit
  every regenerated artefact **in the same commit**. If `composer:generate` rewrites a
  `docs/docs/module-reference/<module>.md`, refresh its Polish cache entry and materialised page in the same
  commit, then `pnpm --filter backend run check:docs-translations`.
- Migrations are scaffolded, never numbered: `pnpm --filter backend run migration:new -- --module <id>
  --name <slug>` (`specs/conventions/module-migrations.md`).
- **A new error code lands in one commit** (`contracts/error-codes.md`). All five of this feature's codes
  are minted in Phase 2 so no later stream touches the ledgers.
- **No consumer tests a status value.** Availability is the port (`filterAvailable`) or the pure rule;
  SQL narrowing goes **in the statement the page is cut from** (issue #151), never after it.
- **Every buyer seam keeps one `PRODUCT_NOT_FOUND`** for unavailable / out-of-channel / out-of-audience /
  absent. No new code reaches a buyer.
- Every `catch` around a port call has `rethrowIfModuleDisabled(err)` as its first line.
- Contract/integration tests use per-run unique fixture names; restore any setting they flip.
- Public repository: English outside bundles; no customer names; issue ids only #384/#385.

## Streams and file ownership

Up to three builders, each in its own worktree (`git worktree add ../wt-162-<stream> -b
feat/162-product-data-scopes-<stream> <S1 tip>` then `bash ../wt-162-<stream>/scripts/setup-worktree.sh`;
never a symlinked `node_modules`). Stream branches are cherry-picked onto `feat/162-product-data-scopes` at
phase boundaries by the coordinator.

| Stream | Branch | Phases | Owns (may edit freely) |
| --- | --- | --- | --- |
| **S1** backend availability | `feat/162-product-data-scopes` (primary checkout) | 1–12, 21, 22, 24, 25 | `packages/contracts/src/product-scopes.ts`; catalog scope entities/services/migrations (`product-channel-*`, `product-availability*`, `effective-value.sql.ts`, `scope-*`, `publication-window-sweep.ts`, media/attachment/packaging changes); consumer seams in `search`, `carts`, `orders`, `quote_requests`, `comparisons`, `shopping_lists`, `quick_order`, `product_feeds`, `import_export`; `backend/test/**` files it creates |
| **S2** URL keys + SEO | `feat/162-product-data-scopes-urlkeys` | 16–19 | `packages/contracts/src/product-url-keys.ts`; `packages/contracts/src/seo.ts` from P18 on (S1 adds `SeoProductMetaPort` there in P2, T010, then hands it over); catalog `url-key*.ts`, `product-url-*.entity.ts`, the `product_url_keys` migration, `routes.admin.url-keys.ts`, `routes.public.url-keys.ts`; everything under `packages/modules/seo/`; `storefront/app/(catalog)/p/[slug]/**`, `storefront/lib/api/catalog.ts` |
| **S3** admin UI | `feat/162-product-data-scopes-admin` | 13–15, 20, 23 | `packages/modules/catalog/src/admin/**`, `packages/modules/seo/src/admin/**` (Phase 20 only, after S2 hands `seo` back), `admin/test/modules/catalog/**` |

**Single-owner shared files — S1 only.** `packages/contracts/src/index.ts`, `errors.ts`, `catalog.ts`;
`packages/modules/catalog/src/manifest.ts`, `src/backend/index.ts`, `routes.admin.ts`, `routes.public.ts`;
`packages/modules/catalog/i18n/{en,pl}.json`; `backend/test/fixtures/error-code-routing/reference-ledgers.ts`;
every generated artefact (`backend/src/db/*.generated.ts`, `manifest-index.generated.ts`, module-reference
pages, package manifests), `pnpm-lock.yaml`, the `AGENTS.md` appendix, `.changeset/`. S2 and S3 put any
line they need in such a file into **one separate commit per phase**, titled `chore(162): <stream> handover
P<n>`, touching only shared files; the coordinator applies it on S1 at the boundary. A stream that adds a migration, entity or error code
**also regenerates and commits the generated artefacts on its own branch** (so its own `ci-pg` run has them
registered); when the coordinator applies the stream's commits to S1, the generated files are **not**
cherry-picked — S1 regenerates them on its tip and commits the result.

## Blocks, review checkpoints and the #384 gate

| Block | Phases | Stream | Kind | Gate to start |
| --- | --- | --- | --- | --- |
| A | 1–4 | S1 | backend | now |
| — | **Review checkpoint A** (code review + security review, parallel) | | | |
| B | 5–8 | S1 | backend | ⛔384 merged, branch rebased |
| — | **Review checkpoint B** | | | |
| C | 9–12 | S1 | backend | Block B, **and P16 applied on S1** (T069 reads `product_url_keys`); P12 also after P18 is applied (`catalog-query.service.ts` sequence) |
| — | **Review checkpoint C** | | | |
| D | 13–15 | S3 | admin UI | P13 after Block A; P14 after P9 (T093 needs T070, T095a–b need T071); P15 after P10–P11 |
| — | **Review checkpoint D** (code review + designer UX audit) | | | |
| E | 16–19 | S2 | backend + storefront | P16 after Block A; P17–P19 after **Block B complete** (⛔384; P8 and P17 both edit `catalog-query.service.ts`, P7 and P17 both edit `sitemap-generator.service.ts`) |
| — | **Review checkpoint E** | | | |
| F | 20–23 | S3 (20, 23), S1 (21, 22) | mixed | P21–P22 after Block B **and P18 applied on S1** (P21 hosts the SEO overview tasks T118a/T118c, and `catalog-query.service.ts` runs in sequence); P20 after P17–P18; P23 after P21–P22 |
| — | **Review checkpoint F** (backend: 21–22; UI: 20, 23 with designer) | | | |
| G | 24–25 | S1 | cross-cutting | every block merged |
| — | **Final review pack** + green remote CI; coordinator re-asks Q1 (T156) | | | |

## Dependency chain

```text
P1 ─► P2 (contracts, codes) ─► P3 (schema) ─► P4 (scope writes, events)
        │                                       ├─► P13 (admin scope controls)          [S3]
        │                                       └─► P16 (URL-key storage + writes)       [S2]
⛔384 ─► P5 (availability SQL, port, catalog reads) ─► P6 (acquisition seams) ─► P7 (search, sitemap, feeds, sweep) ─► P8 (effective names, perf)
P8 (Block B done) ─► P17 (key resolution, storefront redirect) ─► P18 (SEO C×L) ─► P19 (connectors, import)   [S2]
P8, P16 ─► P9 (overview, FR-090) ─► P14 (overview UI)                                           [S3]
P8 ─► P10 (bulk) ─► P11 (gate; T080a fills the overview's `missing`) ─► P15 (bulk + gate UI)   [S3]
P8 ─► P12 (order rules per channel)
P8 ─► P21 (media) ─► P22 (attachments, packaging) ─► P23 (media UI)                             [S3]
P17, P18 ─► P20 (URL-key + SEO UI)
P18 ─► P21 (SEO in the overview: T118a/T118c)
P9 ─► P14 (attribute scope-flag preview UI: T095a/T095b)
all ─► P24 (off-state, parity, docs, changesets) ─► P25 (final gate)
```

`catalog-query.service.ts` is edited by P5, P8, P12, P17, P18, P21, P22: those phases run **in sequence**.
S2 starts P17 only after Block B is merged and rebases onto S1's tip first; while P17–P18 run, S1's P12,
P21 and P22 wait (S1 works on P9–P11 meanwhile, which do not touch that file).

---

## Block A — S1 backend foundation (not gated on #384)

### Phase 1: Setup and baseline

**Goal**: a known-good baseline and the #384 status recorded.

- [ ] T001 [S1] Confirm the branch is on `origin/master` (rebased 2026-10-21 onto `aa6891d63`); `git fetch origin fork`; record whether #384 (`fork/fix/storefront-channel-value-overrides`) is merged, and if not, whether the coordinator chose to stack — write the answer under this task
- [ ] T002 [S1] `bash scripts/setup-worktree.sh && pnpm run build:packages`
- [ ] T003 [S1] Baseline: `pnpm --filter @endora-commerce/contracts run test`, `pnpm --filter @endora-commerce/mod-catalog run test`, `pnpm --filter @endora-commerce/mod-search run test`, `pnpm --filter @endora-commerce/mod-carts run test`; note any pre-existing red in the PR description
- [ ] T004 [S1] Open the fork draft PR so `ci-pg` runs from the first push; record the PR URL here

**Verification**:
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/docs/agents-router.test.ts`

### Phase 2: [backend] Contracts — the rule, the shapes, the codes (Principle II)

**Goal**: every pure rule and every additive Zod shape exist with tests; all five error codes minted; every
consumer still compiles.

- [ ] T005 [P] [S1] RED unit test of the rule — every row of `data-model.md` §4; `inactive` at C/C×L is off and never "gone" (FR-010); inclusive window edges to the millisecond (K4, US2 #5); overridden open window beats a bounded global one; audience override replaces the whole rule (US3 #3); orphans ignored (non-member, language not offered); `effectiveOrderRules`; `pairsTurningOn` (global switch, channel row covering all languages, C×L row, non-members ignored — N3) **and its M3 → A non-trigger cases**: snapshots differing only in window (incl. a window that opens now) or only in audience → `[]` (status is the only input compared) — `packages/contracts/src/product-scopes.test.ts`
- [ ] T006 [P] [S1] RED unit test of `resolveScopeLanguage` — exact, case-insensitive, base-language (`pl` → `pl-PL`), unknown → channel default, `null` → default (A-3, R7) — same file
- [ ] T007 [P] [S1] RED schema tests — `patchProductScopesRequestSchema` (absent vs `null`, window `from < until` refused at service not schema, MOQ range), `productScopesResponseSchema`, `scopeOverviewResponseSchema` (incl. optional `cells[].missing`: absent accepted, `[]` accepted, `['name','urlKey','attribute:color']` accepted, an unknown token such as `'sku'` refused — FR-041), `scopeMissingValueSchema` shared by `ScopeWarning.missing` and the cell, `bulkUpdateFieldsObject.scopedStatus` (refine counts it; combined with `status` refused), `productKeyResolutionSchema`, `putProductUrlKeysRequestSchema`; **`productPath({ key, languageCode, channelDefaultLanguage })`** — `/p/<key>` for the default language, `/p/<key>?lang=<L>` otherwise, key URL-encoded, case of L preserved (D7, Q-B: the one URL seam) — `packages/contracts/src/product-scopes-shapes.test.ts`, `packages/contracts/src/product-url-keys.test.ts`
- [ ] T008 [S1] Implement `product-scopes.ts` per `contracts/product-scopes.md` §1–§3 and `admin-scopes-api.md` (shapes — one `scopeMissingValueSchema` used by `ScopeWarning`, `SCOPE_INCOMPLETE` details and `scopeOverviewResponseSchema.cells[].missing`; `pairsTurningOn` compares effective status only, M3 → A), incl. `CatalogProductAvailabilityPort`, `CatalogProductScopeWritePort` types — `packages/contracts/src/product-scopes.ts`
- [ ] T009 [S1] Create `product-url-keys.ts` with the shapes of `contracts/url-keys-and-redirects.md` §1–§5, `CatalogProductUrlKeyReadPort` and the pure `productPath()` helper — the **only** place a product URL is composed; storefront, `seo`'s sitemap and catalog's admin/resolve answers import it, so the owner's later language-path-prefix issue edits this function alone (S2 owns the file from Phase 16 on) — `packages/contracts/src/product-url-keys.ts`
- [ ] T010 [S1] Additive edits: bulk `scopedStatus` + reasons `scope_invalid`, `completeness_gate` (`catalog.ts:791`, `:817`); `CatalogProductRecord.publishFrom?/publishUntil?` (optional, permanently — fixtures build record literals); `SeoProductMetaPort` in `seo.ts`; barrel exports — `packages/contracts/src/{catalog,seo,index}.ts`
- [ ] T011 [S1] Mint `SCOPE_INVALID`, `SCOPE_INCOMPLETE`, `URL_KEY_TAKEN`, `URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, `URL_REDIRECT_NOT_FOUND` in one commit per `contracts/error-codes.md` (ERROR_CODES, `MINTED_ERROR_CODES`, catalog manifest `errorCodes`, `errors.<CODE>` en+pl, `composer:generate` + Polish module-reference refresh) — `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `packages/modules/catalog/src/manifest.ts`, `packages/modules/catalog/i18n/{en,pl}.json`
- [ ] T012 [S1] Changeset: `@endora-commerce/contracts` `minor` (new exports `product-scopes`, `product-url-keys`, `SeoProductMetaPort`) — `.changeset/162-product-scopes-contracts.md`
- [ ] T013 [S1] Build contracts; type-check consumers by name

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts exec vitest run src/product-scopes.test.ts src/product-scopes-shapes.test.ts src/product-url-keys.test.ts`
- `pnpm --filter @endora-commerce/contracts run build && pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts test/unit/kernel/error-code-routing-equality.test.ts`
- `pnpm --filter backend run check:error-translations`

### Phase 3: [backend] Schema — scope tables

**Goal**: `product_channel_scopes`, `product_channel_language_scopes`, `products.publish_from/until`
exist, registered, with entities (data-model §1–§3).

- [ ] T014 [P] [PG] [S1] RED integration test: both tables exist; `CHECK`s refuse a bad status, `from >= until`, MOQ 0 and 1 000 001, `allowed_organization_ids` without `visibility`, bounds without `window_overridden`; cascade on product hard delete and on channel delete (edge case *Channel deleted*) — `backend/test/integration/catalog/product-scopes-schema.test.ts`
- [ ] T015 [S1] Scaffold and fill `pnpm --filter backend run migration:new -- --module catalog --name product_scopes` per data-model §1–§3 (`down` drops both tables and both columns)
- [ ] T016 [P] [S1] Entities `ProductChannelScope`, `ProductChannelLanguageScope` (`@GlobalEntity()`), `Product.publishFrom/publishUntil` in `[OptionalProps]` with doc comments citing the FRs — `packages/modules/catalog/src/backend/entities/{product-channel-scope,product-channel-language-scope,product}.entity.ts`
- [ ] T017 [S1] `toCatalogProductRecord` fills `publishFrom/publishUntil` (the contract fields stay **optional** — required would break every consumer fixture that builds a record literal) — `catalog-product-read.service.ts` **(⛔384 touches this file: if #384 is not merged, put the two fields in a one-line hunk away from `listValueOverridesByProductIds` and expect a trivial rebase)**
- [ ] T018 [S1] Regenerate + commit: `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`
- [ ] T019 [S1] `check-entity-tenant-classification` passes for the two entities (platform-global, FR-083)
- [ ] T020 [S1] Run the registry/graph tests

**Verification**:
- `[PG] backend/test/integration/catalog/product-scopes-schema.test.ts` (fork `ci-pg`)
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/fk-dependency-drift.test.ts test/unit/db/module-graph.test.ts`
- `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 4: [backend] Scoped writes — status, window, audience, order rules (US1–US3, US10 write half)

**Goal**: `GET|PATCH /admin/catalog/products/:id/scopes` per `admin-scopes-api.md` §1–§2, audited,
undoable, evented. No read path changes yet.

- [ ] T021 [P] [US1] [S1] RED unit test of `ProductScopesService.apply` — upsert / inherit (`null` deletes; all-inherit row deleted, FR-012); FR-014 refusals with `SCOPE_INVALID` reasons; removing an orphaned override always allowed (FR-015); window `from >= until` → `VALIDATION_FAILED`; audience whole-rule (C4a) and `nonMemberOrganizationIds` computed (C4b); global change never touches overrides (FR-013) — `packages/modules/catalog/src/backend/services/product-scopes.service.test.ts`
- [ ] T022 [P] [US1] [PG] [S1] RED contract test of both routes: `catalog:read` / `catalog:write` gates (401/403 before validation), one audit row per request whose before/after hold the complete projection of every touched scope row — re-sending `before` through the route restores the previous state exactly (FR-080, FR-081; R29, owner Q-D → A — no undo endpoint is asserted because none exists), `product.updated.v1` with `changedFields` `scopedStatus` / `publicationWindow` / `audience` / `orderRules` after commit (FR-082), global status `inactive` still archives once and a scope `inactive` never does (FR-010) — `backend/test/contract/catalog/product-scopes-api.test.ts`
- [ ] T023 [US1] [S1] Implement `ProductScopesService` (Command `product.scopes.update`, `objectType: 'product'`, membership via `SalesChannelMembershipPort.listChannelIdsForEntity`, channel languages from `SalesChannel`) — `packages/modules/catalog/src/backend/services/product-scopes.service.ts`
- [ ] T024 [US1] [S1] Routes `GET|PATCH /api/v1/admin/catalog/products/:id/scopes` (`requireAdmin` as `preHandler`) — `packages/modules/catalog/src/backend/routes.admin.ts`
- [ ] T025 [US1] [S1] Compose the service in the container; emit events after commit — `packages/modules/catalog/src/backend/index.ts`
- [ ] T026 [US1] [S1] `PATCH /products/:id` accepts the global window (`publishFrom/publishUntil`) through the existing `product.update` Command — `catalog-admin.service.ts`, `packages/contracts/src/catalog.ts` (update schema, additive)
- [ ] T027 [US1] [S1] Audit reference resolver labels the new action (`audit-references.ts`). No undo handler: a single scoped write has no undo by owner decision (Q-D → A, FR-081, R29); the audit before-state is the restore path
- [ ] T028 [S1] Delete propagation: product soft-delete leaves scope rows (edge case) — assert in T022, no code expected
- [ ] T029 [S1] Build `mod-catalog`; type-check

**Verification**:
- `pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/services/product-scopes.service.test.ts`
- `[PG] backend/test/contract/catalog/product-scopes-api.test.ts`
- `[PG] backend/test/contract/admin_users/permission-inventory.test.ts` (no new code; gates resolve)
- `pnpm --filter @endora-commerce/mod-catalog run typecheck && pnpm --filter backend run typecheck`
- `pnpm --filter backend run check:module-boundary`

> **Review checkpoint A** — code review and security review in parallel on Phases 1–4 (focus: Command
> audit shape, FR-014 refusal paths, no `raw()` misuse, CHECK constraints vs service validation).

---

## Block B — S1 availability on every read (⛔384)

### Phase 5: [backend] ⛔384 Availability SQL, the port, and catalog's own reads (US1)

**Goal**: FR-001/002/005/007/016 on catalog's listing, facets and PDP; the port published.

- [ ] T030 [P] [US1] [PG] [S1] RED parity test over the generated grid of R5 (status G/C/C×L × window none/before/at-start/inside/at-end/after × audience override × anonymous/org X/org Y) — SQL id set equals `isProductEffectivelyAvailable` — `backend/test/integration/catalog/availability-parity.test.ts`
- [ ] T031 [P] [US1] [PG] [S1] RED matrix test (Independent Test of US1): one product, two channels × two languages, overrides at C and C×L → listing, facets, PDP, **quick search** (`GET …/products/quick-search`), **links/related** of a visible product naming the off one, and **bundle configuration** with an off child, per pair; "use inherited"; a `draft` member answers 404 by slug (FR-005); archived answers 410; unresolved channel matches nothing (FR-007) — `backend/test/contract/catalog/scoped-availability-matrix.test.ts`
- [ ] T032 [US1] [S1] `availabilityCondition` as a description (no `raw()` here) per `contracts/product-scopes.md` §4 — `packages/modules/catalog/src/backend/services/product-availability.sql.ts`
- [ ] T033 [US1] [S1] `ProductAvailabilityService` implementing `CatalogProductAvailabilityPort` (`filterAvailable`, `describeChannelAvailability`, `effectiveNames` stub → filled in P8, `effectiveOrderRules`); `providePort('catalogProductAvailabilityPort', …)` — `services/product-availability.service.ts`, `src/backend/index.ts`
- [ ] T034 [US1] [S1] `listProducts` + both price paths: replace `status: 'active'` and the membership/audience conditions in `#listingNarrowing` with `availabilityCondition`; `#passesPageFilters` evaluates the pure rule over the page's scope rows (one batched read) — `catalog-query.service.ts` (`:661`, `#listingNarrowing`, `#passesPageFilters`, `#visibleProductsInOrder`)
- [ ] T035 [US1] [S1] Facets (`:1840`) on the same condition — `catalog-query.service.ts`
- [ ] T036 [US1] [S1] `getProductByIdOrSlug`: 410 iff archived; else 404 unless available at (C, `resolveScopeLanguage`) (FR-005) — `catalog-query.service.ts:1286`; the route passes the scope language — `routes.public.ts` `readContext`
- [ ] T037 [US1] [S1] Links/related and bundle-configuration validate apply the port to linked/child ids (edge case *child off*); quick search replaces its own `p.status = 'active'` + audience predicate with `availabilityCondition` (availability only — its effective names are T062) — `product-link.service.ts:360`, `bundle.service.ts`, `catalog-quick-search.service.ts:118`
- [ ] T038 [S1] The existing `public-read-visibility.test.ts`, `products-status-inactive.test.ts`, `product-acquisition-visibility.test.ts` still pass or are updated **only** where FR-005 changes the answer (draft by slug → 404); note each change in the PR

**Verification**:
- `[PG] backend/test/integration/catalog/availability-parity.test.ts`
- `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts`
- `[PG] backend/test/contract/catalog/public-read-visibility.test.ts`
- `[PG] backend/test/contract/catalog/products-status-inactive.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`

### Phase 6: [backend] ⛔384 Acquisition seams (US1, FR-006, FR-018)

**Goal**: rows 13–18 of `contracts/consumers.md` use `filterAvailable`; quote requests refuse/warn.

- [ ] T039 [P] [US1] [PG] [S1] RED carts: add/batch-add refuse an off product with `PRODUCT_NOT_FOUND`; a line whose product goes off stays and is `product_unavailable` and blocks placement (FR-006); window ending between add and place → refused at placement (edge case) — `backend/test/integration/carts/scoped-availability.test.ts`
- [ ] T040 [P] [US1] [PG] [S1] RED quote requests: buyer line off at (RFQ channel, L) → single not-found (FR-018); operator `createOnBehalf` → accepted with `warnings[].code = 'PRODUCT_UNAVAILABLE_IN_SCOPE'` — `backend/test/integration/quote_requests/scoped-availability.test.ts`
- [ ] T041 [P] [US1] [PG] [S1] RED comparisons, shopping lists, quick order (incl. `'unrestricted'` arm unchanged) — `backend/test/integration/{comparisons,shopping_lists,quick_order}/scoped-availability.test.ts`
- [ ] T042 [US1] [S1] carts: `cart-service.ts:782-819` and batch add use the port (language = `resolveScopeLanguage`; admin-on-behalf with `salesChannelId` uses that channel's default language); `cart-minimums.ts:380` marks port-excluded products `product_unavailable`; declare `catalogProductAvailabilityPort` via `lazyPort` — `packages/modules/carts/src/backend/services/{cart-service,cart-minimums}.ts`, `src/backend/index.ts`
- [ ] T043 [US1] [S1] orders placement + preview: `placement-minimums.ts:48` and `preview-line-availability.ts` treat port-excluded as unavailable; reorder unchanged (exempt) — `packages/modules/orders/src/backend/services/`
- [ ] T044 [US1] [S1] quote_requests: `rfq-service.ts:223-225`, `:758` buyer refusal; `createOnBehalf` warnings; contract shape `warnings` additive — `packages/modules/quote_requests/src/backend/services/rfq-service.ts`, `packages/contracts/src/quote-requests.ts`
- [ ] T045 [US1] [S1] comparisons (`:374`, `:530`, `:617`), shopping_lists (`:236-249`, `:462`), quick_order (`catalog-lookup.ts:56`) — swap to the port, keep single not-found
- [ ] T045a [P] [US1] [PG] [S1] Verify test (consumers.md row 19): a CMS product block — the `products-by-slugs` and category-list requests `storefront/lib/page-builder/catalog-block-data.ts` makes (`GET /api/v1/catalog/products?categorySlug=&limit=`, `GET /api/v1/catalog/products/:slug`) — omits a product off at (C, L) and shows it where on; `catalog-block-data.ts` and `packages/cms-components/src/utils/catalog-block-data.ts` carry no predicate of their own (grep, note in the PR). Expected green after P5; red means a seam P5 missed — fix it in this phase — `backend/test/contract/cms/product-block-scoped-availability.test.ts`
- [ ] T046 [S1] Each module's manifest already lists `catalog`; `check:port-dependencies` green; changesets for touched packages (`patch`)
- [ ] T047 [S1] Grep `backend/test/**` for `outOfRequestChannel` / `productIdsInRequestChannel` expectations that changed meaning; update or justify (AGENTS.md trap: derived expectations)

**Verification** (one invocation per line):
- `[PG] backend/test/integration/carts/scoped-availability.test.ts`
- `[PG] backend/test/integration/quote_requests/scoped-availability.test.ts`
- `[PG] backend/test/integration/comparisons/scoped-availability.test.ts`
- `[PG] backend/test/integration/shopping_lists/scoped-availability.test.ts`
- `[PG] backend/test/integration/quick_order/scoped-availability.test.ts`
- `[PG] backend/test/contract/cms/product-block-scoped-availability.test.ts`
- `[PG] backend/test/contract/catalog/product-acquisition-visibility.test.ts`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`
- `pnpm --filter @endora-commerce/mod-comparisons run typecheck`
- `pnpm --filter @endora-commerce/mod-shopping-lists run typecheck`
- `pnpm --filter @endora-commerce/mod-quick-order run typecheck`
- `pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter backend run check:port-dependencies`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter backend run check:module-boundary`

### Phase 7: [backend] ⛔384 Search, sitemap, feeds and the window sweep (US1, US2)

**Goal**: rows 7–11 of `contracts/consumers.md`; FR-016, FR-023, FR-024, SC-005.

- [ ] T048 [P] [US2] [PG] [S1] RED search: documents carry `liveLanguages`, `publishFromMs`, `publishUntilMs`, channel-effective audience; the **index filter** excludes a product off at (C, L) and outside the window at query time with full pages (no short page, issue #151); a pre-deploy document without the fields is served as before (R8) — `backend/test/integration/search/scoped-availability.test.ts`
- [ ] T049 [P] [US2] [PG] [S1] RED sitemap and feeds honour availability per channel language (anonymous audience) and the window at generation time — `backend/test/contract/seo/sitemap-scoped.test.ts`, `backend/test/integration/product_feeds/scoped-availability.test.ts`
- [ ] T050 [P] [US2] [PG] [S1] RED sweep: bounds crossed in `(lastSweep, now]` emit one `product.updated.v1` `['publicationWindow']` each; idempotent; missing watermark → `now − 2×interval`; no status write (A-4) — `backend/test/integration/catalog/publication-window-sweep.test.ts`
- [ ] T051 [US2] [S1] `PublicationWindowSweep` + Job Scheduler `catalog.publication-window.sweep` (5 min) via `ctx.worker`; watermark key in Redis — `packages/modules/catalog/src/backend/services/publication-window-sweep.ts`, `src/backend/index.ts`
- [ ] T052 [US1] [S1] Search indexer: `isPublishable` → `describeChannelAvailability`; `buildDocument` new fields; filterable attributes added in `reindexChannel` settings — `packages/modules/search/src/backend/services/search-indexer.ts`
- [ ] T053 [US1] [S1] Search query: filter clause of R8 with L from the request; hydrate through `filterAvailable` — `packages/modules/search/src/backend/services/search-query.service.ts`
- [ ] T054 [US1] [S1] Sitemap generator uses `describeChannelAvailability` (keys stay `slug` until P17) — `packages/modules/seo/src/backend/services/sitemap-generator.service.ts` **(S1 edits this one `seo` file in P7; S2 takes `seo` from P17 on)**
- [ ] T055 [US1] [S1] Feeds selection uses `filterAvailable` at the feed's channel/language — `packages/modules/product_feeds/src/backend/services/product-selection.service.ts`
- [ ] T056 [S1] `search` docs page: new fields and the reindex step — `packages/modules/search/docs/search.md` + PL mirror

**Verification** (one invocation per line):
- `[PG] backend/test/integration/search/scoped-availability.test.ts`
- `[PG] backend/test/contract/seo/sitemap-scoped.test.ts`
- `[PG] backend/test/integration/product_feeds/scoped-availability.test.ts`
- `[PG] backend/test/integration/catalog/publication-window-sweep.test.ts`
- `[PG] backend/test/contract/seo/sitemap.test.ts`
- `pnpm --filter @endora-commerce/mod-search exec vitest run src/backend/services/search-hit-channel-overrides.test.ts` (#384's, still green)
- `pnpm --filter @endora-commerce/mod-search run typecheck`
- `pnpm --filter @endora-commerce/mod-seo run typecheck`
- `pnpm --filter @endora-commerce/mod-product-feeds run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:subscribe-seam`
- `pnpm --filter backend run check:entry-presence`

### Phase 8: [backend] ⛔384 Effective names everywhere (FR-017) and performance (SC-004)

**Goal**: rows 5, 6, 12, 13, 16 of `contracts/consumers.md` for names/values; the benchmark passes.

- [ ] T057 [P] [PG] [S1] RED parity: `effectiveTextSql` equals #384's `channelOverrideFor` over a grid (override at C×L for the request language / a later language / channel-only; baseline present/absent per leg) — `backend/test/integration/catalog/effective-text-parity.test.ts`
- [ ] T058 [P] [PG] [S1] RED listing: free-text search, attribute filters, facet counts and name sort use effective values at (C, L); name sort keyset `(effective name, id)` pages without gaps or repeats (D6) — `backend/test/integration/catalog/listing-effective-names.test.ts`
- [ ] T059 [P] [PG] [S1] RED quick search (matches and returns effective name), comparisons (names + compared values), basket line names and batch outcomes, RFQ line snapshots (buyer: request language → channel default; operator: channel default — N2; snapshot kept after an override changes) — `backend/test/integration/{catalog/quick-search-effective-names,comparisons/effective-values,carts/effective-names,quote_requests/effective-names}.test.ts`
- [ ] T060 [S1] `effectiveTextSql` builder — `packages/modules/catalog/src/backend/services/effective-value.sql.ts`
- [ ] T061 [S1] Listing q / filters / counts / name sort through it — `catalog-query.service.ts`
- [ ] T062 [S1] Quick search — `catalog-quick-search.service.ts:118` area
- [ ] T063 [S1] `effectiveNames` on the port; carts, quote_requests, comparisons consume it / #384's helpers — `product-availability.service.ts`, `cart-service.ts:1251`, `rfq-service.ts:462`, `:635`, `comparison-service.ts:607`, `:623`
- [ ] T064 [S1] Search: `localizedNames.<L>` in documents + `attributesToSearchOn` (FR-017 b on the Meilisearch path) — `search-indexer.ts`, `search-query.service.ts`
- [ ] T065 [S1] Benchmark: a scoped variant of `backend/test/perf/catalog-list.bench.ts` and `backend/test/perf/catalog/listing-filtered-page.bench.ts` (20% of products with C and C×L rows, windows, audience overrides, effective-name sort) and record before/after in the PR; **> 10% regression stops the block** and goes back to the architect (R1 fallback) — `backend/test/perf/catalog/listing-scoped-availability.bench.ts`
- [ ] T066 [S1] Release note entry: name sort order (D6), reindex per channel (R21) — `.changeset/162-…` bodies of the touched packages

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/effective-text-parity.test.ts`
- `[PG] backend/test/integration/catalog/listing-effective-names.test.ts`
- `[PG] backend/test/integration/catalog/listing-name-sort-paging.test.ts` (existing; the keyset changed)
- `[PG] backend/test/integration/catalog/quick-search-effective-names.test.ts`
- `[PG] backend/test/integration/comparisons/effective-values.test.ts`
- `[PG] backend/test/integration/carts/effective-names.test.ts`
- `[PG] backend/test/integration/quote_requests/effective-names.test.ts`
- `[PG] cd backend && PERF_RUN=true pnpm exec vitest run test/perf/catalog/listing-scoped-availability.bench.ts` (needs the services; read `specs/conventions/backend-test-suite.md` § serial project first — it shares the host's CPU)
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-search run typecheck`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`
- `pnpm --filter @endora-commerce/mod-comparisons run typecheck`

> **Review checkpoint B** — code review + security review in parallel on Phases 5–8 (focus: single
> not-found preserved at every seam, no post-cut narrowing, SQL parameterisation of every new fragment,
> port catches, benchmark evidence).

---

## Block C — S1 backend: overview, bulk, gate, order rules

### Phase 9: [backend] Scope overview and attribute scope-change preview (US4, FR-015, FR-041, FR-090)

- [ ] T067 [P] [US4] [PG] [S1] RED overview: cells name overridden fields and the effective source (cell/channel/language/global); channel rows and language columns; orphans (non-member, language removed, attribute scope narrowed); product in no channel → only global and language scopes (US4 #4); `catalog:read` gets it, writes need `catalog:write` (US4 #3) — `backend/test/contract/catalog/scope-overview.test.ts`
- [ ] T068 [P] [PG] [S1] RED FR-090 preview counts orphaned overrides per channel; widening reports 0; the attribute update still retains rows — `backend/test/contract/catalog/attribute-scope-change-preview.test.ts`
- [ ] T069 [US4] [S1] `ScopeOverviewService` over scope rows, `product_value_overrides` and URL keys (P16 is merged before Block C — see the chain); leaves `cells[].missing` absent — T080a fills it once `checkCompleteness` exists (Phase 11); media/attachment fields join in T134a–T134b / T139a–T139b and SEO in T118a / T118c (all Phase 21–22, S1) — `services/scope-overview.service.ts`
- [ ] T070 [US4] [S1] Route `GET …/products/:id/scope-overview` — `routes.admin.ts`
- [ ] T071 [S1] Preview route `GET …/attributes/:idOrKey/scope-change-preview` — `routes.admin.ts`, `attribute-set.service.ts` or a new `attribute-scope-preview.ts`
- *T072 moved to Phase 18 as T118b — a port must be declared in the phase that provides it, or `check:port-dependencies` reports a port resolved and registered by nobody.*

**Verification**:
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/attribute-scope-change-preview.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 10: [backend] Bulk scoped status (US5, FR-050–FR-052)

- [ ] T073 [P] [US5] [PG] [S1] RED: selection + scope → only that scope's row changes per product; non-member skipped `scope_invalid` (US5 #3); per-product audit with scope (SC-006); undo as a whole with per-product conflict report (US5 #2); queued path above the threshold; 1 000 products undone in one action — `backend/test/contract/catalog/products-bulk-scoped-status.test.ts`
- [ ] T074 [US5] [S1] `CatalogBulkUpdateService` applies `scopedStatus` through `ProductScopesService` inside the per-product Command; revert records hold the scope row before-state — `services/catalog-bulk-update.service.ts`, `services/bulk-operation.service.ts`
- [ ] T075 [US5] [S1] Route validation: `scopedStatus` with `status` → 400; reasons wired — `routes.admin.ts`
- [ ] T076 [S1] `bulk-operation-undo.contract.test.ts` and `products-bulk-update*.test.ts` stay green (no behaviour change for existing fields)

**Verification**:
- `[PG] backend/test/contract/catalog/products-bulk-scoped-status.test.ts`
- `[PG] backend/test/contract/catalog/bulk-operation-undo.contract.test.ts`
- `[PG] backend/test/contract/catalog/products-bulk-update.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 11: [backend] Completeness gate (US6, FR-060, FR-061)

- [ ] T077 [P] [US6] [S1] RED unit: `checkCompleteness` — name counts only at C×L override or baseline `name[L]` (never another language, FR-060 last sentence); required language-scoped attributes likewise; URL key satisfied by the effective key incl. global (K3, US6 #5); `checkCompleteness` answers for a cell whatever its status (the overview calls it for every evaluable cell, FR-041); the gate's entry over `pairsTurningOn` (T080) checks nothing for the M3 → A non-triggers — a window-only change (incl. one opening the window now) and an audience-only change on a product lacking `name[de]` — `packages/modules/catalog/src/backend/services/scope-completeness.test.ts`
- [ ] T078 [P] [US6] [PG] [S1] RED: setting default `warn` (saved + warnings); `refuse` refuses a single edit as a whole naming every pair (US6 #3, N3) incl. the global switch via `PATCH /products/:id`; bulk skips + reports per product (US6 #4); import and `catalogProductScopeWritePort` never gated (A-6); **M3 → A non-triggers, all in `refuse` on a product active everywhere and lacking `name[de]`, each → saved, no `SCOPE_INCOMPLETE`, no warning**: (a) membership join through `PUT /api/v1/admin/sales-channels/:code/product/:id` (`sales_channels/src/backend/routes.admin.ts:377`) to a channel offering `de`, and through bulk `salesChannels: { mode: 'add' }` without `status`; (b) a channel gains `de` through `PATCH /api/v1/admin/sales-channels/:code` (`routes.admin.ts:196`); (c) a scopes PATCH changing only `window` so that it opens now; (d) a scopes PATCH changing only `audience` (US6 #6); after (a) and (b) `GET …/scope-overview` shows `missing: ['name']` on the (channel, `de`) cell and `[]` on complete cells, and a cell of a non-member channel has no `missing` (FR-041) — `backend/test/contract/catalog/scope-completeness-gate.test.ts`
- [ ] T079 [US6] [S1] Setting `catalog.scope_completeness_gate` in a new `settings` block (seo's shape), labels en+pl — `packages/modules/catalog/src/manifest.ts`, `i18n/{en,pl}.json`
- [ ] T080 [US6] [S1] `scope-completeness.ts` + wiring into `ProductScopesService`, the global status path in `catalog-admin.service.ts`, and bulk
- [ ] T080a [US4] [US6] [S1] `ScopeOverviewService` fills `cells[].missing` from `checkCompleteness` for every cell whose channel the product is a member of and whose language the channel offers, whatever its status; absent otherwise (FR-041, `admin-scopes-api.md` §3; T078's overview assertions go green) — `services/scope-overview.service.ts`
- [ ] T081 [S1] Regenerate artefacts (manifest change) and commit with Polish module-reference refresh

**Verification**:
- `pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/services/scope-completeness.test.ts`
- `[PG] backend/test/contract/catalog/scope-completeness-gate.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 12: [backend] ⛔384 Order rules per channel (US10, FR-100)

- [ ] T082 [P] [US10] [PG] [S1] RED: MOQ 10 in B2B refuses 5 in B2B basket, accepts 5 in B2C (US10 #1); placement and preview use the order's channel; quote minimums use the RFQ channel; storefront DTO `minOrderQuantity` channel-effective — `backend/test/integration/carts/channel-order-rules.test.ts`
- [ ] T083 [P] [US10] [PG] [S1] RED: returnable only in B2C → `returnableAtPurchase` stamped per channel; return offered only on B2C orders (US10 #2) — `backend/test/integration/orders/channel-returnable.test.ts`
- [ ] T084 [US10] [S1] Feed `effectiveOrderRules` into `evaluateOrderMinimums` at cart, placement, preview, quick order, quote seams; stamp `returnable_at_purchase` from it — `packages/modules/{carts,orders,quote_requests,quick_order}/src/backend/services/*minimums*.ts`, `order-service.ts:2234`
- [ ] T085 [US10] [S1] PDP/listing DTO `minOrderQuantity` channel-effective — `catalog-query.service.ts`
- [ ] T086 [S1] Changesets (`patch`) for touched packages

**Verification** (one invocation per line):
- `[PG] backend/test/integration/carts/channel-order-rules.test.ts`
- `[PG] backend/test/integration/orders/channel-returnable.test.ts`
- `[PG] backend/test/contract/catalog/product-order-rules.test.ts` (155's, still green)
- `[PG] backend/test/contract/catalog/packaging-unit-minimum.test.ts` (155's, still green)
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`
- `pnpm --filter @endora-commerce/mod-quick-order run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

> **Review checkpoint C** — code review + security review on Phases 9–12.

---

## Block D — S3 admin UI (US1–US6, US10)

### Phase 13: [admin UI] Scope controls (US1–US3, US10) — after Block A

- [ ] T087 [P] [US1] [S3] RED component tests: per channel and channel × language status selector with "use inherited"; source shown (FR-040); window inputs in `datetime-local` converting local ↔ ISO (US2 #4 with a mocked zone); audience override with organization picker and non-member warning (US3 #4); MOQ/returnable per channel; no warning about overrides when the global value changes (FR-013); read-only without `catalog:write` — `admin/test/modules/catalog/product-scope-controls.test.tsx`
- [ ] T088 [US1] [S3] API calls for `…/scopes` the way `ProductScopeEditor.tsx` already calls `…/scope-context` and `…/value-overrides` (through the admin-kit API client; a small `src/admin/lib/product-scopes-api.ts` if it grows past two calls) — `packages/modules/catalog/src/admin/lib/product-scopes-api.ts`
- [ ] T089 [US1] [S3] Extend `ProductScopeEditor.tsx` with the scope-control section (admin-kit primitives only, IX); global window on the general tab — `src/admin/components/ProductScopeEditor.tsx`, `src/admin/pages/ProductEditor.tsx`
- [ ] T090 [US10] [S3] Per-channel MOQ/returnable in `ProductOrderRulesCard.tsx`
- [ ] T091 [S3] Every string as a flat key in `catalog/i18n/{en,pl}.json` (handover commit) — `i18n:hardcoded` stays at baseline
- [ ] T092 [S3] Palette: `open-products` keywords extended (handover commit to `manifest.ts`) (R23)

**Verification**:
- `pnpm --filter admin exec vitest run test/modules/catalog/product-scope-controls.test.tsx`
- `pnpm --filter admin run typecheck && pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 14: [admin UI] Scope overview (US4) and attribute scope-flag preview (FR-090) — after Phase 9

- [ ] T093 [P] [US4] [S3] RED: matrix renders cells/rows/columns per the response; source per cell; a cell's `missing` values listed with their localized names (name, URL key, attribute label) and an accessible "incomplete" marker, nothing rendered when `missing` is absent or `[]` (FR-041; the field is in the P2 schema, so the fixture carries it — the backend fills it in T080a); orphans with a warning and delete; "reset to inherited" calls the owning endpoint with `null` for one field only (US4 #2); read-only for `catalog:read` (US4 #3); no channels → global + language only (US4 #4); keyboard navigation and accessible names (WCAG 2.2 AA, `ux-laws`) — `admin/test/modules/catalog/product-scope-overview.test.tsx`
- [ ] T094 [US4] [S3] `ProductScopeOverview.tsx` as a product-editor tab — `src/admin/components/ProductScopeOverview.tsx`, `ProductEditor.tsx`
- [ ] T095a [P] [S3] RED (FR-090, analyze H2): the attribute edit form shows `channelScoped` / `languageScoped` for user-defined attributes (system attributes read-only, `getAttributeScope`); saving a **narrowing** first calls `GET …/attributes/:key/scope-change-preview` and shows a confirmation with the orphaned-override count, total and per channel, before the PATCH is sent; cancel sends nothing; a widening saves without the preview; a 0-count narrowing still confirms ("no overrides affected"); read-only without `catalog:write`; accessible dialog (focus trap, labelled) — `admin/test/modules/catalog/AttributesManager.scope-flags.test.tsx`
- [ ] T095b [S3] Scope flags + narrowing preview confirmation in the attribute edit form (admin-kit dialog primitives, IX) — `packages/modules/catalog/src/admin/pages/AttributesManager.tsx`
- [ ] T095 [S3] i18n keys for T094 and T095b (handover)

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-scope-overview.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/catalog/AttributesManager.scope-flags.test.tsx test/modules/catalog/AttributesManager.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`

### Phase 15: [admin UI] Bulk scoped status and the gate (US5, US6) — after Phases 10–11

- [ ] T096 [P] [US5] [S3] RED: bulk dialog offers "Set status in scope" (channel, optional language, value or inherit); result lists skipped products with reason; gate warnings/refusals rendered per pair (US6 #1, #3) — `admin/test/modules/catalog/products-bulk-scoped-status.test.tsx`, `admin/test/modules/catalog/scope-completeness-messages.test.tsx`
- [ ] T097 [US5] [S3] `ProductsBulkEditDialog.tsx` scoped-status action — `src/admin/components/ProductsBulkEditDialog.tsx`
- [ ] T098 [US6] [S3] Gate messages in scope controls and the global status save — `ProductScopeEditor.tsx`, `ProductEditor.tsx`
- [ ] T099 [S3] i18n keys (handover)

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/products-bulk-scoped-status.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/catalog/scope-completeness-messages.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`

> **Review checkpoint D** — code review + **designer UX/accessibility audit** on Phases 13–15
> (`.claude/skills/ux-laws/SKILL.md`), plus product-owner check of US1–US6 acceptance scenarios in the UI.

---

## Block E — S2 URL keys and SEO

### Phase 16: [backend] URL-key storage and writes (US7) — after Block A

- [ ] T100 [P] [US7] [PG] [S2] RED uniqueness, every row of `data-model.md` §5's table incl. US7 #2, #5, #7, #8; global-key writes checked in every language; redirects never chain (US7 #4); self-redirect removed; **H1**: a `NULL`-language redirect of Q requires takeover for an L key in every L, even where Q holds an L key, and the confirmation says it is removed in every language; P writing its own `NULL`-language redirect as an L key keeps the `NULL` row; P writing it back as its global key replaces it with `(L, k)` rows for every L where P holds a language or C×L key; FR-014 on C×L keys; orphaned C×L key keeps reserving; membership/channel-language changes never refuse (SC-008); **HIGH-2 sequence** — P holds a key in L → Q takes P's slug `k` as its L key → P changes its slug: no `(NULL, k)` row; `(L', k) → P` for every other channel language L' where `k` is free; none in L; `k` at (C, L) still resolves to Q (served), `k` at (C, L') redirects to P; P later writing `k` back as its slug while Q holds it in L → `URL_KEY_TAKEN` naming Q; and the sibling: P removing its L key while Q holds `P.slug` in L → `URL_KEY_TAKEN` naming Q, nothing saved; with no collision a slug change still writes exactly one `(NULL, old)` row; **two-connection concurrency** — exactly one winner — `backend/test/integration/catalog/url-key-uniqueness.test.ts`
- [ ] T101 [P] [US7] [PG] [S2] RED admin API: `GET|PUT …/url-keys`, `DELETE …/url-redirects/:id`; `URL_KEY_TAKEN` names the holder; takeover requires `confirmTakeover` and names the loser; one audit entry whose before/after hold every key and redirect row touched, and re-applying `before` restores them (`URL_KEY_TAKEN` if a key was since taken — R29); `DELETE …/url-redirects/:id` audits the deleted row; `GET` includes `redirects` while `seo` is present; `changedFields: ['urlKeys']` — `backend/test/contract/catalog/url-keys-api.test.ts`
- [ ] T102 [S2] Migration `--module catalog --name product_url_keys`; entities `ProductUrlKey`, `ProductUrlRedirect` — `packages/modules/catalog/src/{migrations,backend/entities}/`
- [ ] T103 [US7] [S2] `UrlKeyService` (advisory locks in sorted order, the closed check list, redirect bookkeeping, Commands `product.url_keys.update`, `product.url_redirect.delete`) — `services/url-key.service.ts`
- [ ] T104 [US7] [S2] `allocateUniqueSlug` widened (A-11) and the product delete Command removes redirects (FR-072) — **handover commit** for `catalog-admin.service.ts`
- [ ] T105 [US7] [S2] Routes in `routes.admin.url-keys.ts`; registration line + composition as a handover commit
- [ ] T106 [S2] Handover: S1 regenerates artefacts after applying T102

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/url-key-uniqueness.test.ts`
- `[PG] backend/test/contract/catalog/url-keys-api.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/module-graph.test.ts`

### Phase 17: [backend + storefront] ⛔384 Key resolution, redirects, alternates (US7, FR-071–FR-074, FR-111) — after Block B

- [ ] T107 [P] [US7] [PG] [S2] RED resolution at (C, L): current key serves; other current key of the product in L → redirect to effective key; redirect key → redirect at every (C, L) of its language (US7 #3); key of another language → 404 (K1, US7 #1); unavailable target → 404; archived → 410; **H1**: a `NULL`-language redirect resolves at every (C, L) — including an L in which its product **gained its first L key after** the redirect was written (seed: slug s0 → s1 writes `(NULL, s0)`, then the first L key; `s0` at (C, L) → 301 to the L key) — and a product's own current L key wins over its own `NULL` redirect with the same key; `GET /api/v1/catalog/products/:idOrSlug` by **global slug** still answers after the product gains an L key (CMS blocks, R28), and never answers a redirect; the resolve answer's target equals `productPath()` — `backend/test/integration/catalog/url-key-resolution.test.ts`
- [ ] T108 [P] [US7] [PG] [S2] RED `seo` off: redirects answer 404, rows persist, writes still enforce the invariant (a takeover still requires confirmation naming the loser), `GET …/url-keys` omits `redirects` (Q-C); `seo` on again → served and listed (FR-111) — `backend/test/integration/catalog/url-redirects-seo-off.test.ts`
- [ ] T109 [P] [US7] [S2] RED storefront: PDP calls `resolve`, `permanentRedirect` on `kind: 'redirect'` to `productPath()`; canonical + `alternates.languages` use effective keys through `productPath()` (FR-074); no URL is composed outside `productPath()` — the PDP redirects to the resolve answer's `path` and takes canonical/alternates from the PDP response's `paths` verbatim; no product URL is composed in `storefront/app/(catalog)/p/[slug]/{page,seo}.ts*` (asserted by a source grep in the test) — `storefront/test/catalog/pdp-redirect.test.ts`
- [ ] T110 [US7] [S2] `UrlKeyResolutionService` + `GET /api/v1/catalog/products/resolve/:key` in `routes.public.url-keys.ts` (resolution order of data-model §5, H1); `getProductByIdOrSlug` accepts an id, a current key at (C, L), else a global slug (R28) — never a redirect; `GET …/url-keys` omits `redirects` unless `effectiveState.isPresent('seo')`; admin `effective[].url`, the resolve answer's `path` and the PDP response's `paths` (canonical + alternates where available to the anonymous audience) all via `productPath()` (contract §4, §6); the additive `paths` field on the PDP shape in `packages/contracts/src/catalog.ts` goes in the phase's handover commit (S1 owns that file) — `services/url-key-resolution.service.ts`, `catalog-query.service.ts` (PDP method only)
- [ ] T111 [US7] [S2] `ProductSummary.slug` = effective key at (C, L) on listing and PDP (R28); `catalogProductUrlKeyReadPort` provided
- [ ] T112 [US7] [S2] Sitemap: one `<loc>` per live language with effective key, composed by `productPath()` — `seo/src/backend/services/sitemap-generator.service.ts`
- [ ] T113 [US7] [S2] Storefront PDP + metadata using the backend's ready `path` / `paths` (the storefront does not know the channel default language, so it never calls `productPath()` itself) — `storefront/app/(catalog)/p/[slug]/page.tsx`, `storefront/lib/api/catalog.ts`. *(Q-B is decided as option C, a separate issue: no cross-language rendering task belongs here; the path prefix later replaces `productPath()`.)*

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/url-key-resolution.test.ts`
- `[PG] backend/test/integration/catalog/url-redirects-seo-off.test.ts`
- `[PG] backend/test/contract/seo/sitemap.test.ts`
- `pnpm --filter storefront exec vitest run test/catalog/pdp-redirect.test.ts`
- `pnpm --filter storefront run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:storefront-indexability`

### Phase 18: [backend] ⛔384 SEO writes as Commands, then per channel × language (US8, FR-075, FR-080) — after Phase 17

**Goal**: `seo`'s override writes leave the hand audit for the Command Bus (analyze C1, Constitution XIII)
**before** the channel dimension is added; then C×L resolution and the PDP wiring.

- [ ] T114a [P] [US8] [PG] [S2] RED (C1): `PUT /api/v1/admin/seo/meta/:entityType/:entityId` writes exactly one audit row per request with action `seo_meta_override.upsert`, `before` = the full previous row projection on update (**non-null**) and `null` on create, `after` = the full projection; `DELETE` writes one `seo_meta_override.delete` row with the deleted projection as `before`, and **no** row when nothing was deleted; DELETE addressed by (entity, `channelId?`, `locale?`) removes exactly the addressed L / C / C×L row and leaves the other two; neither parameter → today's `locale = 'en-US'`; re-sending `before` restores the row (R29); the write and its audit roll back together on failure — `backend/test/contract/seo/meta-override-commands.test.ts`
- [ ] T114 [P] [US8] [PG] [S2] RED schema + resolution: C×L → C → L → derived per field; existing rows are L scope unchanged (US8 #2 as stored data); unique per shape; `channelId` refused for non-product entity types; `channelId` of a non-member channel / unoffered locale → `SCOPE_INVALID` on PUT, allowed on DELETE (FR-014/015) — `backend/test/integration/seo/meta-channel-scope.test.ts`
- [ ] T115 [P] [US8] [PG] [S2] RED PDP metadata per (C, L) (US8 #1), including a product whose pre-existing per-language override is now served (Q-A, *Intended behaviour changes* 4), and derived metadata with `seo` off — `backend/test/contract/catalog/product-seo-scoped.test.ts`
- [ ] T116 [S2] Migration `--module seo --name meta_override_channel_scope`; entity changes — `packages/modules/seo/src/{migrations,backend/entities/seo-meta-override.entity.ts}`
- [ ] T117 [US8] [S2] (C1) Commands `makeUpsertSeoMetaOverrideCommand` / `makeDeleteSeoMetaOverrideCommand` in the `delivery_methods/src/backend/commands/delivery-method.commands.ts` shape (`existingId` pattern, full projection, `skipAudit` on a no-op delete); `MetaTagResolverService` takes `commandBus` (wired in `seo/src/backend/index.ts` the way catalog's `index.ts` hands it to `ProductOverridesService`) instead of `auditLog`, and its `#audit` / `recordAuditFromContext` calls are **deleted in the same commit**; routes accept `channelId` (PUT body, GET/DELETE query) with the addressing rule of `contracts/seo-media-attachments.md` §1 — `packages/modules/seo/src/backend/{commands/seo-meta-override.commands.ts,services/meta-tag-resolver.service.ts,routes.ts,index.ts}`, `packages/contracts/src/seo.ts` (request schemas, additive)
- [ ] T117a [US8] [S2] `MetaTagResolverService` scope walk C×L → C → L → derived; `seoProductMetaPort` (`resolveForProduct`, `listScopesForProduct`) provided — `packages/modules/seo/src/backend/{services/meta-tag-resolver.service.ts,index.ts}`
- [ ] T118 [US8] [S2] PDP `seo` block through the port behind the `seo` presence probe — `catalog-query.service.ts` (`:1437` block)
- [ ] T118b [S2] Declare `seoProductMetaPort` in catalog `nonBindingDependencies` as `degrades-without` with the R12 `whenAbsent` sentence (handover commit to `packages/modules/catalog/src/manifest.ts`) — same phase as the provider (T117a)
- [ ] T119 [S2] `seo` docs page + PL mirror (scopes, addressing, audit); `seo` changeset (`patch`)
- *T118a (overview lists SEO scopes) moved to Phase 21 with its implementation T118c: the file is S1's, and S1 runs Phase 21 after this phase is applied — no handover needed.*

**Verification** (one invocation per line):
- `[PG] backend/test/contract/seo/meta-override-commands.test.ts`
- `[PG] backend/test/integration/seo/meta-channel-scope.test.ts`
- `[PG] backend/test/contract/catalog/product-seo-scoped.test.ts`
- `[PG] backend/test/contract/seo/meta-override.test.ts`
- `pnpm --filter backend run check:command-coverage`
- `pnpm --filter @endora-commerce/mod-seo run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:port-dependencies`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/fk-dependency-drift.test.ts`

### Phase 19: [backend] Connectors and import/export (FR-091–FR-093)

- [ ] T120 [P] [US7] [PG] [S2] RED `catalogProductScopeWritePort.applyScopes`: writes only named scopes, never removes operator overrides (FR-091); a taken key is not written, previous key kept, issue names record/language/holder, no takeover (FR-093, US7 #9); no completeness gate — `backend/test/integration/catalog/scope-write-port.test.ts`
- [ ] T121 [P] [PG] [S2] RED CSV: export emits `status@<channel>` / `status@<channel>/<lang>`; import round-trips them (FR-092); whole-file rejection rule unchanged — `backend/test/integration/catalog/bulk-import-scoped-status.test.ts`
- [ ] T122 [S2] `catalogProductScopeWritePort` provided (status, window, audience, order rules via `ProductScopesService`; keys via `UrlKeyService` in import mode) — `services/catalog-write-ports.ts`
- [ ] T123 [S2] CSV columns — `catalog-bulk-import.service.ts`, `packages/modules/import_export/src/backend/services/` adapter
- [ ] T124 [S2] Connector-author note: which scope each field is read/written at (FR-091) — `packages/modules/catalog/docs/catalog/url-keys-and-redirects.md` § Integrations (+ PL)

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/scope-write-port.test.ts`
- `[PG] backend/test/integration/catalog/bulk-import-scoped-status.test.ts`
- `[PG] backend/test/integration/catalog/bulk-import-command.test.ts` (existing, still green)
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-import-export run typecheck`

> **Review checkpoint E** — code review + security review on Phases 16–19 (focus: advisory-lock ordering,
> takeover authorisation (operator only), redirect open-redirect safety — targets are always the
> platform's own `/p/<key>`, never stored URLs — and SEO-off behaviour).

---

## Block F — media, attachments, packaging units; URL-key and SEO UI

### Phase 20: [admin UI] URL keys, redirects and per-scope SEO (US7, US8) — after Phases 17–18

- [ ] T125 [P] [US7] [S3] RED: URL-keys panel edits global / per-language / C×L keys with "use inherited"; shows effective URL per (C, L); `URL_KEY_TAKEN` names the holder; takeover confirmation dialog names the losing product and retries with `confirmTakeover`; redirect list with delete when the response carries `redirects`; **with `seo` off (`redirects` absent) no redirect list, no note and no redirect affordance is rendered (Q-C), while the takeover confirmation still appears and names the losing product**; a takeover of a language-less (former global) redirect says the product loses it **in every language**; effective URLs shown as the response's `url` (never composed in the admin) — `admin/test/modules/catalog/product-url-keys-panel.test.tsx`
- [ ] T126 [P] [US8] [S3] RED: SEO panel gains a channel selector beside the language one, shows source per field, and "use inherited" deletes exactly the selected scope's row — `admin/test/modules/seo/seo-meta-scope.test.tsx`
- [ ] T127 [US7] [S3] `ProductUrlKeysPanel.tsx` in the product editor — `src/admin/components/ProductUrlKeysPanel.tsx`
- [ ] T128 [US8] [S3] SEO panel per scope, deleting a scope row by (`channelId?`, `locale?`) — `packages/modules/seo/src/admin/**`
- [ ] T129 [S3] i18n keys in `catalog` and `seo` bundles (handover for catalog)

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-url-keys-panel.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/seo/seo-meta-scope.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 21: [backend + storefront] ⛔384 Gallery per channel and alt per language (US9 a, FR-076, FR-077)

- [ ] T130 [P] [US9] [PG] [S1] RED: base-image override for B2B used by B2B PDP, listing card and OG image (US9 #1); hidden image never served in B2B (US9 #2); role uniqueness per channel; Polish-only product alt → English shows the asset's alt (US9 #3) — `backend/test/contract/catalog/media-scopes.test.ts`
- [ ] T131 [S1] Migration `--module catalog --name product_media_scopes`; entities — data-model §7
- [ ] T132 [US9] [S1] Gallery service + routes (`channel-roles`, item `altText`, `hiddenInChannels`), Command `product.media.update`, `changedFields: ['media']` — `services/gallery.service.ts`, `routes.admin.ts`
- [ ] T133 [US9] [S1] Effective gallery in C and alt at L on PDP, listing card (`#listingCardReadsFor`), OG image — `catalog-query.service.ts`, `primary-asset-url.ts`
- [ ] T134 [S1] Regenerate artefacts
- [ ] T134a [P] [US4] [PG] [S1] RED: extend `backend/test/contract/catalog/scope-overview.test.ts` — gallery role/hidden overrides per channel, per-language alt, and their orphans (FR-041 "every field")
- [ ] T134b [US4] [S1] `ScopeOverviewService` lists them — `services/scope-overview.service.ts`
- [ ] T118a [P] [US4] [PG] [S1] RED (moved from Phase 18): extend `scope-overview.test.ts` with an SEO override at L, C and C×L, and the `seo`-off case (no SEO cells, no error)
- [ ] T118c [US4] [S1] `ScopeOverviewService` lists SEO scopes through `seoProductMetaPort.listScopesForProduct` behind `effectiveState.isPresent('seo')` — `services/scope-overview.service.ts`

**Verification** (one invocation per line):
- `[PG] backend/test/contract/catalog/media-scopes.test.ts`
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/gallery.test.ts`
- `[PG] backend/test/integration/catalog/gallery-batch-read.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 22: [backend + storefront] Attachments and packaging units (US9 b, FR-078, FR-079)

- [ ] T135 [P] [US9] [PG] [S1] RED: attachment hidden in B2C neither listed nor referenced from the B2C PDP (US9 #4); names/descriptions per language with global fallback; packaging-unit names per language on PDP, basket and order line; placed line keeps its name after a rename (US9 #5) — `backend/test/contract/catalog/attachment-packaging-translations.test.ts`, `backend/test/integration/carts/packaging-unit-name-snapshot.test.ts`
- [ ] T136 [S1] Migration `--module catalog --name attachment_packaging_translations`; entities — data-model §8
- [ ] T137 [US9] [S1] Attachment + packaging services/routes accept translations and `hiddenInChannels` (admin packaging schemas stay `.strict()` with the key added). Writes ride the **existing** Commands — `product_attachment.update` (`objectType: 'product_attachment'`) and `packaging_unit.update` (`objectType: 'packaging_unit'`) — one audit entry per request, i.e. one per product (FR-080); their `before`/`after` projections gain `productId`, the translations and `hiddenInChannels`; events `changedFields: ['attachments']` / `['packagingUnits']` — `services/{attachment,packaging-unit}.service.ts`, `packages/contracts/src/catalog.ts`
- [ ] T138 [US9] [S1] PDP DTO and basket/RFQ snapshot take the effective name at the scope language — `catalog-query.service.ts`, `cart-service.ts`, `rfq-service.ts`
- [ ] T139 [S1] Regenerate artefacts; changesets
- [ ] T139a [P] [US4] [PG] [S1] RED: extend `backend/test/contract/catalog/scope-overview.test.ts` — attachment translations / hidden per channel and packaging-unit name translations
- [ ] T139b [US4] [S1] `ScopeOverviewService` lists them — `services/scope-overview.service.ts`

**Verification** (one invocation per line):
- `[PG] backend/test/contract/catalog/attachment-packaging-translations.test.ts` (asserts the audit projections of T137)
- `[PG] backend/test/integration/carts/packaging-unit-name-snapshot.test.ts`
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/packaging-units.contract.test.ts`
- `[PG] backend/test/contract/catalog/attachments.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`

### Phase 23: [admin UI] Media, attachments, packaging per scope (US9) — after Phases 21–22

- [ ] T140 [P] [US9] [S3] RED: gallery panel per-channel roles and hide toggles; per-language alt; attachment translations + hide per channel; packaging-unit name translations — `admin/test/modules/catalog/product-media-scopes.test.tsx`, `admin/test/modules/catalog/PackagingUnitsEditor.translations.test.tsx`
- [ ] T141 [US9] [S3] Gallery / attachments UI in the product editor — `src/admin/components/` (gallery and attachment sections of `ProductEditor.tsx`)
- [ ] T142 [US9] [S3] `PackagingUnitsEditor.tsx` translations
- [ ] T143 [S3] i18n keys (handover)

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-media-scopes.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/catalog/PackagingUnitsEditor.translations.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`

> **Review checkpoint F** — backend (Phases 21–22): code + security review; UI (Phases 20, 23): code
> review + designer audit.

---

## Block G — cross-cutting and the final gate (S1)

### Phase 24: Off-state, deploy parity, docs, changesets

- [ ] T144 [P] [PG] [S1] RED deploy parity (FR-110, SC-001): on a seeded pre-feature dataset, listed / searchable / reachable-by-URL / sitemap / feed sets per channel × language are identical before and after the migrations, except the four *Intended behaviour changes* of `plan.md` (non-`active` products not reachable by URL and not addable to a basket; name sort by effective name; existing per-language SEO overrides served — R21, D2, D6, Q-A) — `backend/test/integration/catalog/deploy-parity.test.ts`
- [ ] T145 [P] [PG] [S1] SC-007 sweep: every FR-004 consumer (every row of `contracts/consumers.md`, CMS product blocks included) refuses a product off at (C, L) — one table-driven test reusing each seam's fixture — `backend/test/contract/catalog/scoped-availability-all-consumers.test.ts`
- [ ] T146 [P] [PG] [S1] Test: `search` off → the Postgres listing applies the same predicate — add the search-backend-off case to `backend/test/contract/catalog/scoped-availability-matrix.test.ts` (`seo` off is already covered by T108/T115). Run it before T146a
- [ ] T146a [S1] Make T146 pass if it is red (the degrade path's narrowing goes in the statement, issue #151); if green, record "no change" here
- [ ] T147 [S1] Docs (EN): extend `packages/modules/catalog/docs/catalog/per-channel-per-language-overrides.md` (scopes, inheritance, status semantics, window, audience, overview, bulk, gate, order rules); new `url-keys-and-redirects.md`; `seo` and `search` pages updated
- [ ] T148 [S1] Docs (PL): translation cache entries and materialised pages for every page above; `pnpm --filter backend run check:docs-translations`; `pnpm --filter backend run check:module-docs`
- [ ] T149 [S1] Changesets: one per meaning for every published package touched (`contracts` minor; modules patch/minor as their exports changed); `pnpm changeset:status`
- [ ] T150 [S1] AGENTS.md traps: grep `backend/test/**` for every file path renamed or deleted in this feature; re-derive anything derived from moved files (e.g. `module-removal.test.ts` ledger); re-record a read size **only** if the band refuses it, after reading `specs/conventions/check-estate.md`

**Verification** (one invocation per line): `[PG] backend/test/integration/catalog/deploy-parity.test.ts`; `[PG] backend/test/contract/catalog/scoped-availability-all-consumers.test.ts`; `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts`; `pnpm --filter backend run check:docs-translations`; `pnpm --filter backend run check:module-docs`; `pnpm changeset:status`; `pnpm run check:naming && pnpm run check:language` (in Docker Ubuntu on the macOS host — the BSD-tool gap)

### Phase 25: Final gate and acceptance hand-off

- [ ] T151 [S1] `pnpm -r run typecheck` and `pnpm -r run lint`
- [ ] T152 [S1] `pnpm --filter backend run test:unit:fast` and `pnpm --filter '!backend' run test` (Docker Ubuntu on the macOS host)
- [ ] T153 [S1] Every `check:*` in the `quality` job: `check:module-boundary`, `check:port-dependencies`, `check:port-catches`, `check:subscribe-seam`, `check:entry-presence`, `check:off-state-coverage`, `check:action-route-permissions`, `check:bundle-pairing`, `check:release-intent -- --since origin/master`, `manifests:check`, `overlay:check`
- [ ] T154 [S1] Fork `ci-pg` fully green on the rebased tip; record the run URL
- [ ] T155 [S1] Re-run `quickstart.md` §1–§9 on a dev stack; record findings in the PR
- [ ] T156 **Coordinator re-asks owner Q1 (status values A — `draft`/`active`/`inactive` — vs B — enabled/disabled per scope + global archive action) before acceptance.** If B: add a phase (contract constant + `CHECK`s + data migration mapping scope values + admin control + archive action), per research R3; nothing else changes

**Verification**: as listed in T151–T154.

---

## Requirement coverage (each FR → first test)

| FR | Task(s) | FR | Task(s) |
| --- | --- | --- | --- |
| FR-001/002/016 | T005, T030 | FR-050–052 | T073 |
| FR-004 | T031, T039–T041, T045a, T048–T049, T145 | FR-060/061 | T005, T077, T078 |
| FR-005/007 | T031 | FR-070/072 | T100, T101 |
| FR-006 | T039 | FR-071/074 | T107, T109 |
| FR-008–012 | T005, T021 | FR-073 | T144 |
| FR-013 | T021, T087 | FR-075 | T114, T115 |
| FR-014/015 | T021, T067 | FR-076/077 | T130 |
| FR-017 | T057–T059 | FR-078/079 | T135 |
| FR-018 | T040 | FR-080–082 | T022, T101, T114a, T135 |
| FR-023/024 | T005, T048, T050 | FR-083 | T019 |
| FR-030 | T021, T087 | FR-084 | T022 (permission inventory) |
| FR-040–043 | T087, T093, T091, T078 (FR-041 `missing`) | FR-090 | T068, T095a |
| FR-091–093 | T120, T121 | FR-100 | T082, T083 |
| FR-110 | T144 | FR-111 | T108, T115 |
| SC-004 | T065 | SC-005 | T048, T050 |
| SC-006 | T073 | SC-007 | T145 |
| SC-008 | T100 | SC-001 | T144 |

## Parallel execution examples

- After Block A: **S3** starts Phase 13 and **S2** starts Phase 16 while **S1** waits for #384 (or stacks).
- After Block B: S2 runs Phases 17–19 after rebasing onto S1's tip; S1 runs Phases 9–11 meanwhile (no
  shared file), then 12, 21, 22 once S2's P18 is applied.
- Within a phase, `[P]` RED tests are written together; implementation follows in order.

## Implementation strategy

MVP = Blocks A + B (US1 end to end on every consumer) + Phase 13 (operator can set it). Each later story
ships on top independently: US2 rides P7 + P13, US3 P4/P5 + P13, US4 P9 + P14, US5 P10 + P15, US6 P11 +
P15, US7 P16–P17 + P20, US8 P18 + P20, US9 P21–P23, US10 P12 + P13.
