# Tasks: product data scopes per sales channel and language

**Feature**: `specs/163-product-data-scopes/` | **Issues**: #385, depends on #384
**Input**: `spec.md` (clarify rounds 1–4, Session 2026-10-25), `plan.md`, `research.md` (R0–R30), `data-model.md`,
`contracts/{product-scopes,admin-scopes-api,url-keys-and-redirects,consumers,seo-media-attachments,error-codes}.md`,
`quickstart.md`. Measured on `origin/master` `aa6891d63`; Block B onwards runs on `6f66ea18e` (#384 merged).

**Organisation**: 25 phases plus Block Q's 9a, 9b, 9c and 15a (owner Q1, 2026-10-25), each ≤ 10 tasks and sized for part of one builder spawn, grouped into **8
blocks of ≤ 4 phases** (Block Q included) (one builder spawn each), with a **review checkpoint after every backend block and
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
  conventional commits: `feat(catalog): …`, `test(search): …`, `docs(163): …`.
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

Up to three builders, each in its own worktree (`git worktree add ../wt-163-<stream> -b
feat/163-product-data-scopes-<stream> <S1 tip>` then `bash ../wt-163-<stream>/scripts/setup-worktree.sh`;
never a symlinked `node_modules`). Stream branches are cherry-picked onto `feat/163-product-data-scopes` at
phase boundaries by the coordinator.

| Stream | Branch | Phases | Owns (may edit freely) |
| --- | --- | --- | --- |
| **S1** backend availability | `feat/163-product-data-scopes` (primary checkout) | 1–12, 21, 22, 24, 25 | `packages/contracts/src/product-scopes.ts`; catalog scope entities/services/migrations (`product-channel-*`, `product-availability*`, `effective-value.sql.ts`, `scope-*`, `publication-window-sweep.ts`, media/attachment/packaging changes); consumer seams in `search`, `carts`, `orders`, `quote_requests`, `comparisons`, `shopping_lists`, `quick_order`, `product_feeds`, `import_export`; `backend/test/**` files it creates |
| **S2** URL keys + SEO | `feat/163-product-data-scopes-urlkeys` | 16–19, and 9c inside P17 | `packages/contracts/src/product-url-keys.ts`; `packages/contracts/src/seo.ts` from P18 on (S1 adds `SeoProductMetaPort` there in P2, T010, then hands it over); catalog `url-key*.ts`, `product-url-*.entity.ts`, the `product_url_keys` migration, `routes.admin.url-keys.ts`, `routes.public.url-keys.ts`; everything under `packages/modules/seo/`; `storefront/app/(catalog)/p/[slug]/**`, `storefront/lib/api/catalog.ts` |
| **S3** admin UI | `feat/163-product-data-scopes-admin` | 13–15, 20, 23 | `packages/modules/catalog/src/admin/**`, `packages/modules/seo/src/admin/**` (Phase 20 only, after S2 hands `seo` back), `admin/test/modules/catalog/**` |

**Single-owner shared files — S1 only.** `packages/contracts/src/index.ts`, `errors.ts`, `catalog.ts`;
`packages/modules/catalog/src/manifest.ts`, `src/backend/index.ts`, `routes.admin.ts`, `routes.public.ts`;
`packages/modules/catalog/i18n/{en,pl}.json`; `backend/test/fixtures/error-code-routing/reference-ledgers.ts`;
every generated artefact (`backend/src/db/*.generated.ts`, `manifest-index.generated.ts`, module-reference
pages, package manifests), `pnpm-lock.yaml`, the `AGENTS.md` appendix, `.changeset/`. S2 and S3 put any
line they need in such a file into **one separate commit per phase**, titled `chore(163): <stream> handover
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
| Q | 9a–9b | S1 | backend | after P9 (done 2026-10-25); **P10 and P11 wait for it** (T073–T080 build on the two-value set, the rewritten global status path and `revertibleFieldKeys`) |
| — | **Review checkpoint Q** (code review + security review, parallel) | | | |
| C | 9–12 | S1 | backend | Block B, **and P16 applied on S1** (T069 reads `product_url_keys`); P10–P11 after **Block Q (9a–9b)**; P12 after P17 (with its 9c) and P18 are applied (`catalog-query.service.ts` sequence) |
| — | **Review checkpoint C** | | | |
| D | 13–15, 15a | S3 | admin UI | P13 after Block A; P14 after P9 (T093 needs T070, T095a–b need T071); **15a after Block Q (9a–9b) is applied on S3's base**; P15 after P10–P11 **and 15a** (both edit `ProductsBulkEditDialog.tsx`) |
| — | **Review checkpoint D** (code review + designer UX audit; covers 15a as checkpoint Q-UI) | | | |
| E | 16–19, 9c | S2 | backend + storefront | P16 after Block A; P17–P19 after **Block B complete** (⛔384; P8 and P17 both edit `catalog-query.service.ts`, P7 and P17 both edit `sitemap-generator.service.ts`); **9c (T156s–T156t) is part of P17** (coordinator, 2026-10-25) and runs once **9a is on S2's base** (T156i's message, T156j's edit of the same matrix file) |
| — | **Review checkpoint E** (covers 9c's 410 condition) | | | |
| F | 20–23 | S3 (20, 23), S1 (21, 22) | mixed | P21–P22 after Block B **and P18 applied on S1** (P21 hosts the SEO overview tasks T118a/T118c, and `catalog-query.service.ts` runs in sequence); P20 after P17–P18; P23 after P21–P22 |
| — | **Review checkpoint F** (backend: 21–22; UI: 20, 23 with designer) | | | |
| G | 24–25 | S1 | cross-cutting | every block merged |
| — | **Final review pack** + green remote CI (Q1 answered 2026-10-25 — T156; its work is Block Q) | | | |

## Dependency chain

```text
P1 ─► P2 (contracts, codes) ─► P3 (schema) ─► P4 (scope writes, events)
        │                                       ├─► P13 (admin scope controls)          [S3]
        │                                       └─► P16 (URL-key storage + writes)       [S2]
⛔384 ─► P5 (availability SQL, port, catalog reads) ─► P6 (acquisition seams) ─► P7 (search, sitemap, feeds, sweep) ─► P8 (effective names, perf)
P8 (Block B done) ─► P17 (key resolution, storefront redirect) ─► P18 (SEO C×L) ─► P19 (connectors, import)   [S2]
P8, P16 ─► P9 (overview, FR-090) ─► P14 (overview UI)                                           [S3]
P9 ─► P9a (status values, migration, Archive/Restore, list) ─► P9b (bulk archive, consumers, docs, release)   [Block Q]
P9b ─► P15a (status + archive UI)                                                                [S3]
P9b ─► P10 (bulk) ─► P11 (gate; T080a fills the overview's `missing`) ─► P15 (bulk + gate UI; after P15a)   [S3]
P17's T110, P9a ─► P9c (410 for archived only; S2, inside P17) ─► P18 ─► P12
P8 ─► P12 (order rules per channel)
P8 ─► P21 (media) ─► P22 (attachments, packaging) ─► P23 (media UI)                             [S3]
P17, P18 ─► P20 (URL-key + SEO UI)
P18 ─► P21 (SEO in the overview: T118a/T118c)
P9 ─► P14 (attribute scope-flag preview UI: T095a/T095b)
all ─► P24 (off-state, parity, docs, changesets) ─► P25 (final gate)
```

`catalog-query.service.ts` is edited by P5, P8, P17 (with 9c), P18, P12, P21, P22: those phases run **in
sequence** (Block Q keeps its one edit of that file — the 410 condition — in 9c, which S2 does
inside P17 beside T110's edit of the same method; 9a–9b do not touch it).
S2 starts P17 only after Block B is merged and rebases onto S1's tip first; while P17–P18 run, S1's P12,
P21 and P22 wait (S1 works on P9–P11 meanwhile, which do not touch that file).

---

## Block A — S1 backend foundation (not gated on #384)

### Phase 1: Setup and baseline

**Goal**: a known-good baseline and the #384 status recorded.

- [x] T001 [S1] Confirm the branch is on `origin/master` (rebased 2026-10-21 onto `aa6891d63`); `git fetch origin fork`; record whether #384 (`fork/fix/storefront-channel-value-overrides`) is merged, and if not, whether the coordinator chose to stack — write the answer under this task
  - 2026-10-22: branch contains `aa6891d63` (= `origin/master`). #384 is **not** merged (`fork/fix/storefront-channel-value-overrides` is not an ancestor of `origin/master`); the coordinator did **not** stack — Block A runs on `origin/master`, Block B waits for #384.
  - 2026-10-22 (Block B start): #384 merged (PR #403); branch rebased onto `6f66ea18e` with `--signoff`. Conflicts: `AGENTS.md` Recent Changes (kept both entries, then pruned the oldest — `155-…` — to the appendix cap of 3), `packages/contracts/src/index.ts` (kept #384's `storefront-value-overrides` export beside ours). `composer:generate`/`manifests:generate` moved nothing; `--frozen-lockfile` clean. Block A + #384 unit tests green after `build:packages`.
  - 2026-10-25 (S1, after Block B P5–P8): rebased with `--signoff` onto `ad06079a4` (231 commits: features 160 price books, 161 price-book editor, #417 exact money). Conflicts: `errors.ts` and the catalog i18n bundles (union of master's `PRICE_SET_IN_PRICE_BOOKS` and our codes/strings); `product.entity.ts` (master's generated admin name keys beside our publication window); catalog `migrations/index.ts` (ours, `T035133`/`T054223`, before master's `T111811`/`T182523` — independent of the dropped price fields); `routes.admin.ts` (master's price-field refusal beside the scopes imports); `ProductEditor.tsx` (no `defaultPrice` — a product has no price of its own); `order-service.ts`/`rfq-service.ts` imports; `catalog-query.service.ts` — master's price walk (`#walkKeepingByPrice`, `#listRemainder`, decoded price cursors) now carries our availability scope and effective-value filters in `PriceWalkScope` and pages by our effective-name keyset (`#keysetFor(sort, ctx)`, master's uuid check kept in the name cursor). The `chore(162)` registry commit fell empty and was dropped; the registry was regenerated at the tip; `AGENTS.md` Recent Changes re-capped at 3; the Polish search page's translation cache re-pinned. `check:port-catches` red (inner retry `catch` in `search-query.service.ts`) fixed with `rethrowIfModuleDisabled`. Master's `prepare-customer-basket` inherits the reorder/convert exemption (consumers row 20).
- [x] T002 [S1] `bash scripts/setup-worktree.sh && pnpm run build:packages`
- [x] T003 [S1] Baseline: `pnpm --filter @endora-commerce/contracts run test`, `pnpm --filter @endora-commerce/mod-catalog run test`, `pnpm --filter @endora-commerce/mod-search run test`, `pnpm --filter @endora-commerce/mod-carts run test`; note any pre-existing red in the PR description
  - 2026-10-22: all green — contracts 53 files / 1154 tests, mod-catalog 9 / 86, mod-search 10 / 44, mod-carts 5 / 89. No pre-existing red.
- [x] T004 [S1] Open the fork draft PR so `ci-pg` runs from the first push; record the PR URL here
  - https://github.com/bfluks/endora-commerce/pull/10 (fork-internal draft, do not merge).

**Verification**:
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/docs/agents-router.test.ts`

### Phase 2: [backend] Contracts — the rule, the shapes, the codes (Principle II)

**Goal**: every pure rule and every additive Zod shape exist with tests; all five error codes minted; every
consumer still compiles.

- [x] T005 [P] [S1] RED unit test of the rule — every row of `data-model.md` §4; `inactive` at C/C×L is off and never "gone" (FR-010); inclusive window edges to the millisecond (K4, US2 #5); overridden open window beats a bounded global one; audience override replaces the whole rule (US3 #3); orphans ignored (non-member, language not offered); `effectiveOrderRules`; `pairsTurningOn` (global switch, channel row covering all languages, C×L row, non-members ignored — N3) **and its M3 → A non-trigger cases**: snapshots differing only in window (incl. a window that opens now) or only in audience → `[]` (status is the only input compared) — `packages/contracts/src/product-scopes.test.ts`
  - RED confirmed (module missing), then green — 2026-10-22.
- [x] T006 [P] [S1] RED unit test of `resolveScopeLanguage` — exact, case-insensitive, base-language (`pl` → `pl-PL`), unknown → channel default, `null` → default (A-3, R7) — same file
  - In `product-scopes.test.ts`; green.
- [x] T007 [P] [S1] RED schema tests — `patchProductScopesRequestSchema` (absent vs `null`, window `from < until` refused at service not schema, MOQ range), `productScopesResponseSchema`, `scopeOverviewResponseSchema` (incl. optional `cells[].missing`: absent accepted, `[]` accepted, `['name','urlKey','attribute:color']` accepted, an unknown token such as `'sku'` refused — FR-041), `scopeMissingValueSchema` shared by `ScopeWarning.missing` and the cell, `bulkUpdateFieldsObject.scopedStatus` (refine counts it; combined with `status` refused), `productKeyResolutionSchema`, `putProductUrlKeysRequestSchema`; **`productPath({ key, languageCode, channelDefaultLanguage })`** — `/p/<key>` for the default language, `/p/<key>?lang=<L>` otherwise, key URL-encoded, case of L preserved (D7, Q-B: the one URL seam) — `packages/contracts/src/product-scopes-shapes.test.ts`, `packages/contracts/src/product-url-keys.test.ts`
  - `product-scopes-shapes.test.ts` + `product-url-keys.test.ts`; RED then green. The T026 `updateProductRequestSchema` window test lands with T026 (Phase 4).
- [x] T008 [S1] Implement `product-scopes.ts` per `contracts/product-scopes.md` §1–§3 and `admin-scopes-api.md` (shapes — one `scopeMissingValueSchema` used by `ScopeWarning`, `SCOPE_INCOMPLETE` details and `scopeOverviewResponseSchema.cells[].missing`; `pairsTurningOn` compares effective status only, M3 → A), incl. `CatalogProductAvailabilityPort`, `CatalogProductScopeWritePort` types — `packages/contracts/src/product-scopes.ts`
  - Deviation (import cycle): `PRODUCT_SCOPE_STATUSES = productStatusSchema.options` and catalog.ts's bulk enum spreads `productStatusSchema.options` — `product-scopes.ts` imports `catalog.ts` (for `isProductVisibleTo`), so catalog.ts must not import back; still one list. `pairsTurningOn` treats a deleted/archived global as off (archive = global `inactive`), so un-archiving gates the pairs an active override already covered. `ScopeSnapshot = { global, channelRows, languageRows }`.
  - *Q1 (2026-10-25)*: the value set is now `active | inactive` (one list still, `productStatusSchema.options`), and `pairsTurningOn` compares effective **status** only — archiving is not an input (FR-060, research R3). Superseded by T156a / T156e.
- [x] T009 [S1] Create `product-url-keys.ts` with the shapes of `contracts/url-keys-and-redirects.md` §1–§5, `CatalogProductUrlKeyReadPort` and the pure `productPath()` helper — the **only** place a product URL is composed; storefront, `seo`'s sitemap and catalog's admin/resolve answers import it, so the owner's later language-path-prefix issue edits this function alone (S2 owns the file from Phase 16 on) — `packages/contracts/src/product-url-keys.ts`
  - `productSlugSchema` defined here (none existed): kebab-case, 1–160. `productPath` compares L to the default exactly.
- [x] T010 [S1] Additive edits: bulk `scopedStatus` + reasons `scope_invalid`, `completeness_gate` (`catalog.ts:791`, `:817`); `CatalogProductRecord.publishFrom?/publishUntil?` (optional, permanently — fixtures build record literals); `SeoProductMetaPort` in `seo.ts`; barrel exports — `packages/contracts/src/{catalog,seo,index}.ts`
  - `fields.scopedStatus` + mutual-exclusion refine on path `scopedStatus`; reasons added; record fields optional; `SeoProductMetaPort` in seo.ts; barrel exports both new modules.
- [x] T011 [S1] Mint `SCOPE_INVALID`, `SCOPE_INCOMPLETE`, `URL_KEY_TAKEN`, `URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, `URL_REDIRECT_NOT_FOUND` in one commit per `contracts/error-codes.md` (ERROR_CODES, `MINTED_ERROR_CODES`, catalog manifest `errorCodes`, `errors.<CODE>` en+pl, `composer:generate` + Polish module-reference refresh) — `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `packages/modules/catalog/src/manifest.ts`, `packages/modules/catalog/i18n/{en,pl}.json`
  - One commit; composer/manifests generators moved no artefact (no module-reference change). `check:error-translations` violations=0.
- [x] T012 [S1] Changeset: `@endora-commerce/contracts` `minor` (new exports `product-scopes`, `product-url-keys`, `SeoProductMetaPort`) — `.changeset/163-product-scopes-contracts.md`
  - Plus `.changeset/163-catalog-product-scopes.md` (`mod-catalog` minor) because the catalog manifest and bundles changed; extended by later phases. `check:release-intent --since origin/master` violations=0.
  - *Q1 (2026-10-25)*: narrowing `productStatusSchema` and removing `coerceProductStatusWrite` / `productStatusWriteSchema` is **breaking**. That changeset is T156q, written as breaking at bump level `minor` — D-225 refuses `major` while a package is in `0.x`, so the owner's "major" is recorded as BREAKING at `minor`, as the spec now states (coordinator, 2026-10-25; research R30.6). This file's own `minor` is unchanged.
- [x] T013 [S1] Build contracts; type-check consumers by name
  - contracts build + typecheck + lint clean; `mod-catalog` typecheck (backend + UI tsconfig) clean.

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts exec vitest run src/product-scopes.test.ts src/product-scopes-shapes.test.ts src/product-url-keys.test.ts`
- `pnpm --filter @endora-commerce/contracts run build && pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts test/unit/kernel/error-code-routing-equality.test.ts`
- `pnpm --filter backend run check:error-translations`

### Phase 3: [backend] Schema — scope tables

**Goal**: `product_channel_scopes`, `product_channel_language_scopes`, `products.publish_from/until`
exist, registered, with entities (data-model §1–§3).

- [x] T014 [P] [PG] [S1] RED integration test: both tables exist; `CHECK`s refuse a bad status, `from >= until`, MOQ 0 and 1 000 001, `allowed_organization_ids` without `visibility`, bounds without `window_overridden`; cascade on product hard delete and on channel delete (edge case *Channel deleted*) — `backend/test/integration/catalog/product-scopes-schema.test.ts`
  - Written; [PG] — unrun locally, typechecks; for the fork `ci-pg` run.
- [x] T015 [S1] Scaffold and fill `pnpm --filter backend run migration:new -- --module catalog --name product_scopes` per data-model §1–§3 (`down` drops both tables and both columns)
  - `20261022T035133_catalog_product_scopes.ts`, named constraints (`product_channel_scopes_{status,window_order,window_flag,visibility,audience_pair,min_order_quantity}_check`, `products_publish_window_check`); also a visibility value-set `CHECK` and an audience pair `CHECK` both ways; indexes `(sales_channel_id, status)` and `(sales_channel_id, language_code, status)`. Registered in the module's `migrations/index.ts`.
- [x] T016 [P] [S1] Entities `ProductChannelScope`, `ProductChannelLanguageScope` (`@GlobalEntity()`), `Product.publishFrom/publishUntil` in `[OptionalProps]` with doc comments citing the FRs — `packages/modules/catalog/src/backend/entities/{product-channel-scope,product-channel-language-scope,product}.entity.ts`
  - Composite-PK entities registered in `backend/index.ts`' entity list.
- [x] T017 [S1] `toCatalogProductRecord` fills `publishFrom/publishUntil` (the contract fields stay **optional** — required would break every consumer fixture that builds a record literal) — `catalog-product-read.service.ts` **(⛔384 touches this file: if #384 is not merged, put the two fields in a one-line hunk away from `listValueOverridesByProductIds` and expect a trivial rebase)**
  - #384 not merged: two lines after `returnable`, away from the overrides code.
- [x] T018 [S1] Regenerate + commit: `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`
  - Only `migrations-registry.generated.ts` moved; lockfile unchanged.
- [x] T019 [S1] `check-entity-tenant-classification` passes for the two entities (platform-global, FR-083)
  - 222/222 classified, unclassified=0.
- [x] T020 [S1] Run the registry/graph tests
  - migrations-registry, fk-dependency-drift, module-graph: 3 files / 275 tests green. `mod-catalog` and `backend` typecheck clean.

**Verification**:
- `[PG] backend/test/integration/catalog/product-scopes-schema.test.ts` (fork `ci-pg`)
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/fk-dependency-drift.test.ts test/unit/db/module-graph.test.ts`
- `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 4: [backend] Scoped writes — status, window, audience, order rules (US1–US3, US10 write half)

**Goal**: `GET|PATCH /admin/catalog/products/:id/scopes` per `admin-scopes-api.md` §1–§2, audited,
audited with a restorable before-state (no single-write undo, Q-D → A), evented. No read path changes yet.

- [x] T021 [P] [US1] [S1] RED unit test of `ProductScopesService.apply` — upsert / inherit (`null` deletes; all-inherit row deleted, FR-012); FR-014 refusals with `SCOPE_INVALID` reasons; removing an orphaned override always allowed (FR-015); window `from >= until` → `VALIDATION_FAILED`; audience whole-rule (C4a) and `nonMemberOrganizationIds` computed (C4b); global change never touches overrides (FR-013) — `packages/modules/catalog/src/backend/services/product-scopes.service.test.ts`
  - RED (module missing) then green: 25 tests over the pure `planProductScopeWrite` (the decision core `apply` runs inside its Command) and `nonMemberOrganizationIds`. Also refuses a duplicated channel (`VALIDATION_FAILED`, field `channels`) and a channel MOQ on a type that takes none (the 155 rule).
- [x] T022 [P] [US1] [PG] [S1] RED contract test of both routes: `catalog:read` / `catalog:write` gates (401/403 before validation), one audit row per request whose before/after hold the complete projection of every touched scope row — re-sending `before` through the route restores the previous state exactly (FR-080, FR-081; R29, owner Q-D → A — no undo endpoint is asserted because none exists), `product.updated.v1` with `changedFields` `scopedStatus` / `publicationWindow` / `audience` / `orderRules` after commit (FR-082), global status `inactive` still archives once and a scope `inactive` never does (FR-010) — `backend/test/contract/catalog/product-scopes-api.test.ts`
  - Written; [PG] — unrun locally, typechecks. Adds stub sessions `stub-product-scopes-{reader,no-catalog}-session` to `test/helpers/test-actors.ts`; uses its own channels (per-run codes, deleted in `afterAll`). Includes T026 and T028 cases.
  - *Q1 (2026-10-25)*: the assertion "global status `inactive` still archives once" flips — a status write at any scope, global included, never archives; archiving is the Archive Command (FR-010, FR-019). Updated in T156j; Archive / Restore are tested in T156c.
- [x] T023 [US1] [S1] Implement `ProductScopesService` (Command `product.scopes.update`, `objectType: 'product'`, membership via `SalesChannelMembershipPort.listChannelIdsForEntity`, channel languages from `SalesChannel`) — `packages/modules/catalog/src/backend/services/product-scopes.service.ts`
  - Audit `before`/`after` use the PATCH body's shape (only the touched rows, every field explicit); a no-op request is `skipAudit` with no event. Membership via `listChannelsForEntity` (returns the languages too); non-member organizations via `filterEntityIdsAvailableInChannel(…, 'organization', …)`.
- [x] T024 [US1] [S1] Routes `GET|PATCH /api/v1/admin/catalog/products/:id/scopes` (`requireAdmin` as `preHandler`) — `packages/modules/catalog/src/backend/routes.admin.ts`
  - Body parsed in the handler (no `schema.body`), so the gate answers 401/403 before validation.
- [x] T025 [US1] [S1] Compose the service in the container; emit events after commit — `packages/modules/catalog/src/backend/index.ts`
  - Deviation: composed in `plugin.ts` beside `ProductOverridesService` (that is where catalog's route services are built), not as a container registration in `index.ts` — no port needs it before Phase 19 (T122). The event is the Command's `event`, dispatched after commit.
- [x] T026 [US1] [S1] `PATCH /products/:id` accepts the global window (`publishFrom/publishUntil`) through the existing `product.update` Command — `catalog-admin.service.ts`, `packages/contracts/src/catalog.ts` (update schema, additive)
  - Schema test added to `product-scopes-shapes.test.ts` (RED then green). `#applyProductUpdate` writes the pair, refuses from ≥ until (`details.field = 'window'`), `changedFields: publicationWindow`; both bounds in the `product.update` before/after states.
- [x] T027 [US1] [S1] Audit reference resolver labels the new action (`audit-references.ts`). No undo handler: a single scoped write has no undo by owner decision (Q-D → A, FR-081, R29); the audit before-state is the restore path
  - `audit-references.ts` resolves by object type (`product`, unchanged); the action label is `auditLog.product.scopes.update` in both bundles.
- [x] T028 [S1] Delete propagation: product soft-delete leaves scope rows (edge case) — assert in T022, no code expected
  - Asserted in T022 (soft delete keeps both rows).
- [x] T029 [S1] Build `mod-catalog`; type-check
  - CI fix after the Phase 4 push: `check:port-shape` refused the four new port types' `Container name:` markers (no registration yet) — markers removed until each port is registered (Block B / T111 / T122 / P18); `check:fixture-substitution` refused three `?? 0` count reads in the new [PG] tests — now throw.
  - `mod-catalog` build + typecheck (backend + UI) + lint clean; `backend` typecheck clean; `mod-catalog` tests 10 files / 111 green; checks module-boundary, command-coverage, action-route-permissions, transaction-context, port-catches, test-ownership: 0 violations; generators moved nothing.

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

- [x] T030 [P] [US1] [PG] [S1] RED parity test over the generated grid of R5 (status G/C/C×L × window none/before/at-start/inside/at-end/after × audience override × anonymous/org X/org Y) — SQL id set equals `isProductEffectivelyAvailable` — `backend/test/integration/catalog/availability-parity.test.ts`
  - Written; [PG] — unrun locally, typechecks. Grid: status G×C×C×L(pl) (32) + archived/deleted/non-member/orphan-language/other-channel rows; 6 windows × (global, channel override over a bounded global); 6 audience rules × (global, channel override); 4 buyers × {pl-PL, de-DE, fr-FR (not offered)}. Holds `filterAvailable` (SQL) **and** `availableAmong` (page-side) to the rule; plus the non-array allow-list edge and unknown channel.
- [x] T031 [P] [US1] [PG] [S1] RED matrix test (Independent Test of US1): one product, two channels × two languages, overrides at C and C×L → listing, facets, PDP, **quick search** (`GET …/products/quick-search`), **links/related** of a visible product naming the off one, and **bundle configuration** with an off child, per pair; "use inherited"; a `draft` member answers 404 by slug (FR-005); archived answers 410; unresolved channel matches nothing (FR-007) — `backend/test/contract/catalog/scoped-availability-matrix.test.ts`
  - Written; [PG] — unrun locally. Listing, facets (unique per-run value on a seeded filterable attribute), PDP (unavailable body == absent body), draft 404 / archived 410, links, bundle validate (`UNKNOWN_OPTION`), quick search (`/api/v1/quick-order/search`), unknown channel code. The search-off variant is T146 (Phase 24).
  - *Q1 (2026-10-25)*: a `draft` member cannot exist after the migration (`CHECK`, T156f), so the "draft 404 by slug" case is removed in T156j and replaced in Phase 9c (T156s) by "a non-archived `inactive` member answers 404 at every scope, an archived one 410 only where it would be available with global `active`" (FR-005, O-3).
- [x] T032 [US1] [S1] `availabilityCondition` as a description (no `raw()` here) per `contracts/product-scopes.md` §4 — `packages/modules/catalog/src/backend/services/product-availability.sql.ts`
  - `availabilityCondition` = one correlated `exists` (keyed left joins of `c`/`cl` on `products ap`) + the kernel membership subquery; L ∉ channel languages is decided in TS (`false`). `audienceCaseSql` is the only audience SQL left in the listing (the old `#audienceCondition` removed). Unit test `product-availability.sql.test.ts` pins placeholder/param order.
- [x] T033 [US1] [S1] `ProductAvailabilityService` implementing `CatalogProductAvailabilityPort` (`filterAvailable`, `describeChannelAvailability`, `effectiveNames` stub → filled in P8, `effectiveOrderRules`); `providePort('catalogProductAvailabilityPort', …)` — `services/product-availability.service.ts`, `src/backend/index.ts`
  - Port registered in `index.ts` (marker restored in `product-scopes.ts`). `effectiveNames` already walks #384's overrides (L → channel default → en-US → en → first key) rather than a stub. Shared page-side helpers `availableAmong`, `loadChannelScopeRows`, `toScopeChannel` (default language always counted as offered).
- [x] T034 [US1] [S1] `listProducts` + both price paths: replace `status: 'active'` and the membership/audience conditions in `#listingNarrowing` with `availabilityCondition`; `#passesPageFilters` evaluates the pure rule over the page's scope rows (one batched read) — `catalog-query.service.ts` (`:661`, `#listingNarrowing`, `#passesPageFilters`, `#visibleProductsInOrder`)
  - Default path, both price paths (tail and range chunks) and `#visibleProductsInOrder` carry `availabilityCondition` in their own statement (raw key made in the executing expression); page-side `#availableAmong` (pure rule, membership known) replaces `filterByChannel` + `isProductVisibleTo`. `CatalogResolvedChannel.languages?` added (optional for fixtures; absent = default language only); `readContext` in `routes.public.ts` and `routes.external.ts` pass `ch.languages`.
- [x] T035 [US1] [S1] Facets (`:1840`) on the same condition — `catalog-query.service.ts`
  - Facets: statement + rule. Also the category tree counts (`directProductSetsByCategory`), which had no status test at all.
- [x] T036 [US1] [S1] `getProductByIdOrSlug`: 410 iff archived; else 404 unless available at (C, `resolveScopeLanguage`) (FR-005) — `catalog-query.service.ts:1286`; the route passes the scope language — `routes.public.ts` `readContext`
  - Deviation (security checkpoint A item 3): membership and the effective audience are checked **before** the 410, so an archived product answers 410 only inside its channel and audience, 404 elsewhere. L is resolved in the service from `preferredLanguage` (the route passes the channel languages). `resolveScopeLanguage` now ignores `;q=` (contracts test added).
- [x] T037 [US1] [S1] Links/related and bundle-configuration validate apply the port to linked/child ids (edge case *child off*); quick search replaces its own `p.status = 'active'` + audience predicate with `availabilityCondition` (availability only — its effective names are T062) — `product-link.service.ts:360`, `bundle.service.ts`, `catalog-quick-search.service.ts:118`
  - Links: `listForStorefront` drops its `status: 'active'` + membership for `availableAmong` (closes the #227 audience residue on link tiles). Bundle: `validateConfiguration(…, availableProductIds?)` — the public route passes `filterAvailableForRequest`; composite children/options (`summariesForIds`) are filtered too. Quick search: `availabilityCondition` replaces the raw `sales_channel_products` join, status and audience; takes membership + resolution ports; `CatalogQuickSearchParams.languageCode?` added and `quick_order` passes the request's tag. `quick-search-audience-parity.test.ts` [PG] constructor updated.
- [x] T038 [S1] The existing `public-read-visibility.test.ts`, `products-status-inactive.test.ts`, `product-acquisition-visibility.test.ts` still pass or are updated **only** where FR-005 changes the answer (draft by slug → 404); note each change in the PR
  - `public-read-visibility`, `products-status-inactive` (admin only) unchanged. `integration/catalog/public-product-language-resolution.test.ts` read drafts by slug — now publishes its two products (FR-005). `product-acquisition-visibility` is Phase 6's.
  - *Q1 (2026-10-25)*: "draft by slug → 404" now reads "non-archived `inactive` by slug → 404" (T156s); `products-status-inactive.test.ts` changes meaning — `inactive` no longer archives — and is updated in T156j.

**Verification**:
- `[PG] backend/test/integration/catalog/availability-parity.test.ts`
- `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts`
- `[PG] backend/test/contract/catalog/public-read-visibility.test.ts`
- `[PG] backend/test/contract/catalog/products-status-inactive.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches`

### Phase 6: [backend] ⛔384 Acquisition seams (US1, FR-006, FR-018)

**Goal**: rows 13–18 of `contracts/consumers.md` use `filterAvailable`; quote requests refuse/warn.

- [x] T039 [P] [US1] [PG] [S1] RED carts: add/batch-add refuse an off product with `PRODUCT_NOT_FOUND`; a line whose product goes off stays and is `product_unavailable` and blocks placement (FR-006); window ending between add and place → refused at placement (edge case) — `backend/test/integration/carts/scoped-availability.test.ts`
  - Written; [PG] — unrun locally. Single add + batch (quick-order build → cart); line stays + `unavailable`/`not_purchasable`; placement 404 with `cartItemIds`; window ending between add and place. Shared fixture `backend/test/helpers/product-scope-fixture.ts`.
- [x] T040 [P] [US1] [PG] [S1] RED quote requests: buyer line off at (RFQ channel, L) → single not-found (FR-018); operator `createOnBehalf` → accepted with `warnings[].code = 'PRODUCT_UNAVAILABLE_IN_SCOPE'` — `backend/test/integration/quote_requests/scoped-availability.test.ts`
  - Written; [PG] — unrun locally. Buyer 404 body == absent; operator 201 + `warnings`; none when all available.
- [x] T041 [P] [US1] [PG] [S1] RED comparisons, shopping lists, quick order (incl. `'unrestricted'` arm unchanged) — `backend/test/integration/{comparisons,shopping_lists,quick_order}/scoped-availability.test.ts`
  - Written; [PG] — unrun locally: comparisons (add 404 + column `available: false`), shopping lists (save 404 + conversion skip `product_not_found`), quick order (import `product_not_found`; admin `'unrestricted'` arm unchanged).
- [x] T042 [US1] [S1] carts: `cart-service.ts:782-819` and batch add use the port (language = `resolveScopeLanguage`; admin-on-behalf with `salesChannelId` uses that channel's default language); `cart-minimums.ts:380` marks port-excluded products `product_unavailable`; declare `catalogProductAvailabilityPort` via `lazyPort` — `packages/modules/carts/src/backend/services/{cart-service,cart-minimums}.ts`, `src/backend/index.ts`
  - `#resolveLine` (single + batch) asks the port: channel = named (admin, L = channel default, N2) else request channel; L = `CartActor.languageTag` (request's first Accept-Language tag, new) resolved against the request channel record; no channel (outside a request) → audience only, as before (FR-007). `CartService` takes the port **in place of** the membership port (no longer used there). Cart view narrows records (`availableRecords`), approval narrows via `assertCartMeetsMinimums(…availableOnly)`; up-sell strip filtered too (not in the task list; a buyer listing). Helpers in `carts/src/backend/services/cart-availability.ts`.
- [x] T043 [US1] [S1] orders placement + preview: `placement-minimums.ts:48` and `preview-line-availability.ts` treat port-excluded as unavailable; reorder unchanged (exempt) — `packages/modules/orders/src/backend/services/`
  - `readBasketCatalogue(…, narrow)` — placement (order channel, L = `resolveScopeLanguage(orderChannel, options.language)`) and checkout preview (basket channel) narrow the records, so an unavailable line is `product_unavailable` → 404 `cartItemIds`. Admin preview: member-but-unavailable (channel default, N2) reported as `PRODUCT_NOT_IN_SALES_CHANNEL` (no new message code). Deviation: the orders service has only the response (prose) language, resolved against the channel's languages (base-language match).
- [x] T044 [US1] [S1] quote_requests: `rfq-service.ts:223-225`, `:758` buyer refusal; `createOnBehalf` warnings; contract shape `warnings` additive — `packages/modules/quote_requests/src/backend/services/rfq-service.ts`, `packages/contracts/src/quote-requests.ts`
  - `#acquirableProductsById` asks the port (L from `options.language`, base-matched); resubmit now goes through it too (was membership only). Operator: route answers `warnings` from `RfqAdminService.onBehalfWarnings` (channel default, N2) — kept beside `createOnBehalf` so the method's return type and its callers are unchanged. Contract: `ADMIN_QUOTE_REQUEST_WARNING_CODES`, `adminQuoteRequestWarningSchema`. Admin UI rendering of the warning is S3's (not in this block).
- [x] T045 [US1] [S1] comparisons (`:374`, `:530`, `:617`), shopping_lists (`:236-249`, `:462`), quick_order (`catalog-lookup.ts:56`) — swap to the port, keep single not-found
  - comparisons: add + view `available` via the port (port replaces the membership constructor arg; 3 backend unit tests swap their refusing-membership proxy for an all-available stub); shopping lists: save + conversion partition (port optional-in-signature, required on a request channel); quick order: `CatalogPortLookup` takes the port in place of membership, request channel default language. All keep their single not-found.
- [x] T045a [P] [US1] [PG] [S1] Verify test (consumers.md row 19): a CMS product block — the `products-by-slugs` and category-list requests `storefront/lib/page-builder/catalog-block-data.ts` makes (`GET /api/v1/catalog/products?categorySlug=&limit=`, `GET /api/v1/catalog/products/:slug`) — omits a product off at (C, L) and shows it where on; `catalog-block-data.ts` and `packages/cms-components/src/utils/catalog-block-data.ts` carry no predicate of their own (grep, note in the PR). Expected green after P5; red means a seam P5 missed — fix it in this phase — `backend/test/contract/cms/product-block-scoped-availability.test.ts`
  - Written; [PG] — unrun locally. `catalog-block-data.ts` (both) carry no predicate (grep: only HTTP-status/Promise `status`).
- [x] T046 [S1] Each module's manifest already lists `catalog`; `check:port-dependencies` green; changesets for touched packages (`patch`)
  - `check:port-dependencies` 0 (every consumer already lists `catalog`); changeset `163-acquisition-seams-scoped-availability.md` (carts, orders, quote-requests, comparisons, shopping-lists patch) + quick-order/contracts bodies extended.
- [x] T047 [S1] Grep `backend/test/**` for `outOfRequestChannel` / `productIdsInRequestChannel` expectations that changed meaning; update or justify (AGENTS.md trap: derived expectations)
  - `backend/test/**`: no expectation of `outOfRequestChannel`/`productIdsInRequestChannel` changed meaning (remaining mentions are comments and the kernel's published-surface list). Updated: `test/helpers/orders-neighbour-ports.ts` (real `ProductAvailabilityService`), comparisons unit tests (stub), orders' `admin-order-preview-membership-port.test.ts` (stub).

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

- [x] T048 [P] [US2] [PG] [S1] RED search: documents carry `liveLanguages`, `publishFromMs`, `publishUntilMs`, channel-effective audience; the **index filter** excludes a product off at (C, L) and outside the window at query time with full pages (no short page, issue #151); a pre-deploy document without the fields is served as before (R8) — `backend/test/integration/search/scoped-availability.test.ts`
  - Written; [PG] (Meilisearch) — unrun locally. Document fields, full page under `limit=2` with three off products sorted first, pre-deploy document served. Pure filter ≡ rule test: `packages/modules/search/src/backend/services/search-availability-filter.test.ts` (green).
- [x] T049 [P] [US2] [PG] [S1] RED sitemap and feeds honour availability per channel language (anonymous audience) and the window at generation time — `backend/test/contract/seo/sitemap-scoped.test.ts`, `backend/test/integration/product_feeds/scoped-availability.test.ts`
  - Written; [PG] — unrun locally: `contract/seo/sitemap-scoped.test.ts`, `integration/product_feeds/scoped-availability.test.ts` (selection preview count).
- [x] T050 [P] [US2] [PG] [S1] RED sweep: bounds crossed in `(lastSweep, now]` emit one `product.updated.v1` `['publicationWindow']` each; idempotent; missing watermark → `now − 2×interval`; no status write (A-4) — `backend/test/integration/catalog/publication-window-sweep.test.ts`
  - Written; [PG] — unrun locally (in-memory watermark stub; asserts global + overridden channel bounds, idempotence, `now − 2×interval`, no status write).
- [x] T051 [US2] [S1] `PublicationWindowSweep` + Job Scheduler `catalog.publication-window.sweep` (5 min) via `ctx.worker`; watermark key in Redis — `packages/modules/catalog/src/backend/services/publication-window-sweep.ts`, `src/backend/index.ts`
  - `publication-window-sweep.ts`: `PublicationWindowSweep.sweep(now)` (one `union` statement over `products` and overridden `product_channel_scopes`), BullMQ Job Scheduler + consumer via `ctx.worker` in `ctx.routes` (the `assets_library` retention-sweep shape: only where `processRunsWorkers` and `moduleQueueRedis`); watermark on the process Redis connection.
- [x] T052 [US1] [S1] Search indexer: `isPublishable` → `describeChannelAvailability`; `buildDocument` new fields; filterable attributes added in `reindexChannel` settings — `packages/modules/search/src/backend/services/search-indexer.ts`
  - `isPublishable` → `isPublishableIn(describeChannelAvailability)` in reindex and upsert (upsert asks per linked channel); document gains `liveLanguages`, `publishFromMs`, `publishUntilMs`, `allowedOrganizationIds`, channel-effective `visibility` (`search-availability.ts`); filterable list extended. `SearchIndexerOptions.availability` required; `backend/test/helpers/search-indexer-ports.ts` supplies it.
- [x] T053 [US1] [S1] Search query: filter clause of R8 with L from the request; hydrate through `filterAvailable` — `packages/modules/search/src/backend/services/search-query.service.ts`
  - `availabilityFilter` appended to the index filter (L = `searchScopeLanguage`, the request tag against `resolvedChannel.languages` — added to `ResolvedSearchChannel`, search `readContext` passes it); hydration through `filterAvailable` (6th constructor arg; unwired ⇒ throws). `attributesToRetrieve` keeps the allow-list out of every response (security item 4).
- [x] T054 [US1] [S1] Sitemap generator uses `describeChannelAvailability` (keys stay `slug` until P17) — `packages/modules/seo/src/backend/services/sitemap-generator.service.ts` **(S1 edits this one `seo` file in P7; S2 takes `seo` from P17 on)**
  - `describeChannelAvailability` + window at generation time + anonymous audience over the effective rule; `activeOnly` dropped from the read (a globally-off, channel-on product is listed); one URL per live language through `productPath` (slug until P17). seo unit test updated (stub; `liveOnly` only).
- [x] T055 [US1] [S1] Feeds selection uses `filterAvailable` at the feed's channel/language — `packages/modules/product_feeds/src/backend/services/product-selection.service.ts`
  - Deviation: the floor lives in `catalogProductFilterPort`, so the port gained `scope: { channelId, languageTag }` — scoped floor = not archived/deleted + `filterAvailable` (anonymous, L resolved by catalog), paged to full pages; count likewise. Feeds pass the feed's channel and `languageCode`.
- [x] T056 [S1] `search` docs page: new fields and the reindex step — `packages/modules/search/docs/search.md` + PL mirror
  - New section *Availability per channel and language* + upgrade reindex step, PL mirror (cache entry re-hashed + materialised page); `check:docs-translations` 0 findings.

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

- [x] T057 [P] [PG] [S1] RED parity: `effectiveTextSql` equals #384's `channelOverrideFor` over a grid (override at C×L for the request language / a later language / channel-only; baseline present/absent per leg) — `backend/test/integration/catalog/effective-text-parity.test.ts`
  - Written; [PG] — unrun locally (5 baselines × 8 override sets × 4 request languages, expectation derived from `effectiveSystemText`).
- [x] T058 [P] [PG] [S1] RED listing: free-text search, attribute filters, facet counts and name sort use effective values at (C, L); name sort keyset `(effective name, id)` pages without gaps or repeats (D6) — `backend/test/integration/catalog/listing-effective-names.test.ts`
  - Written; [PG] — unrun locally: name-sort paging (limit 2) across overrides that move products to the first and last position; free text finds and shows the override. Existing `listing-name-sort-paging.test.ts` keeps its order (names sort like slugs there).
- [x] T059 [P] [PG] [S1] RED quick search (matches and returns effective name), comparisons (names + compared values), basket line names and batch outcomes, RFQ line snapshots (buyer: request language → channel default; operator: channel default — N2; snapshot kept after an override changes) — `backend/test/integration/{catalog/quick-search-effective-names,comparisons/effective-values,carts/effective-names,quote_requests/effective-names}.test.ts`
  - Written; [PG] — unrun locally: `catalog/quick-search-effective-names`, `comparisons/effective-values`, `carts/effective-names`, `quote_requests/effective-names` (buyer snapshot kept after the override changes; operator at the channel default). Fixture `setNameOverride`/`clearValueOverrides`.
- [x] T060 [S1] `effectiveTextSql` builder — `packages/modules/catalog/src/backend/services/effective-value.sql.ts`
  - `effective-value.sql.ts`: `effectiveTextSql` (name/description incl. the storefront baseline pick) and `effectiveAttributeSql`; overrides of one (product, attribute, channel) aggregated once per row into a jsonb map; params bound as written (Writer). Unit test `effective-value.sql.test.ts` green.
- [x] T061 [S1] Listing q / filters / counts / name sort through it — `catalog-query.service.ts`
  - Name sort keyset `(effective name, id)` via raw `orderBy`/`after` made inline (`#keysetFor`, cursor name computed in TS by `#cursorNames`); free text = SKU + effective Name + effective searchable attributes; attribute filters on effective values in every statement (default + both price paths) with TS twin (`#listingFilters().passes`); facet counts over effective values. Old slug keyset/`orderForSort`/`#passesPageFilters` removed.
- [x] T062 [S1] Quick search — `catalog-quick-search.service.ts:118` area
  - Quick search matches `effectiveTextSql` at (C, L) and returns `CatalogQuickSearchHit.effectiveName` (additive); `quick_order` displays it.
- [x] T063 [S1] `effectiveNames` on the port; carts, quote_requests, comparisons consume it / #384's helpers — `product-availability.service.ts`, `cart-service.ts:1251`, `rfq-service.ts:462`, `:635`, `comparison-service.ts:607`, `:623`
  - `effectiveNames(…, languageCode: string | null)` (null = channel default). Carts: view line names + batch below-minimum outcomes/refusals; quote requests: buyer create/draft-edit snapshots (request language), operator `createOnBehalf` (channel default, N2) via `RfqService.lineNames`; comparisons: names (record entry for L) and compared values via `channelOverrideFor`. Admin `modify`: a new line is named at the channel default too (`ea2aebd4e`).
- [x] T064 [S1] Search: `localizedNames.<L>` in documents + `attributesToSearchOn` (FR-017 b on the Meilisearch path) — `search-indexer.ts`, `search-query.service.ts`
  - `localizedNames` per live language (#384 walk over the channel's overrides, storefront baseline pick) in documents, `localizedNames` searchable; query `attributesToSearchOn: [localizedNames.<L>, name, sku, description, searchableOptions, attributes.<searchable>]`, retried without it on `invalid_search_attributes_to_search_on` (an index not reindexed yet). [PG] assertion added to `integration/search/scoped-availability.test.ts`.
- [x] T065 [S1] Benchmark: a scoped variant of `backend/test/perf/catalog-list.bench.ts` and `backend/test/perf/catalog/listing-filtered-page.bench.ts` (20% of products with C and C×L rows, windows, audience overrides, effective-name sort) and record before/after in the PR; **> 10% regression stops the block** and goes back to the architect (R1 fallback) — `backend/test/perf/catalog/listing-scoped-availability.bench.ts`
  - Written as `backend/test/perf/catalog/listing-scoped-availability.bench.ts` — same corpus unscoped vs 20 % scoped (channel rows, windows, audience, C×L, name overrides), 5 scenarios incl. `sort=name` 2nd page, median of `PERF_REPEATS`, fails over `PERF_MAX_REGRESSION` (0.10). The code before/after half: run `listing-filtered-page.bench.ts` and `catalog-list.bench.ts` on `origin/master` and this branch on one runner.
  - **Run** on the fork ci-pg with `PERF_RUN=true` on the rebased tip `ff9f135cc` (run 40503071234), scoped ÷ unscoped: default ordering first page ×0.911, second page ×0.962; `sort=name` first page ×1.035, second page ×1.028; free text ×0.999 — every scenario inside the 10 % budget, **gate passed** (SC-004). `catalog-list.bench.ts` p95 20.9 ms (budget 50 ms). The coordinator adds two more runs.
- [x] T066 [S1] Release note entry: name sort order (D6), reindex per channel (R21) — `.changeset/163-…` bodies of the touched packages
  - Release notes in `.changeset/163-search-sitemap-feeds-scoped-availability.md` (reindex per channel, name sort order, old name cursors) and `163-catalog-product-scopes.md` (D6).

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
>
> **Checkpoint B fix round (2026-10-25).** ci-pg on `5d318dcf3`: 10 of 45 files red. Root cause of four
> (effective-text parity, listing effective names ×2, quick search): `effective-value.sql.ts` `nonEmpty`
> read a missing key (SQL `NULL`) as non-empty — a simple `case` over `jsonb_typeof(NULL)` fell to
> `else true` — so the walk stopped at its first leg and a channel-only override never applied; fixed
> (scalars named, `else false`), the parity grid re-run locally on PGlite (0 of 160 mismatches; 67
> before). Test-side: 404 bodies compared without `requestId` and at the same language
> (`errorBodyOf`); facet fixture accepts the seed's `enum` attributes; batch add expects feature 155's
> whole-batch 404 (consumers.md preamble: the seam keeps its single not-found); the search window case
> indexes an ended window (a DB change after indexing never reaches the index); the no-surface
> statement comparison pins `Date` (the availability condition inlines the read's `now`; the two
> statement lists differed in that literal only). Security: rows 21–22 (price and stock probes,
> notify-when-available) on the port; `markPersonalisedPricing` stamps every authenticated caller and
> runs on filters/categories; buyer seams name their channel (basket's own, RFQ
> `salesChannelId` option, quick-order lookup); archived 410 only where available with the archive
> neutralised; `validateConfiguration` filter required; link service throws on a channel with no
> default language. Code review: W1 boot pass `SearchIndexer.ensureQuerySettings` (worker process,
> settings pushed only where missing); W2 `= any(?::uuid[])` / chunked `$in`; W4 name cursor read by
> the statement's own `effectiveTextSql`; N3–N6 done; N1/N2 one home (`toScopeChannel`,
> `scopeLanguageOf`, `firstLanguageTag` in contracts), read by carts, comparisons, shopping lists,
> quote requests, price lists and inventory; the route-local `Accept-Language` parsers predating 163
> are left as they were.

---

## Block Q — the status model after the owner's final Q1 (added 2026-10-25)

Spec Session 2026-10-25 answers T156: `draft` is removed, status is `active` | `inactive` at every scope,
`inactive` anywhere is plain off, and archiving is a separate global Archive / Restore action (FR-010,
FR-019, FR-053, FR-110, FR-112, FR-113, SC-009). Decisions and the full inventory: `research.md` R30; data:
`data-model.md` §13–§14. **Placement**: this block sits here in the file to keep the merge with S1's Phase 9
ticks clean; it **runs after Phase 9 (done 2026-10-25) and before Phase 10**. Phase 9c is S2's and is done
inside Phase 17, once 9a is on S2's base (coordinator, 2026-10-25; R30.7); Phase 15a is S3's and runs before
Phase 15.

### Phase 9a: [backend] Status values, the migration, Archive / Restore for one product, the admin list (FR-010, FR-019, FR-110, FR-112, FR-113, SC-009)

**Goal**: `draft` is gone from contracts, entity and data; a status write never touches `archivedAt`;
Archive / Restore are their own audited Commands and routes; the admin list filters archived by
`archivedAt`. Every package still type-checks.

- [x] T156a [P] [S1] RED contracts unit tests: `productStatusSchema` accepts `active` / `inactive` and refuses `draft` and `archived`; `createProductRequestSchema`, `updateProductRequestSchema`, `resolveProductIdsRequestSchema`, bulk `fields.status` and `fields.scopedStatus.value` refuse both (`inherit` still accepted for scoped); `coerceProductStatusWrite` and `productStatusWriteSchema` are no longer exported; `PRODUCT_SCOPE_STATUSES` equals `['active','inactive']`; bulk `fields.archived: boolean` accepted alone and refused beside any other field; `pairsTurningOn` compares effective **status** only — an archived product whose global status goes `inactive` → `active` returns its pairs, a snapshot pair differing only in `archivedAt` (Restore) returns `[]` (FR-060, R3) — `packages/contracts/src/{product-scopes.test.ts,product-scopes-shapes.test.ts}`, a new `packages/contracts/src/catalog-product-status.test.ts`
- [x] T156b [P] [PG] [S1] RED migration test (data-model §13): run the new migration class's `down` (the three-value `CHECK`s and the `draft` default back), seed through raw SQL an `active`, a `draft`, an `inactive` with `archived_at`, an `inactive` without it (known `updated_at`), and `draft` rows in both scope tables; then run `up`: `draft` → `inactive` with `archived_at` still null, the archived-less `inactive` has `archived_at = updated_at`, the rest unchanged, no row other than `active` / `inactive` in any of the three tables (SC-009); all three `CHECK`s refuse `draft`; the column default is `inactive`; `up` is correct on a database whose scope tables were created by the old three-value body (R30.1); all inside **one transaction that the test rolls back** (PostgreSQL DDL is transactional), so the worker's clone is left exactly as it was — `up`'s backfill is table-wide and would otherwise archive every `inactive` fixture earlier files on that worker created (files on one worker share its clone one after another, `specs/conventions/backend-test-suite.md`); only if the migration cannot run on the test's transaction, fall back to `down` → seed → `up` with `up` in a `finally` and seed-scoped assertions — `backend/test/integration/catalog/product-status-drop-draft-migration.test.ts`
- [x] T156c [P] [PG] [S1] RED contract test (FR-019, FR-082, FR-010): `POST …/products/:id/archive` and `…/restore` answer 401/403 before anything, 404 for unknown / soft-deleted / non-UUID ids; Archive sets `archivedAt`, leaves status unchanged globally and in every scope row, writes one `product.archive` audit row with `before` / `after` `{ archivedAt }`, emits `product.updated.v1` `['archivedAt']` then `product.archived.v1` once; a second Archive answers 200 with no audit row and no event; Restore clears it, one `product.restore` row, `product.updated.v1` only; `PATCH …/products/:id` with `status: 'inactive'` leaves `archivedAt` null and emits no `product.archived.v1`; `status: 'active'` on an archived product leaves it archived (O-5); `status: 'draft'` and `'archived'` → `400 VALIDATION_FAILED`, `details.field = 'status'`, on the admin create / update **and** the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` (`routes.api-key.ts`), whose update of an existing product with `status: 'inactive'` no longer archives either; a create without status is `inactive`; a duplicate is `inactive` with `archivedAt` null, also from an archived `active` source (Q1-d) — `backend/test/contract/catalog/product-archive-restore.test.ts`. Same task, unit side: rewrite `backend/test/unit/catalog/catalog-admin-update-product-status.test.ts` (no status write sets or clears `archivedAt`) and `catalog-admin-audit-emissions.test.ts` (`archiveProduct` is the Archive Command)
- [x] T156d [P] [PG] [S1] RED admin list and selection (FR-113, R30.4): by default no archived product of any status is listed; a non-archived `inactive` product is listed under no filter and under `status=inactive`; `archived=only` lists archived products of both statuses; `archived=include` and the legacy `includeArchived=1` list both; `status=draft` and `status=archived` → `400 VALIDATION_FAILED`; `counts` = `{ all, active, inactive, archived }` with `all` / `active` / `inactive` over non-archived rows; `resolve-ids` with `archived: 'only'` — `backend/test/contract/catalog/products-admin-list-archived.test.ts`; update `backend/test/contract/catalog/products-resolve-ids.test.ts`
- [x] T156e [S1] Contracts: `productStatusSchema = z.enum(['active','inactive'])`; delete `coerceProductStatusWrite` and `productStatusWriteSchema` and use `productStatusSchema` at `:664`, `:793`; `bulkUpdateFieldsObject.archived` + its exclusivity refine (the "at least one field" refine counts it); `resolveProductIdsRequestSchema.archived`; the list-count shape if the contract carries one; `product.archived.v1` doc comment ("the product was archived by the Archive action", `:3602`); `statusOnAt` and the `pairsTurningOn` docstring (`product-scopes.ts:196-227`) on status only; `prompt-actions.ts:257` and `quick-order.ts:193` without `draft`; switch `import_export/…/adapters/products.adapter.ts` (`:3`, `:80`, and its comment `:17-22`) to `productStatusSchema` (it imports the removed schema). **Compile-only edits beyond S1's files are part of this task**: whatever `pnpm --filter <pkg> run typecheck` refuses once `ProductStatus` loses `draft` — at `829ce2995` at least `packages/admin-kit/src/components/product-browser/ProductBrowserDialog.tsx:84-98` (`Record<ProductBrowserStatus…>` literals keyed `draft`) and any S3-owned `packages/modules/catalog/src/admin/**` file that passes its local `'draft' | …` union into a contract type — is fixed by **removing the `draft` literal only**, nothing else, in one commit titled `chore(163): q1 compile-only — drop draft literals` that S3's Phase 15a rebases over (stream-ownership exception, recorded here) — `packages/contracts/src/{catalog,product-scopes,prompt-actions,quick-order}.ts`, `packages/modules/import_export/src/backend/services/adapters/products.adapter.ts`
- [x] T156f [S1] Migration `pnpm --filter backend run migration:new -- --module catalog --name product_status_drop_draft` per R30.1–R30.2 (backfill → convert → `drop constraint if exists` + re-add the scope `CHECK`s → `products_status_check` → default `inactive`; `down` per R30.1); `Product.status: 'active' | 'inactive' = 'inactive'` with a doc comment citing FR-010 / FR-019; `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`, artefacts in the same commit — `packages/modules/catalog/src/{migrations,backend/entities/product.entity.ts}`. **Do not edit `20261022T035133_catalog_product_scopes.ts`** (R30.1)
- [x] T156g [S1] `CatalogAdminService`: the status write never sets or clears `archivedAt` (`:629-636`) and the `archived` outcome / `#emitArchived` plumbing leaves the update paths (`:445-530`); `archiveProduct(id)` (reimplemented, no longer deprecated, no longer `updateProduct`) and `restoreProduct(id)` as Commands `product.archive` / `product.restore` per R30.3 — `skipAudit` and no event on a no-op, `product.archived.v1` after `product.updated.v1` inside one `events.run` scope; create defaults to `inactive` (`:347`), duplicate is always `inactive` with `archivedAt` cleared (`:891`, doc `:837`) — `services/catalog-admin.service.ts`
- [x] T156h [S1] Routes `POST /api/v1/admin/catalog/products/:id/archive` and `…/restore` (`requireAdmin('catalog:write')` as `preHandler`, no body, `serializeAdminProduct`); list: `status` validated (`draft` / `archived` / unknown → 400; the `status=archived` mapping `:560-566` deleted), `archived` mode with `includeArchived` as `include`, counts per R30.4; `resolveProductIds` / `resolve-ids` the same `archived` mode — `routes.admin.ts`, `services/catalog-admin.service.ts:1369-1525`. `check:action-route-permissions` and `permission-inventory` see the two routes under `catalog:write`
- [x] T156i [S1] Bundles (S1-owned): `errors.PRODUCT_ARCHIVED` → "Product is archived." / "Produkt jest zarchiwizowany." (the PDP message itself changes in T156t); `auditLog.product.archive` / `auditLog.product.restore` en+pl; `adminSearch.product.status.draft` removed with its use (`admin-search-provider.ts:28`); `audit-references.ts` resolves the two actions by object type (no code expected); regenerate if a module-reference page moves (Polish refresh in the same commit) — `packages/modules/catalog/i18n/{en,pl}.json`, `packages/modules/catalog/src/backend/admin-search-provider.ts`
- [x] T156j [S1] Existing backend tests that assert the old model, updated in the same commits as the code they cover: delete `backend/test/unit/catalog/product-status-coerce.test.ts` (and its entry in `backend/test/service-dependent-unit-tests.ts` if listed — grep `backend/test/**` for `coerceProductStatusWrite`, `productStatusWriteSchema`, `archiveProduct` first, AGENTS.md trap); `contract/catalog/products-status-inactive.test.ts` (inactive no longer archives), `contract/catalog/product-scopes-api.test.ts` (T022's "global `inactive` still archives once" flips: a global `inactive` never archives), `contract/catalog/admin-duplicate-product.test.ts`, `contract/catalog/scoped-availability-matrix.test.ts` (the `draft` member case is removed here; its replacement is T156s), `integration/catalog/webhooks.test.ts` (`product.archived.v1` from Archive only), `integration/search/archive-then-reactivate.test.ts` and `integration/search/event-subscriber.test.ts` (archive / reactivate through Archive / Restore; a global `inactive` leaves the index through `product.updated.v1` alone); every other file that seeds `status: 'draft'` gets `inactive` — the T156r grep lists them (at `829ce2995`: `contract/catalog/{gallery-resolution,products-bulk-update-atomicity,products-bulk-update-untouched-fields,scope-overview,scoped-availability-probes}`, `contract/{product_feeds/selection-preview,sales_channels/admin-membership.contract,seo/sitemap-scoped}`, `integration/{admin_search/catalog-providers,carts/scoped-availability,catalog/availability-parity,catalog/inventory-columns,catalog/product-filter-port,catalog/product-scopes-schema,catalog/publication-window-sweep,comparisons/scoped-availability,inventory/product-threshold-copy-port,product_feeds/generation,product_feeds/pinned-book-withdrawal,product_feeds/scoped-availability,product_feeds/selection,quick_order/scoped-availability,sales_channels/*,search/scoped-availability,shopping_lists/scoped-availability}`, `perf/catalog/listing-scoped-availability.bench.ts`, `unit/packages/module-package-ports-surface.test.ts`, and the module-local `carts/…/cart-batch-add.test.ts`, `catalog/…/{admin-search-provider,product-scopes.service,scope-overview.service}.test.ts`, `megamenu/…/cross-module-ports.test.ts`, `search/…/search-availability-filter.test.ts`, `contracts/src/product-scopes-matrix.test.ts`)

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts exec vitest run src/catalog-product-status.test.ts src/product-scopes.test.ts src/product-scopes-shapes.test.ts`
- `pnpm --filter @endora-commerce/contracts run build && pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/catalog/catalog-admin-update-product-status.test.ts test/unit/catalog/catalog-admin-audit-emissions.test.ts test/unit/db/migrations-registry.test.ts`
- `[PG] backend/test/integration/catalog/product-status-drop-draft-migration.test.ts`
- `[PG] backend/test/contract/catalog/product-archive-restore.test.ts`
- `[PG] backend/test/contract/catalog/products-admin-list-archived.test.ts`
- `[PG] backend/test/contract/catalog/products-status-inactive.test.ts`
- `[PG] backend/test/contract/catalog/product-scopes-api.test.ts`
- `[PG] backend/test/integration/search/archive-then-reactivate.test.ts`
- `[PG] backend/test/integration/catalog/webhooks.test.ts`
- `[PG] backend/test/contract/admin_users/permission-inventory.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck && pnpm --filter @endora-commerce/mod-import-export run typecheck && pnpm --filter @endora-commerce/admin-kit run typecheck && pnpm --filter admin run typecheck && pnpm --filter backend run typecheck`
- `pnpm --filter backend run check:action-route-permissions && pnpm --filter backend run check:command-coverage && pnpm --filter backend run check:module-boundary`

**Phase 9a note** (S1, 2026-10-26): migration `20261025T222634_catalog_product_status_drop_draft`
(scaffolded, barrel and registry regenerated). Decisions taken in the code, to confirm at checkpoint Q:
- The archived-list `status` / `archived` refusals are `400 VALIDATION_FAILED` with `details.field`
  (`'status'` / `'archived'`) thrown by the route; a refused **body** value (create, update, API-key
  upsert, resolve-ids) is the Zod envelope's `details: [{ path: 'status', … }]` — the contract test
  asserts that shape rather than `details.field`.
- A non-UUID `:id` on Archive / Restore is refused with `404 PRODUCT_NOT_FOUND` before the query.
- `archiveProduct` / `restoreProduct` return `{ product, changed }` so the bulk path (T156m) can report
  `changedFields: []` for a no-op; the deprecated `archiveProduct(id, auditCtx)` signature is gone.
- The recent-activity entry `product.unarchive` (declared, never emitted) is renamed `product.restore`
  with its bundle key, so the Restore Command's audit rows render a verb.
- Compile-only commit `chore(163): q1 compile-only — drop draft literals` touches admin-kit
  `ProductBrowserDialog.tsx` / `ProductPicker.tsx`, orders `OrderCreatePage.tsx` and catalog
  `ProductEditor.tsx`. **Not touched** (S3, T156v / T156z): `admin/test/kit/{kit-pickers,
  kit-product-browser,kit-product-browser-selectability}.test.ts(x)` and
  `admin/test/modules/catalog/product-scope-controls.test.tsx` still type `draft`, so
  `pnpm --filter admin run typecheck` and those suites are red until Phase 15a.
- `backend/test/unit/packages/module-package-ports-surface.test.ts`'s `'draft'` is a synthetic
  fixture's string, not a product status; left as it is.

### Phase 9b: [backend] Bulk Archive / Restore, consumers, typed consumers, docs, release (FR-053, FR-082, FR-092, FR-112)

**Goal**: bulk Archive / Restore on the existing durable path with undo; no consumer reads `status` as
"archived"; nothing outside the admin screens types `draft`; the operator documentation and the breaking
release notes exist.

- [x] T156k [P] [PG] [S1] RED bulk (FR-053, R30.3): `fields.archived: true` archives every selected product through one `product.archive` audit entry each and `product.updated.v1` + `product.archived.v1` per transition; already-archived products → `succeeded` with `changedFields: []`, no entry, no event; `false` restores; `archived` beside any other field → 400; the queued path above `BULK_ASYNC_THRESHOLD`; undo restores `archivedAt` as a whole with the per-product conflict report and **emits** `product.updated.v1` per reverted product (and `product.archived.v1` where it re-archives); a bulk **status** change leaves `archivedAt` alone and its undo restores status only **and emits `product.updated.v1` `['status']` per reverted product** — the undo emits for every reverted field, not only `archivedAt` (R30.3, accepted 2026-10-25) — `backend/test/contract/catalog/products-bulk-archive.test.ts`; update `integration/commands/bulk-undo.test.ts` and `contract/catalog/products-bulk-update-db-invariants.test.ts`
- [x] T156l [P] [S1] RED consumers: quick-order import rejects `product_archived` for an archived product whatever its status, and not for a non-archived `inactive` one (that one is the port's not-found, P6); shopping-list conversion likewise; reorder drops archived products and keeps a non-archived `inactive` one for placement to refuse (consumers row 20); the import adapter refuses `draft` and `archived` per record with `invalid status` (FR-092) — **this adapter case is written and seen red in Phase 9a, before T156e switches the adapter to `productStatusSchema`** (T156e makes it pass; Principle III) — the module-local tests beside `quick_order/…/import-pipeline.ts`, `shopping_lists/…/shopping-list-service.ts`, `orders/…/order-reorder-service.ts`, `import_export/…/adapters/products.adapter.ts` (create where none exists)
- [x] T156m [S1] Bulk: `catalog-bulk-update.service.ts` applies `fields.archived` through `archiveProduct` / `restoreProduct` (never `updateProduct`); `bulk-operation.service.ts` `revertibleFieldKeys` maps `archived` → `archivedAt` and drops `status` → `archivedAt` (`:675-676`); the undo Command emits per R30.3 after commit
- [x] T156n [S1] Consumers read "archived" from `archivedAt`: `quick_order/src/backend/services/import-pipeline.ts:143`, `shopping_lists/src/backend/services/shopping-list-service.ts:512`, `orders/src/backend/services/order-reorder-service.ts:93` (comments too)
- [x] T156o [S1] Remaining typed consumers outside the admin screens: `catalog/src/backend/prompt-tools.ts:332` description; `catalog-admin-search.service.ts:14` and `admin-search-provider.ts:89` comments; `storefront/lib/api/quick-order.ts:88` (what a type-check refused was already fixed in T156e; the screens are Phase 15a)
- [x] T156p [S1] Docs EN + PL (spec *Compatibility and release* § Documentation): `packages/modules/catalog/docs/catalog.md` — the two status values, "off" at each scope, Archive / Restore single and bulk under `catalog:write`, the 410 rule of FR-005, the operator note that a product archived before this feature (every product `inactive` today) needs an explicit Restore and setting `active` does not restore it, the events table (`:223-254`: `product.archived.v1` from Archive only; reactivation = Restore), the endpoint rows `:32`, `:36` and the admin-search line `:527`; `quick_order/docs/quick_order.md:28` (`product_archived` = archived); no `draft` and no `archived`-as-status left; Polish cache entries and materialised pages in the same commit; `check:docs-translations`, `check:module-docs`
- [x] T156q [S1] Changesets, **breaking at bump level `minor`** (D-225 refuses `major` in `0.x`, R30.6): `.changeset/163-product-status-model.md` for `@endora-commerce/contracts` and `@endora-commerce/mod-catalog` naming each removed symbol with old → new call (`productStatusSchema` narrowed; `coerceProductStatusWrite`, `productStatusWriteSchema` → `productStatusSchema`; `status: 'draft'` → `'inactive'`; archiving by status → `POST …/:id/archive` / bulk `fields.archived`; `counts.draft` → `counts.archived`; `status=archived` → `archived=only`; `product.archived.v1` meaning; new / duplicated products `inactive`; the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` refuses `draft` / `archived`; the migration and its operator note); `patch` notes for `mod-import-export`, `mod-quick-order`, `mod-shopping-lists`, `mod-orders`; `pnpm --filter backend run check:release-intent -- --since origin/master` reports no `major-bump-in-a-zero-series`
- [x] T156r [S1] Self-check: `git grep -n -E "['\"\`]draft['\"\`]" -- packages backend storefront admin` returns no product-status site (quote requests, CMS, blog, newsletter, price books keep theirs); `git grep -n -E "status (===|!==) 'inactive'" -- packages/modules` returns no "archived" reading; `git grep -n -E "coerceProductStatusWrite|productStatusWriteSchema" -- .` returns only CHANGELOGs; record the three results here

**Verification** (one invocation per line):
- `[PG] backend/test/contract/catalog/products-bulk-archive.test.ts`
- `[PG] backend/test/integration/commands/bulk-undo.test.ts`
- `[PG] backend/test/contract/catalog/products-bulk-update-db-invariants.test.ts`
- `[PG] backend/test/contract/catalog/bulk-operation-undo.contract.test.ts`
- `pnpm --filter @endora-commerce/mod-quick-order run test && pnpm --filter @endora-commerce/mod-shopping-lists run test && pnpm --filter @endora-commerce/mod-orders run test && pnpm --filter @endora-commerce/mod-import-export run test`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck && pnpm --filter storefront run typecheck`
- `pnpm --filter backend run check:docs-translations && pnpm --filter backend run check:module-docs`
- `pnpm --filter backend run check:release-intent -- --since origin/master`

> **Review checkpoint Q** — code review + security review in parallel on Phases 9a–9b (focus: no status
> write reaches `archivedAt`; Archive / Restore gated `catalog:write` before any read; the migration's order
> and its `down`; undo emissions; no consumer reading `status` as "archived").

**Phase 9b note** (S1, 2026-10-26):
- *Consumers' tests.* The shopping-list conversion cases extend the existing
  `backend/test/unit/shopping_lists/cross-module-ports.test.ts` (a fast unit file importing the module's
  source) rather than a new module-local file; quick order extends `import-pipeline.test.ts`, orders gets
  `order-reorder-archived.test.ts`, import gets `products.adapter.test.ts`. The [PG]
  `integration/shopping_lists/archived-item.test.ts` now archives through `archivedAt`.
- *Queued bulk Archive audit actor.* The worker runs in a system scope, so a queued bulk Archive / Restore
  records `product.archive` / `product.restore` with a null actor (the Command Bus derives the actor from
  the ambient context and accepts none from a caller); the requester stays on the operation's summary row.
  The inline path records the admin.
- *Undo emissions* go through a new optional `events` dependency of `BulkOperationService`, wired in
  `plugin.ts`; `prompt-tools.ts`' bulk service has no Command Bus and so no undo, and is left as it was.
- **T156r self-check (2026-10-26):** (1) `git grep "'draft'"` — product-status sites left are S3's
  (Phase 15a: admin-kit `ProductBrowserDialog.tsx:84` / `product-browser-api.ts:7`, catalog
  `ProductsBulkEditDialog.tsx`, `ProductsList.tsx`, `resolve-product-selection.ts`, `ProductEditor.tsx:2015`,
  page-builder-admin `CatalogPickers.tsx`, product_feeds `FeedCriteriaPanel.tsx:180`, the admin tests of
  T156v / T156z), S2's `catalog-query.service.ts:1807` comment (9c), the history of
  `20261022T035133` and `core_foundation_init`, the new migration's own conversion and `down`, and the
  refusal tests; everything else is another domain's `draft` (quote requests, CMS, blog, newsletter, price
  books, a feed template draft) or a synthetic fixture (`module-package-ports-surface.test.ts`).
  (2) `status (===|!==) 'inactive'` in `packages/modules` reading "archived": `catalog-query.service.ts:1816`
  (S2, 9c) and the admin screens `ProductEditor.tsx:2169`, blog `RelatedProductsPicker.tsx:103` (S3,
  15a); the rest are other entities' statuses and the admin list counter. (3)
  `coerceProductStatusWrite|productStatusWriteSchema` — only the changeset and the test asserting the
  absence.

- **ci-pg on `50922e6ef` (5 red files of 52), fixed in `ae3ef63df`** (S1, 2026-10-26): (1) a bulk Restore's undo
  restored nothing — `#snapshotProductFields` read the after-state on the em holding the before-state, and MikroORM's
  merge never lets a fresh `null` replace a loaded value, so the revert record's `after` kept the stale `archivedAt`
  and the undo saw every product as changed since; the snapshot now reads with `refresh: true` (product fix);
  (2) `product-archive-restore` and `product-status-drop-draft-migration` read `timestamptz` raw and got strings —
  normalised; the create-without-status case passed `undefined` into a default parameter that turned it into
  `'active'` — it now omits status (the service default `inactive` was right); (3) `admin-product-variants-read`
  (161): the archived fixture is not a member of CH1, so the absent 404 is right under O-3; (4) catalog
  `webhooks`: two cases archived by writing `status: 'inactive'` and waited for `product.archived.v1` forever —
  they archive through the Archive route now.

### Phase 9c: [backend] The product page's "gone" answer (FR-005) — S2, inside Phase 17

**Goal**: 410 for an archived product only, and only where O-3 allows (R30.7). **Assigned to S2 as part of
P17** (coordinator, 2026-10-25): `catalog-query.service.ts` runs in sequence and T110 already edits
`getProductByIdOrSlug`, so the condition changes in the same phase, after T110. T156s–T156t start once 9a is
on S2's base (T156i changes the `PRODUCT_ARCHIVED` message and T156j removes the `draft` case from the same
matrix file); P17's other tasks need not wait for it. **Stream-ownership exception, recorded here**: T156s
extends S1's `scoped-availability-matrix.test.ts` (T031); S2 edits it in its own commit and S1's T146
(Phase 24) rebases over it. Reviewed in checkpoint E.

- [x] T156s [PG] [S2] RED: extend `backend/test/contract/catalog/scoped-availability-matrix.test.ts` — a non-archived member with global `inactive` answers the absent product's 404 at every (C, L), even where a C or C×L override is `active` (FR-005, FR-010); an archived product with global `inactive` and no overrides answers 410 at every (C, L) of its channels (O-3, O-4: today's archived products keep their "gone"); archived with a C×L `inactive` override → 404 there and 410 elsewhere; archived outside its window or audience → 404; the 410 body names `PRODUCT_ARCHIVED` with the new message
- [x] T156t [S2] `getProductByIdOrSlug`: the 410 branch tests `product.archivedAt` only (`:1816`) — never `status` — and answers 410 **only** where the product would be effectively available at (C, L) to this buyer with `archivedAt` taken away and the **global** status read as `active`, every C and C×L status override, membership, the channel's languages, the window and the audience still applying (FR-005, O-3); everywhere else 404 like any unavailable product. Today's check (T036's deviation) covers membership and audience only, so this widens it; the comment is rewritten (no `draft`, no "global `inactive`"), message "Product is archived."; `storefront/test/catalog/pdp-redirect.test.ts:94` string follows — `catalog-query.service.ts`

- S2 (2026-10-26, integration onto S1 `50922e6ef`): **T156t was done in P17** (`31431a03e`, `assertReachable`: the
  410 branch tests `archivedAt` only and answers 410 only where `isAvailableWith` holds with `archivedAt` cleared and
  global status read `active` — every C and C×L status, membership, channel languages, window and audience still
  apply); after the rebase the comment is rewritten without `draft` and the message is "Product is archived."
  (`pdp-redirect.test.ts:94` follows). **T156s** adds three cases to the matrix test: OFF (global `inactive`, not
  archived, with an `active` C1 row and an `active` C2 × pl-PL row) answers the absent 404 at every pair; A answers
  410 `PRODUCT_ARCHIVED` at every pair ("Product is archived." in en-US); AR (archived, organisation-restricted)
  answers the absent 404 anonymously and 410 to its organisation's buyer. Outside the window and a C×L `inactive`
  override are the existing AW/AL case. `url-key-resolution.test.ts` keeps its archived → 410 and non-archived
  `inactive` → 404 cases.

- S1 (2026-10-26, ci-pg on the integrated tip `8404f6b4f`): T156s's first case read "404 at every (C, L), even where a C
  or C×L override is `active`", which contradicts FR-008 / FR-010 (`inactive` is off *there*; a narrower `active`
  override wins, as the shared rule says). The case now expects 200 exactly at the overridden pairs ((C1, *),
  (C2, pl-PL)), the absent 404 elsewhere, no 410 at any pair, and the absent 404 everywhere once the overrides are
  removed (coordinator, option b). Product code unchanged.

**Verification**:
- `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts`
- `[PG] backend/test/integration/catalog/url-key-resolution.test.ts` (S2's T107: archived → 410 still)
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 15a: [admin UI] Status, Archive / Restore and the Archived filter (FR-019, FR-043, FR-053, FR-113) — after Phase 9b, before Phase 15

**Goal**: the screens offer two status values, Archive / Restore single and bulk, and the Archived filter;
no admin surface offers or labels `draft`.

- [x] T156u [P] [US1] [S3] RED catalog screens: the editor's global status selector offers `active` / `inactive` only, a new product starts `inactive`; an archived product shows an "Archived" state with **Restore**, a non-archived one **Archive**, each behind a confirmation that says what it does (Archive: gone from every channel, status kept; Restore: back where its status allows, setting `active` alone does not restore), both hidden for `catalog:read`; the duplicate confirmation no longer says "draft"; the list offers *All · Active · Inactive · Archived* with the counts of R30.4 and sends `archived` instead of `includeArchived=1`; an archived row shows its badge; a saved view holding `status: 'draft'` opens as "All"; the bulk dialog offers **Archive** and **Restore** (confirmation, per-product result, undo link as for other bulk edits) and no `draft` in "Set status"; keyboard reachable and labelled (WCAG 2.2 AA, `ux-laws`) — `admin/test/modules/catalog/product-archive-restore.test.tsx`, `admin/test/modules/catalog/products-list-archived.test.tsx`
- [x] T156v [P] [S3] RED the shared pickers: the admin-kit product browser's tabs and counts follow R30.4 (no `draft`), archived products are not selectable where a browser blocks them; `ProductPicker` labels; `page-builder-admin` catalog picker, blog related-products picker, the orders create page's browser (`blockedStatuses` → `['inactive']` plus archived) and the product-feeds criteria status options carry no `draft` — `admin/test/kit/kit-product-browser.test.tsx`, `admin/test/kit/kit-pickers.test.tsx`, `admin/test/kit/kit-product-browser-selectability.test.ts`, `admin/test/modules/orders/OrderCreatePage.product-browser.test.tsx`
- [x] T156w [S3] Catalog screens — `src/admin/pages/{ProductEditor,ProductsList}.tsx`, `src/admin/components/{ProductsBulkEditDialog,ProductScopeControls}.tsx`, `src/admin/lib/{resolve-product-selection,product-scope-drafts}.ts` (admin-kit primitives only, IX)
- [x] T156x [S3] Shared pickers — `packages/admin-kit/src/components/{product-browser/{types.ts,ProductBrowserDialog.tsx,product-browser-api.ts},product-picker/ProductPicker.tsx}`, `packages/page-builder-admin/src/chrome/CatalogPickers.tsx`, `packages/modules/blog/src/admin/components/RelatedProductsPicker.tsx`, `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx`, `packages/modules/product_feeds/src/admin/components/FeedCriteriaPanel.tsx`; their bundles' `draft` labels removed
- [x] T156y [S3] Handover commit: catalog i18n keys en+pl for Archive / Restore, confirmations, the Archived tab and badge, bulk actions; `open-products` palette keywords gain "archive", "archived", "archiwum", "zarchiwizowane" (R23); changesets for `@endora-commerce/admin-kit` and `@endora-commerce/page-builder-admin`, breaking at `minor` (the product browser's status type and counts narrowed, R30.6)
- [x] T156z [S3] Existing admin tests that assert `draft`: `admin/test/modules/catalog/{product-scope-controls,ProductEditor.attribute-set-swap,ProductEditor.category-tree,ProductEditor.channels-tab,ProductEditor.no-own-price,ProductEditor.publish-window,ProductEditor.sku-status,ProductsList.saved-views}.test.tsx`, `admin/test/modules/webhooks/contributed-event-types.test.tsx` (event label wording only if it changed)

- [x] T156z-sv [S3] **Closed — owner decision P-2 → A (2026-10-26): such a view opens on *All*, as built.** The list
  says so once when the view is applied ("This view used the removed Draft status and now shows all products…",
  `productsList.savedView.draftRemoved`, a `role="status"` note cleared by a tab choice, a navigation or Dismiss),
  pinned in `ProductsList.saved-views.test.tsx`. Original question: Whether a saved view holding
  `status: 'draft'` should open on *Inactive* instead of *All*. Not built: such a view opens as *All* (the planned
  R30.4 fallback, asserted in `ProductsList.saved-views.test.tsx` and `products-list-archived.test.tsx`), and no
  client-side `draft` → `inactive` mapping exists. If the owner chooses the mapping it is one line in
  `savedViewTab` (`ProductsList.tsx`) plus its two test cases.

**Phase 15a note** (S3, 2026-10-26). Decisions taken in the code, for checkpoint Q-UI:
- *Editor.* Archive / Restore is one header button (whichever applies), `default` style rather than danger — it is
  reversible, Save stays the one primary and Delete the one danger. Each opens the kit's `ModalDialog`
  (`aria-describedby` = the sentence saying what it does), posts to its own route and updates the archived state
  in place: unsaved form edits stay in the form and are not sent. An archived product shows an Archived badge
  beside the status pill and a standing `role="status"` warning ("setting Active does not change that — only
  Restore brings it back", O-5); the status selector is also described by that note while archived. Both
  buttons need `catalog:write`; the archived state is shown to `catalog:read`. The create request now carries the
  selected status (it sent none, so the selector was decorative on create). The duplicate confirmation is a
  bundle key ("created as Inactive and not archived").
- *List.* Tabs *All · Active · Inactive · Archived*; the mapping is the pure `productListTabQuery`
  (`lib/resolve-product-selection.ts`): the first three send `status` (or nothing) and rely on the default
  `archived=exclude`, Archived sends `archived=only`; `status=archived` never reaches the wire, and a bookmarked
  `?status=archived` opens the Archived tab. `resolve-ids` always receives `archived` (`exclude` / `only`) because
  its own default is `include` — without it "select all N matching" on All would reach archived products the
  operator cannot see. A saved view stores the Archived tab as `{ archived: 'only' }`, never as a status
  (R30.4 rejects the pseudo-status). Row status labels are bundle keys now (`productsList.status.*`).
- *Bulk.* `fields.archived` must travel alone, so Archive / Restore is not a "touched" field group: it is a
  separate section at the foot of the bulk dialog with its own `ModalDialog` confirmation, disabled (with the
  reason as its description) while any field is touched. The list passes the one action that changes something
  on the tab — Restore on Archived, Archive elsewhere — and none without `catalog:write`. The result names how
  many moved and how many were already in that state (`changedFields: []`, O-6), and every bulk summary now
  links to its operation page ("Review or undo this change"), where the existing Undo lives. The bulk bar itself
  is unchanged (its feature-022 test still holds it to three actions).
- *Shared pickers.* The admin-kit browser mirrors the list: tabs `all/active/inactive/archived`, counts
  `{ all, active, inactive, archived }`, no `includeArchived=1`. `ProductBrowserItem.archivedAt` (optional) and
  `ProductBrowserRules.blockArchived` with reason `archived` — evaluated after the type and before the status,
  so an archived `active` product names the reason that applies; a host that sets it gets no Archived tab
  (Hick). Orders set it (blocked statuses `['inactive']` + archived); quote requests and price lists leave it
  off, matching their rules before 163 (neither refused an archived product then). With host `rules`, the quick search
  (`ProductPicker`) names an archived product beside its status; the no-rules path (`SeoPage`, `RfqDetail`, the
  editor's links picker) keeps its raw status suffix and says nothing about archived. Blog's related-products picker badges inactive and archived
  separately (`productStatus.inactive` added — the key it used, `status.inactive`, was the post status).
  Feed criteria and page-builder's catalog picker lose `draft`.
- *Palette.* `adminActionSchema` caps an action at ten keywords and `open-products` had nine, so the four R23
  words are one entry, `'archived archiwum zarchiwizowane'`; the palette matches a substring of the joined
  keywords, so each of "archive", "archived", "archiwum", "zarchiwizowane" finds the action.
- *Tests outside T156z's list that the model change reached:* `RfqCreatePage.product-browser`,
  `OrderCreatePage.{catalog-permission,minimum}`, `ProductsList.{test,selection,create-affordance-gating}`,
  `ProductsBulkEditDialog{,.returnable}` (now under a router: the summary links to its operation) and
  `admin/test/helpers/price-book-grid.ts`.

**Phase 15a fix round** (S3, 2026-10-26; Q-UI: designer ship-with-fixes, code review approve-with-nits):
- *One modal root (designer W2).* The bulk dialog is now the kit's `ModalDialog` (new optional `widthClassName`
  and `dismissOnScrim` props — admin-kit changeset); the Archive / Restore confirmation is its second step, not
  a dialog over it. Escape on that step returns to the form; a press on the scrim no longer discards touched
  fields. After success focus moves to the outcome's heading (`tabIndex=-1`). A refused request is said once,
  as the step's `role="alert"`. The ghost close button went with the hand-drawn header (N2 is moot): Cancel,
  Close and Escape close the dialog.
- *Operation link (code review W4, W5).* An inline run (≤ the async threshold) persists no operation, so its
  summary no longer links to `/catalog/bulk-operations/:id`; the queued acknowledgement links to its operation
  and, for Archive / Restore, says "Archive queued" / "Restore queued". The archive confirmation no longer
  promises an undo from the operation.
- *List (W3, W4, W6).* The Archived tab's own empty copy shows only with no search, type or stock filter;
  otherwise "try clearing filters". An empty search on any other tab offers "No match here. Search archived
  products", which switches to Archived and keeps the query. An archived row's status pill is a neutral outline
  and Archived is the one coloured pill; on the Archived tab rows carry no Archived pill.
- *Editor.* The O-5 sentence is said once, at the status selector. The notice is its title plus "Only Restore
  brings it back." and carries the Restore button (with `catalog:write`); the header offers Archive only while
  the product is not archived. The status help adds what an Inactive product's page answers (not found)
  against an archived one (gone).
- *One look (N1, N5).* `ProductStatusPill` / `ArchivedPill` (`components/ProductStatusPills.tsx`) are shared by
  the list and the editor; the admin-kit browser draws Archived with the same `b2b-badge--warn` class (6.2:1 in
  both themes — the token is not overridden in dark) and the status as an outline while archived. A drift test
  compares `productListTabQuery` with admin-kit's `buildProductBrowserPath` over the four tabs. Provenance
  prefixes in the 15a comments are trimmed.
- *Palette (W5).* The stems go into the one keyword entry: `'archived archiwum zarchiwizowane restore
  przywróć'`. **Superseded by PAL-1 = B (owner, 2026-10-26)** — the separate "Archived products" action and its
  route `/catalog/products/archived` were built (Phase 9d, T156-pal-a / T156-pal-b), and the list now follows the
  URL on every navigation. ~~**Deferred:** a separate "Archived products" action would change the generated catalog reference
  page and its Polish cache entry and `backend/test/integration/_admin_surfaces/batch-fifteen-palette-off-state`,
  which lists catalog's actions — backend files outside S3 this round; and the list reads `?status=` only on
  mount, so the action would also need the tab to follow the URL.~~
- *Copy.* PL `productsList.bulkEdit.archive.hint` ends "…a po przywróceniu wracają do sprzedaży."
- ~~Not this round (owner): bar-level Restore on the Archived tab (designer W1), saved-view `draft` mapping, RFQ.~~
  All three were decided on 2026-10-26 and built: P-4 = B, P-2 = A, P-3 = A / RFQ-c = B (below).

**Owner decisions applied** (S3, 2026-10-26, after Phase 15):
- *P-4 → B.* On the Archived tab the bulk bar is **Restore** (primary) / Bulk edit / Delete — still three; Edit price
  (a placeholder) is not offered there. Restore opens the bulk dialog on its existing confirmation step
  (`initialStep="confirmArchive"`; that step's Back reads **Cancel** and closes, Escape closes — there is no form
  behind it) and ends on the existing summary. Bulk edit on that tab opens the form without the Restore section (one
  place for it, Hick). Other tabs unchanged; Archive stays in the dialog. Feature 022's bar test gains an Archived-tab
  case with the reason; the 15a case "offers Restore on the Archived tab" now goes through the bar.
- *PAL-1 → B.* Route `/catalog/products/archived` (`catalog:read`, `ProductsList`) in `src/admin/index.ts`. The tab is
  `productListTabFromUrl(pathname, search)`, read at mount **and on every navigation** (`location.key`), so the palette
  action reaching the list while it is open — even at the address it is already on — switches to Archived. A tab click
  does not write the URL (one direction, no loop): after clicking All at `/catalog/products/archived` a reload opens
  Archived again. The palette action itself is the decisions builder's manifest change.
- *P-3 → A.* `RfqCreatePage`: `RFQ_PRODUCT_RULES.blockArchived = true` (no Archived tab, All leaves archived out) and the
  quick search no longer passes `includeArchived`, so it does not find archived products at all. Orders' quick search
  keeps `includeArchived` and shows an archived product refused with its reason; the brief asked RFQ to drop the
  prop, so the two screens differ there (owner question in the report). Inactive products stay selectable for RFQ.
- *RFQ-c = B (owner, 2026-10-26).* The RFQ quick search behaves as the order's: `includeArchived` is back beside
  `blockArchived`, so an archived product is listed, disabled, with the reason "archived". The browser is unchanged and
  already matches orders (no Archived tab, All leaves archived out). Test: `RfqCreatePage.product-browser.test.tsx`.
- *P-2 → A.* See T156z-sv.
- *I1 → B.* Restore shows no gate message (none is built for it).

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-archive-restore.test.tsx test/modules/catalog/products-list-archived.test.tsx`
- `pnpm --filter admin exec vitest run test/kit/kit-product-browser.test.tsx test/kit/kit-pickers.test.tsx test/kit/kit-product-browser-selectability.test.ts test/modules/orders/OrderCreatePage.product-browser.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/catalog`
- `pnpm --filter admin run typecheck && pnpm --filter @endora-commerce/admin-kit run typecheck && pnpm --filter @endora-commerce/page-builder-admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

> **Review checkpoint Q-UI** — code review + **designer UX audit** on Phase 15a (confirmation wording,
> where Archive / Restore sit in the editor and the bulk bar, the Archived tab), plus product-owner check of
> FR-019 / FR-053 / FR-113 in the UI. May run together with checkpoint D.

### Phase 9d: [backend] Owner decisions P-1, P-3 and PAL-1 (2026-10-26) — S2-decisions builder

Three owner answers to questions Block Q left open: the assistant can archive (P-1 = A), quote requests refuse
an archived product while price lists stay as they are (P-3 = A), and "Archived products" is a palette action
of its own on a dedicated route (PAL-1 = B).

- [x] T156p1a [P] [S2] RED assistant Archive / Restore: `catalog.archive_product` / `catalog.restore_product` are
  `catalog:write` mutations with a preview; each product runs `product.archive` / `product.restore` through the
  Command Bus; an already-restored product is a succeeded no-op; an unknown id is a per-item failure; no bus → no
  tools; `set_product_status`' description points at them — `packages/modules/catalog/src/backend/prompt-tools.test.ts`;
  `[PG]` end to end through `/confirm` (actor = the admin, status untouched, search reports `archived`) —
  `backend/test/integration/prompt_actions/archive-restore-flow.test.ts`
- [x] T156p1b [S2] The tools — `packages/modules/catalog/src/backend/prompt-tools.ts` (a bus-backed
  `CatalogAdminService`; ≤ 50 inline, larger = the FR-053 bulk Archive / Restore on the queue),
  `ArchiveProductsParamsSchema` / `RestoreProductsParamsSchema` in `packages/contracts/src/prompt-actions.ts`,
  `commandBus` passed from catalog's boot hook (`index.ts`); `catalog.search_products` now includes archived
  products and returns `archived`
- [x] T156p1c [S2] Docs line — `packages/modules/prompt_actions/PROMPT_TOOLS.md`; changeset
  `.changeset/163-assistant-archive-restore.md`
- [x] T156p3a [P] [S2] RED quote requests refuse an archived product: operator create → 409 `PRODUCT_ARCHIVED`
  before anything is written (P-3b; an absent id stays 404); buyer create outside a request scope → 404 — `packages/modules/quote_requests/src/backend/services/archived-product-lines.test.ts`;
  `[PG]` buyer create / draft edit / resubmit / quick order build / cart conversion (404, byte-equal to an absent
  id where the path is the buyer's create), convert of an approved quote (409), operator create and edit (409 `PRODUCT_ARCHIVED`), operator create with an
  absent id (404) —
  `backend/test/integration/quote_requests/archived-product.test.ts`
- [x] T156p3b [S2] `isNotArchived` applied in `#acquirableProductsById` (before the channel question),
  `seedBasketFromApproved` (convert, `prepare-customer-basket`); `RfqAdminService.createOnBehalf` and `modify`
  through `operatorLineProducts` (404 for an absent id, then 409 `PRODUCT_ARCHIVED`)
- [x] T156p3c [S2] `contracts/consumers.md` row 26 (numbered 25 before the rebase onto MED-1's row 25; and row 20's archived exception); changeset
  `.changeset/163-quote-requests-refuse-archived.md`
- [x] T156-pal-a [S2] Backend half: manifest action `open-archived-products` → `/catalog/products/archived`,
  `catalog:read`, icon `Archive`, weight 210, English keywords plus single Polish words; bundle keys
  `actions.openArchivedProducts.{label,description}` en + pl; generated catalog reference page and its Polish
  cache entry; `batch-fifteen-palette-off-state` (`[PG]`) and `seeded-manifests.unit.test.ts` list it
- [x] T156-pal-b [S3] Admin half: declare `/catalog/products/archived` on `catalog:read` in
  `packages/modules/catalog/src/admin/index.ts` **before** `/catalog/products/:id` (the D-221 move), rendering the
  product list on its Archived tab. Done by S3 (`7bd3bf9b8`, see the PAL-1 → B note).

**Phase 9d note** (2026-10-26):
- *P-1, the bus boundary.* The two new tools run through a dedicated `CatalogAdminService` built with
  `cradle().commandBus`; the four older mutations keep their own audited path (`buildBulkServices`, no bus,
  no undo), as the Phase 9b note left them. A queued (> 50) Archive / Restore is audited with the requester
  (S-W2's `withSystemScopeActingFor`). The plan / confirm step is the confirmation; the preview headline says
  "only Restore brings them back". No bundle strings: tool descriptions and headlines are English by the
  prompt-tool contract (`PROMPT_TOOLS.md`), as for every existing tool.
- *P-1, search.* `catalog.search_products` listed with the admin list's default (`archived: exclude`), so no
  archived product could ever be resolved for `catalog.restore_product`. It now includes them and reports
  `archived`; the other mutations accept an archived product as before (status, visibility and categories do
  not touch `archivedAt`).
- *P-3, the answer.* Buyer paths keep the existing unknown-product answer, `404 PRODUCT_NOT_FOUND`, byte-equal
  to an absent id (no disclosure). **P-3b = A (owner, 2026-10-26):** the operator's create and edit answer
  `409 PRODUCT_ARCHIVED` — catalog's code, so the envelope renders catalog's sentence ("Product is archived." /
  "Produkt jest zarchiwizowany."); no quote_requests bundle entry (`check:error-translations` P2 forbids a
  second home). 409 rather than 410 (catalog's PDP read) or 422: the product exists and the write conflicts
  with its state, which is what quote_requests answers 409 for (`RFQ_NOT_DRAFT`, convert's
  `409 PRODUCT_NOT_FOUND`). An absent id there stays `404 PRODUCT_NOT_FOUND`. The operator's
  `PRODUCT_UNAVAILABLE_IN_SCOPE` warning stays for every other reason (FR-018).
- *P-3, convert (deviation from row 20's "unchanged").* The comment at the convert step already promised a 409
  for "archived between approve and convert", and `findByIds` never saw `archivedAt`; the 2026-08-21 exemption
  is about the channel, and placement would refuse the seeded line anyway. **P-3a = A (owner-confirmed 2026-10-26):** convert refuses with
  the 409 as built; row 20 keeps its archived exception.
- *P-3, outside a request.* `#acquirableProductsById` without a channel applied the audience rule only; the
  archived filter now runs before the branch, so a worker or in-process caller with no request is covered too.
- *PAL-1.* Nothing in the backend checks the SPA route exists: `check:action-route-permissions` reconstructs the
  API path (module-level match on catalog's `catalog:read` product routes), and the off-state file's pairing
  matched `/catalog/products/:id` until S3 declared the static route (T156-pal-b, done).
- *Checks (2026-10-26, after the stop).* `check:port-catches` was red at `prompt-tools.ts:433`: the per-item
  `catch` now opens with `rethrowIfModuleDisabled(err)` (composition checklist item 7), and a unit case pins that
  a `ModuleDisabledError` fails the whole run. The full sweep then reported two more reds in this phase's
  `[PG]` files, both fixed: `check:fixture-substitution` (`?? 0` after `count(*)` → explicit throw) and
  `check:shared-table-wipes` (`archive-restore-flow` no longer wipes `prompt_action_requests`; it reads its
  own requests by id). Green: every backend `check:*` script, `release-intent`, `i18n:hardcoded`,
  `composer:check`, `manifests:check`; typecheck + lint of catalog, quote_requests, backend. Not run on this
  Intel host: `check:naming`, `check:language`, `test:unit:fast` (CI).

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/prompt-tools.test.ts`
- `pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/services/archived-product-lines.test.ts`
- `pnpm --filter backend exec vitest run test/unit/admin_actions/seeded-manifests.unit.test.ts`
- `[PG] backend/test/integration/prompt_actions/archive-restore-flow.test.ts`
- `[PG] backend/test/integration/quote_requests/archived-product.test.ts`
- `[PG] backend/test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`
- `[PG] backend/test/contract/prompt_actions/tool-permissions.test.ts`

---

## Block C — S1 backend: overview, bulk, gate, order rules

### Phase 9: [backend] Scope overview and attribute scope-change preview (US4, FR-015, FR-041, FR-090)

- [x] T067 [P] [US4] [PG] [S1] RED overview: cells name overridden fields and the effective source (cell/channel/language/global); channel rows and language columns; orphans (non-member, language removed, attribute scope narrowed); product in no channel → only global and language scopes (US4 #4); `catalog:read` gets it, writes need `catalog:write` (US4 #3) — `backend/test/contract/catalog/scope-overview.test.ts`
- [x] T068 [P] [PG] [S1] RED FR-090 preview counts orphaned overrides per channel; widening reports 0; the attribute update still retains rows — `backend/test/contract/catalog/attribute-scope-change-preview.test.ts`
- [x] T069 [US4] [S1] `ScopeOverviewService` over scope rows, `product_value_overrides` and URL keys (P16 is merged before Block C — see the chain); leaves `cells[].missing` absent — T080a fills it once `checkCompleteness` exists (Phase 11); media/attachment fields join in T134a–T134b / T139a–T139b and SEO in T118a / T118c (all Phase 21–22, S1) — `services/scope-overview.service.ts`
- [x] T070 [US4] [S1] Route `GET …/products/:id/scope-overview` — `routes.admin.ts`
- [x] T071 [S1] Preview route `GET …/attributes/:idOrKey/scope-change-preview` — `routes.admin.ts`, `attribute-set.service.ts` or a new `attribute-scope-preview.ts`
- [x] T071a [US4] [S1] FR-015 (coordinator, after Phase 9 review): `ProductOverridesService.applyBulk` lets a **delete** skip `channel_not_assigned_to_product`, `language_not_in_channel`, `attribute_not_channel_scoped` and `attribute_unknown`, so every orphan the overview lists can be removed (as `assertScopeValid` lets `null` through); upserts keep every check; the delete stays inside the audited `product.overrides_apply` Command. RED unit test `services/product-overrides.service.test.ts`; [PG] case in `backend/test/contract/catalog/scope-overview.test.ts` deletes one orphan of each kind and asserts the overview no longer lists it. Orphaned C×L URL-key deletes are S2's (`url-key.service.ts`) — `services/product-overrides.service.ts`
- *T072 moved to Phase 18 as T118b — a port must be declared in the phase that provides it, or `check:port-dependencies` reports a port resolved and registered by nobody.*

**Verification**:
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/attribute-scope-change-preview.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

**Phase 9 note** (S1): the pure cores are unit-tested beside their subjects
(`services/scope-overview.service.test.ts`, `services/attribute-scope-preview.test.ts`); the two
[PG] files are written and type-check, unrun locally. Decisions taken in the code, to confirm at
review checkpoint C:
- *Field names* are the owning write's: `status`, `window`, `audience`, `minOrderQuantity`,
  `returnable`, `name`, `description`, `attribute:<key>`, `urlKey` — the `ScopeMissingValue`
  spellings where the two meet. A cell lists each field once, at the level that wins there
  (C×L, then C, then L).
- *Language level* of a per-language baseline (`products.name`, `description`, a language-scoped
  attribute's value) = a value in a language other than the platform default, as the resolver
  reports it; a language URL key is always a language override of `products.slug`.
- *Cells* cover every listed channel (members and channels holding orphaned rows) × the
  languages axis; a cell outside membership or the channel's languages is not available and
  marks nothing. `available` is composed from `isOn`/`effectiveStatus`/`effectiveWindow`/
  `isInsideWindow` and `archivedAt`, never a status value.
- *Orphan reasons* in order: `not_a_member`, `language_not_offered`, `attribute_scope_changed`
  (the last includes an override whose attribute no longer exists).
- *Preview* counts the rows the current flags let the resolver read and the requested ones do
  not, by scope flag only (rows also orphaned by membership are counted); soft-deleted products'
  rows are not. A system or unknown attribute answers `404 NOT_FOUND`; an absent flag keeps the
  current one.
- *ci-pg on 829ce2995* (3 reds, fixed): MikroORM hydrates a NULL `product_url_keys.sales_channel_id`
  as `undefined`, which the overview read as a channel key and listed as an orphan with no
  channel; it now tests `== null` (unit case added). The preview file now seeds the stub
  sessions' admins through the shared `backend/test/helpers/product-scopes-admins.ts`.

### Phase 10: [backend] Bulk scoped status (US5, FR-050–FR-052)

- [x] T073 [P] [US5] [PG] [S1] RED: selection + scope → only that scope's row changes per product; non-member skipped `scope_invalid` (US5 #3); per-product audit with scope (SC-006); undo as a whole with per-product conflict report (US5 #2); queued path above the threshold; 1 000 products undone in one action — `backend/test/contract/catalog/products-bulk-scoped-status.test.ts` *(Q1, 2026-10-25: the value is `active` / `inactive` / `inherit`; `draft` and `archived` are refused by the schema (FR-053, FR-112); the undo restores the scope row only and never `archivedAt`; bulk Archive / Restore is T156k, not this file.)*
- [x] T074 [US5] [S1] `CatalogBulkUpdateService` applies `scopedStatus` through `ProductScopesService` inside the per-product Command; revert records hold the scope row before-state — `services/catalog-bulk-update.service.ts`, `services/bulk-operation.service.ts` *(Q1: revert records never carry `archivedAt` for a status edit — T156m removed that coupling.)*
- [x] T075 [US5] [S1] Route validation: `scopedStatus` with `status` → 400; reasons wired — `routes.admin.ts`
- [x] T076 [S1] `bulk-operation-undo.contract.test.ts` and `products-bulk-update*.test.ts` stay green (no behaviour change for existing fields **except** Q1's: a bulk global status change no longer sets or clears `archivedAt`, and its undo restores status only — those expectations were updated in T156j / T156k)

**Phase 10 note** (S1, 2026-10-26): the pure halves are unit-tested beside their subject
(`services/catalog-bulk-update.service.test.ts`: the request a scope edit becomes, and the outcome each answer
maps to); the [PG] file is written and type-checks, unrun locally. Decisions to confirm at checkpoint C:
- *The write* is `ProductScopesService.writeStatus` — the operator's Command `product.scopes.update` without the
  read-back `apply` does (a full scopes read per product would be wasted on 1 000 products). It inherits the
  `FOR UPDATE` row lock and the `409 VERSION_CONFLICT` on a residual race (binding rule 1); a 409 is reported per
  product as `failed` / `concurrent_modification`. `product.updated.v1` `['scopedStatus']` follows each commit.
- *Order*: the scope is written after `salesChannels`, so a run that also adds the channel writes into it.
- *Undo* (queued path only, as for every bulk field since feature 054 — the inline path ≤ 50 records no revert
  state): the revert record's `scopedStatus` key is the stored status at the edit's one scope (`null` = inherit),
  read from the scope rows (`readScopedStatuses`, fresh) and put back by `restoreScopedStatus` inside the undo
  Command; a channel row left inheriting everything is deleted, a language row takes the channel's spelling.
  `scopedStatus` beside a product-column field (visibility, returnable, …) is supported: the record carries both.
- *T075*: the combination with `status` is refused by the schema's refine on the `scopedStatus` path; the
  envelope is the Zod one (`details: [{ path: ['fields','scopedStatus'], … }]`), as in Phase 9a's note.

**Verification**:
- `[PG] backend/test/contract/catalog/products-bulk-scoped-status.test.ts`
- `[PG] backend/test/contract/catalog/bulk-operation-undo.contract.test.ts`
- `[PG] backend/test/contract/catalog/products-bulk-update.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

### Phase 11: [backend] Completeness gate (US6, FR-060, FR-061)

- [x] T077 [P] [US6] [S1] RED unit: `checkCompleteness` — name counts only at C×L override or baseline `name[L]` (never another language, FR-060 last sentence); required language-scoped attributes likewise; URL key satisfied by the effective key incl. global (K3, US6 #5); `checkCompleteness` answers for a cell whatever its status (the overview calls it for every evaluable cell, FR-041); the gate's entry over `pairsTurningOn` (T080) checks nothing for the M3 → A non-triggers — a window-only change (incl. one opening the window now) and an audience-only change on a product lacking `name[de]` — `packages/modules/catalog/src/backend/services/scope-completeness.test.ts` *(Q1, 2026-10-25: `pairsTurningOn` compares status only — on an archived product a global `inactive` → `active` write returns its pairs, and a change of `archivedAt` alone (Restore) returns none.)*
- [x] T078 [P] [US6] [PG] [S1] RED: setting default `warn` (saved + warnings); `refuse` refuses a single edit as a whole naming every pair (US6 #3, N3) incl. the global switch via `PATCH /products/:id`; bulk skips + reports per product (US6 #4); import and `catalogProductScopeWritePort` never gated (A-6); **M3 → A non-triggers, all in `refuse` on a product active everywhere and lacking `name[de]`, each → saved, no `SCOPE_INCOMPLETE`, no warning**: (a) membership join through `PUT /api/v1/admin/sales-channels/:code/product/:id` (`sales_channels/src/backend/routes.admin.ts:377`) to a channel offering `de`, and through bulk `salesChannels: { mode: 'add' }` without `status`; (b) a channel gains `de` through `PATCH /api/v1/admin/sales-channels/:code` (`routes.admin.ts:196`); (c) a scopes PATCH changing only `window` so that it opens now; (d) a scopes PATCH changing only `audience` (US6 #6); after (a) and (b) `GET …/scope-overview` shows `missing: ['name']` on the (channel, `de`) cell and `[]` on complete cells, and a cell of a non-member channel has no `missing` (FR-041) — `backend/test/contract/catalog/scope-completeness-gate.test.ts` *(Q1, 2026-10-25, also in `refuse` on a product lacking `name[de]`: (e) **Restore** (`POST …/products/:id/restore`, and bulk `fields.archived: false`) → saved, no `SCOPE_INCOMPLETE`, no warning — it is not a status write (FR-019, FR-060); (f) **Archive** likewise; (g) `PATCH …/products/:id` `status: 'active'` on an **archived** product that was `inactive` → refused naming every pair, although the product stays archived — the gate reads status, not availability.)*
- [x] T079 [US6] [S1] Setting `catalog.scope_completeness_gate` in a new `settings` block (seo's shape), labels en+pl — `packages/modules/catalog/src/manifest.ts`, `i18n/{en,pl}.json`
- [x] T080 [US6] [S1] `scope-completeness.ts` + wiring into `ProductScopesService`, the global status path in `catalog-admin.service.ts`, and bulk *(the global status path as T156g left it: no `archivedAt` side effect; `archiveProduct` / `restoreProduct` are not wired to the gate)*
- [x] T080a [US4] [US6] [S1] `ScopeOverviewService` fills `cells[].missing` from `checkCompleteness` for every cell whose channel the product is a member of and whose language the channel offers, whatever its status; absent otherwise (FR-041, `admin-scopes-api.md` §3; T078's overview assertions go green) — `services/scope-overview.service.ts`
- [x] T081 [S1] Regenerate artefacts (manifest change) and commit with Polish module-reference refresh

**Phase 11 note** (S1, 2026-10-26): the pure core is `services/scope-completeness.ts`
(`checkCompleteness`, `completenessFailures` over `pairsTurningOn`, `completenessOutcome`), unit-tested
beside it; the [PG] file is written and type-checks, unrun locally. Decisions to confirm at checkpoint C:
- *Where the gate runs.* `ScopeCompletenessGate` is composed into the operator's services in `plugin.ts`
  only (`CatalogAdminService`, `ProductScopesService`) **and** runs only when the call passes a mode. The
  admin `PATCH /products/:id` (when it carries `status`), the scopes `PATCH` (when it writes a status) and
  the bulk edit (once per run, when it carries `status` or `scopedStatus`) read the mode once and pass it.
  `catalogProductScopeWritePort` and `catalogProductWritePort` are built in `index.ts` without the gate and
  pass no mode, so imports and connectors are never gated (A-6; S2's T120 case 3 is untouched).
- *The API-key upsert* (`PUT /api/v1/catalog/products/by-sku/:sku`) passes no mode: it is an integration
  (PIM) path, exempt under A-6. Owner question below the block report.
- *Shapes.* `PATCH /products/:id` answers `{ data, warnings }` (additive; `warnings` is `[]` unless `warn`
  found something); the scopes `PATCH` merges completeness warnings into its existing `warnings`; bulk in
  `warn` answers `succeeded` with `details.code = 'SCOPE_INCOMPLETE'` (§4), in `refuse` `skipped` /
  `completeness_gate`. The refusal is `422 SCOPE_INCOMPLETE` `details.pairs`, thrown before anything is
  written (scopes: inside the Command after planning; global: before the status is assigned).
- *Values that count.* Name and required language-scoped attributes: the baseline in L itself (language
  key matched case-insensitively), a C × L override, or a channel-only override — an override counts only
  where the attribute's current scope flags let the resolver read it; blank text does not count. URL key:
  `products.slug`, a language key in L, or a C × L key (K3). "Required" = `isRequired` and `languageScoped`
  among the definitions of the product's attribute set.
- *Setting*: a new `catalog` settings group with `catalog.scope_completeness_gate` (`string`,
  `enumOptions: ['warn','refuse']`, default `warn`), read platform-wide (`null` channel). The module
  reference page gained its Settings row (Polish cache re-pinned).

**Verification**:
- `pnpm --filter @endora-commerce/mod-catalog exec vitest run src/backend/services/scope-completeness.test.ts`
- `[PG] backend/test/contract/catalog/scope-completeness-gate.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 12: [backend] ⛔384 Order rules per channel (US10, FR-100)

- [x] T082 [P] [US10] [PG] [S1] RED: MOQ 10 in B2B refuses 5 in B2B basket, accepts 5 in B2C (US10 #1); placement and preview use the order's channel; quote minimums use the RFQ channel; storefront DTO `minOrderQuantity` channel-effective — `backend/test/integration/carts/channel-order-rules.test.ts`
- [x] T083 [P] [US10] [PG] [S1] RED: returnable only in B2C → `returnableAtPurchase` stamped per channel; return offered only on B2C orders (US10 #2) — `backend/test/integration/orders/channel-returnable.test.ts`
- [x] T084 [US10] [S1] Feed `effectiveOrderRules` into `evaluateOrderMinimums` at cart, placement, preview, quick order, quote seams; stamp `returnable_at_purchase` from it — `packages/modules/{carts,orders,quote_requests,quick_order}/src/backend/services/*minimums*.ts`, `order-service.ts:2234`
- [x] T085 [US10] [S1] PDP/listing DTO `minOrderQuantity` channel-effective — `catalog-query.service.ts`
- [x] T086 [S1] Changesets (`patch`) for touched packages

**Phase 12 note** (S1, 2026-10-26): the two [PG] files are written and type-check, unrun locally;
module-local cases cover the pure halves (`contracts` `withChannelOrderRules`, carts' batch on a channel
minimum, quick order's channel minimum). Decisions to confirm at checkpoint C:
- *One overlay, at each seam.* `withChannelOrderRules(records, effectiveOrderRules(ids, channelId))`
  (`@endora-commerce/contracts`) puts the channel's minimum and returnable flag into the records a seam
  feeds to the unchanged `evaluateOrderMinimums`; `CatalogProductRecord` keeps meaning "global" (R26).
- *Seams.* carts: single add and edit (basket channel), batch add (the basket's channel, or the actor's for
  `replaceExisting`), the basket view, submit-for-approval; orders: `availableOnly` (checkout preview and
  placement — so `returnable_at_purchase` is stamped from the order channel's flag through the same
  records) and the admin order preview; quote requests: create and resubmit (the request's channel),
  draft edit and the operator's per-line warning (the stored request's channel); quick order: the buyer's
  import (its channel; the operator's import has no channel yet and keeps the global minimum as a
  warning, the build judges again). The quick-order build reaches the basket batch.
- *T085.* `ListingCardReads.minOrderQuantityByProduct` — read page-wide with the scope rows — gives the
  PDP and listing summaries the request channel's minimum.
- *Returns* needs no change: it reads the stamp. T083 asserts the stamps per channel; the return offer
  follows from them (`returns`' own tests own that reading).
- *TDD order.* The [PG] files were written before the seams; the module-local `withChannelOrderRules`
  and carts batch cases were written alongside the implementation (no workstation run of the [PG] files
  could show red first).

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

**Checkpoint C/E/Q fix round** (S1, 2026-10-26; no BLOCK finding):
- *S-W1* `seo` marks the sitemaps stale on `status`, `archivedAt`, `visibility`, `allowedOrganizationIds` too
  (`services/sitemap-staleness.ts`, one case per field) and on `product.archived.v1`. No global-key write emits
  `slug`/`sku` (the global key changes through `url-key.service.ts`, `['urlKeys']`). **Feeds:** `product_feeds`
  regenerates on its per-feed Job Scheduler and subscribes to no product event, so a published feed keeps a product
  that went off until the next scheduled run — reported, not redesigned.
- *S-W2* new platform `withSystemScopeActingFor(adminUserId, reason, fn)` (`@endora-commerce/platform/tenancy`): the
  bulk worker runs `bulkUpdate` acting for `requestedByAdminUserId`, so queued Archive / Restore and scoped-status
  entries name the requester (supersedes the Phase 9b note on a null actor). [PG] assertions in
  `products-bulk-archive` and `products-bulk-scoped-status`.
- *S-W3* the API-key upsert of an existing product runs `updateProductAudited` (the `product.update` Command) with
  `apiKeyId` in the after-state and no completeness mode; [PG] cases in `product-archive-restore` and
  `scope-completeness-gate` (refuse mode, never gated).
- *I3* a redirect path must be `/p/<segment>[?query]`, else not-found; the 308 is rendered dynamically (cookies) and
  not shared-cacheable. *I4* `productCacheTags` drops the per-key tag over 256 characters. *I5* `ogImageUrlSchema`
  (http(s) or single-`/` relative) on the write; the read shape accepts any stored string. *I7*
  `composeCompletenessGate` warns once when a collaborator is missing. *I8* `effectiveOrderRules` /
  `effectiveKeys` documented as applying no availability (contracts and `contracts/product-scopes.md`).
- *C-W1* Archive / Restore read the product `FOR UPDATE` ([PG] concurrent-Archive case). *C-W2* stale changeset
  sentence removed. *C-W3* `writeChannelScopeRow` / `writeLanguageScopeRow` / `writeScopedStatus` are the one write
  path for the scopes Command, the bulk undo and the CSV import (single transaction and audit row kept). *N1* the PDP
  passes its scope rows and keys to the card and paths reads. *N2* the integration port uses `writeStatus`; `index.ts`
  already holds one `ProductScopesService` and one `UrlKeyService` (the port's), `plugin.ts` the operator's pair with
  the gate. *N3* `sameLanguage` in contracts, used by `scope-completeness`, `url-key-resolution`, `url-key`,
  `product-scopes` and `catalog-bulk-import`. *N4* warn-mode bulk `details` are merged.

> **Review checkpoint C** — code review + security review on Phases 9–12.

---

## Block D — S3 admin UI (US1–US6, US10)

### Phase 13: [admin UI] Scope controls (US1–US3, US10) — after Block A

- [x] T087 [P] [US1] [S3] RED component tests: per channel and channel × language status selector with "use inherited"; source shown (FR-040); window inputs in `datetime-local` converting local ↔ ISO (US2 #4 with a mocked zone); audience override with organization picker and non-member warning (US3 #4); MOQ/returnable per channel; no warning about overrides when the global value changes (FR-013); read-only without `catalog:write` — `admin/test/modules/catalog/product-scope-controls.test.tsx`
- [x] T088 [US1] [S3] API calls for `…/scopes` the way `ProductScopeEditor.tsx` already calls `…/scope-context` and `…/value-overrides` (through the admin-kit API client; a small `src/admin/lib/product-scopes-api.ts` if it grows past two calls) — `packages/modules/catalog/src/admin/lib/product-scopes-api.ts`
- [x] T089 [US1] [S3] Extend `ProductScopeEditor.tsx` with the scope-control section (admin-kit primitives only, IX); global window on the general tab — `src/admin/components/ProductScopeEditor.tsx`, `src/admin/pages/ProductEditor.tsx`
- [x] T090 [US10] [S3] Per-channel MOQ/returnable in `ProductOrderRulesCard.tsx`
- [x] T091 [S3] Every string as a flat key in `catalog/i18n/{en,pl}.json` (handover commit) — `i18n:hardcoded` stays at baseline
- [x] T092 [S3] Palette: `open-products` keywords extended (handover commit to `manifest.ts`) (R23)
  - S3 (2026-10-22), applied by S1: the scope controls are a new `ProductScopeControls.tsx` mounted from
    `ProductScopeEditor.tsx`/`ProductEditor.tsx`; i18n and palette keywords in `chore(163): s3 handover P13`. S1
    added the Block A refusals (409 `VERSION_CONFLICT`, repeated language 422) to the admin error mapping.

**Verification**:
- `pnpm --filter admin exec vitest run test/modules/catalog/product-scope-controls.test.tsx`
- `pnpm --filter admin run typecheck && pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 14: [admin UI] Scope overview (US4) and attribute scope-flag preview (FR-090) — after Phase 9

- [x] T093 [P] [US4] [S3] RED: matrix renders cells/rows/columns per the response; source per cell; a cell's `missing` values listed with their localized names (name, URL key, attribute label) and an accessible "incomplete" marker, nothing rendered when `missing` is absent or `[]` (FR-041; the field is in the P2 schema, so the fixture carries it — the backend fills it in T080a); orphans with a warning and delete; "reset to inherited" calls the owning endpoint with `null` for one field only (US4 #2); read-only for `catalog:read` (US4 #3); no channels → global + language only (US4 #4); keyboard navigation and accessible names (WCAG 2.2 AA, `ux-laws`) — `admin/test/modules/catalog/product-scope-overview.test.tsx`
- [x] T094 [US4] [S3] `ProductScopeOverview.tsx` as a product-editor tab — `src/admin/components/ProductScopeOverview.tsx`, `ProductEditor.tsx`
- [x] T095a [P] [S3] RED (FR-090, analyze H2): the attribute edit form shows `channelScoped` / `languageScoped` for user-defined attributes (system attributes read-only, `getAttributeScope`); saving a **narrowing** first calls `GET …/attributes/:key/scope-change-preview` and shows a confirmation with the orphaned-override count, total and per channel, before the PATCH is sent; cancel sends nothing; a widening saves without the preview; a 0-count narrowing still confirms ("no overrides affected"); read-only without `catalog:write`; accessible dialog (focus trap, labelled) — `admin/test/modules/catalog/AttributesManager.scope-flags.test.tsx`
- [x] T095b [S3] Scope flags + narrowing preview confirmation in the attribute edit form (admin-kit dialog primitives, IX) — `packages/modules/catalog/src/admin/pages/AttributesManager.tsx`
- [x] T095 [S3] i18n keys for T094 and T095b (handover)

**Phase 14 note** (S3, 2026-10-26). Decisions for checkpoint D:
- *Where.* A new **Scopes** tab (`productEditor.tab.scopes`) mounts `ProductScopeOverview.tsx`: one table, channel rows ×
  language columns (`th scope=row/col`, a caption naming it). Each override is shown and reset **where it lives** — a
  channel value in the channel's row header, a language value in the column header, a C × L value in its cell; a cell
  also names the channel/language values that win there, without a second reset (one control per override). The
  reset dispatch is the pure `resetRequestFor` / `orphanDeleteRequest` (`lib/scope-overview.ts`): channel fields →
  `PATCH …/scopes` with `null`; `name`/`description`/`attribute:<key>` → `PATCH …/value-overrides` `deletes`; `urlKey` →
  `PUT …/url-keys` (`channelKeys` or `languageKeys` `key: null`; `409 URL_KEY_TAKEN` names the holder). Resets are not
  confirmed (one value, audited, the inherited value is shown beside it); the table reloads and a mounted
  `role="status"` says "Reset to inherited."
- *No reset for a language baseline.* `name`/`description`/attribute at level `language` is the product's own text in
  that language (edited on Details/Attributes), not an override — **OV-1 = A (owner, 2026-10-26):** confirmed; the
  overview resets only channel and channel × language overrides (spec *Clarifications*, Session 2026-10-26).
- *Missing (FR-041).* Rendered only for a non-empty `missing`: icon + "Incomplete — missing: Name, Material" (attribute
  labels from `GET …/attributes`, key as fallback). Absent and `[]` render nothing.
- *Orphans.* A region below the table with a standing note (role `note`), each with its reason and **Delete**.
- *No channel (US4 #4).* A note and a per-language table only. Read-only (US4 #3): no buttons and a read-only line.
- *Not built:* "jump from a cell to the field" (US4's story text; not in T093) **Deferred (2026-10-27, QA L7):** US4's story text now says what is
  built and spec *Out of Scope* lists the cell-to-field link as a follow-up.
- *Attribute flags (T095a/b).* A **Scope** fieldset in `AttributesManager`'s form; narrowing → preview → `ModalDialog`
  with the total and per channel (channel names best effort from `/admin/sales-channels`, short id otherwise; 0 → "No
  values … are affected"); cancel sends nothing; widening saves at once; built-in attributes fixed and read-only;
  read-only without `catalog:write`. The form is now keyed by attribute: it used to keep the previous form's state.
- ~~**Backend gap (blocks T095b against a real server):** `serializeAdminAttribute` (`routes.admin.ts`) and
  `adminAttributeResponseSchema` (`contracts/catalog.ts`) do not emit `channelScoped` / `languageScoped`.~~ **Closed**
  (checkpoint F): `serializeAdminAttribute` emits both (`packages/modules/catalog/src/backend/routes.admin.ts`,
  `channelScoped: a.channelScoped`, `languageScoped: a.languageScoped`) and `adminAttributeResponseSchema` declares
  them, so the Scope section appears on edit as well as on create.

**Paused here (S3, 2026-10-26, owner pause).** P14 done and pushed. **P15:** T096's RED test
`admin/test/modules/catalog/products-bulk-scoped-status.test.tsx` is written and failing (7 red, as intended) and lives
on `feat/163-product-data-scopes-s3` only — not on the integration branch, so its suite stays green.
`scope-completeness-messages.test.tsx` (T096's second file), T097, T098 and T099 not started. Next: make T096 green in
`ProductsBulkEditDialog.tsx` (a "Status in one channel" field group — channel, optional language fetched per channel
code, Active / Inactive / Use inherited — mutually exclusive with Status; result rows for `scope_invalid`,
`completeness_gate` and warn-mode `details.code = 'SCOPE_INCOMPLETE'`), then T098 in `ProductEditor` (keep the
`PATCH /products/:id` `warnings`; route only `SCOPE_INCOMPLETE` through `scopeSaveErrorMessage`; channel names from
`scope-context`). **P20** done since (see its note under T129); `lib/product-url-keys-api.ts` (GET/PUT/DELETE and the refusal messages) is
already in. Bulk results carry no `pairs`, so a bulk gate message can name the scope but not the missing fields.

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-scope-overview.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/catalog/AttributesManager.scope-flags.test.tsx test/modules/catalog/AttributesManager.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`

### Phase 15: [admin UI] Bulk scoped status and the gate (US5, US6) — after Phases 10–11

- [x] T096 [P] [US5] [S3] RED: bulk dialog offers "Set status in scope" (channel, optional language, value or inherit); result lists skipped products with reason; gate warnings/refusals rendered per pair (US6 #1, #3) — `admin/test/modules/catalog/products-bulk-scoped-status.test.tsx`, `admin/test/modules/catalog/scope-completeness-messages.test.tsx` *(Q1, 2026-10-25: the value choices are `active`, `inactive` and inherit only — no `draft`; Archive / Restore are Phase 15a's, already in the dialog by then.)*
- [x] T097 [US5] [S3] `ProductsBulkEditDialog.tsx` scoped-status action — `src/admin/components/ProductsBulkEditDialog.tsx` *(after Phase 15a, which owns the dialog's Archive / Restore and the global status options)*
- [x] T098 [US6] [S3] Gate messages in scope controls and the global status save — `ProductScopeEditor.tsx`, `ProductEditor.tsx`
- [x] T099 [S3] i18n keys (handover)

**Phase 15 note** (S3, 2026-10-26). Decisions for checkpoint D:
- *Bulk (T097).* A field group **Set status in one channel** below Status — named so, not "Status in one channel",
  so it neither reads as a second Status nor collides with it for a screen reader. A `fieldset` whose legend is
  the group's checkbox, three labelled native selects in dependency order: sales channel (from the list already
  loaded), language (fetched by channel code when a channel is chosen; *All languages of the channel* =
  `languageCode: null`; a failed read leaves the whole-channel choice and says so), and Active / Inactive / Use
  inherited. A standing help line says what Apply will do to products outside the channel and what switching on
  checks, so a gate result is not a surprise. Status and the scoped group exclude each other: the untouched one
  is disabled and described by the reason. Apply without a channel marks the channel `aria-invalid`, announces
  the reason and focuses it; nothing is sent.
- *Result.* The heading names the scope set ("Status in B2C shop · DE applied."). The table lists every row
  not succeeded **and** every succeeded row carrying `details.code = 'SCOPE_INCOMPLETE'` (warn mode), with a count
  line above it; reasons `scope_invalid` / `completeness_gate` and the warn row are bundle keys; the table's
  headings and per-row result were English literals and are bundle keys now. Bulk results carry no `pairs`, so a
  row cannot name the missing values; it points at the product's Scopes tab (the row links to the product).
- *Editor (T098, G-2 → A).* The page Save keeps `PATCH /products/:id`'s `warnings`. Completeness warnings replace
  "Saved." with a warning naming each channel · language and value (`describeIncompletePair`), inside a
  `role="status"` region mounted before it has text. A `422 SCOPE_INCOMPLETE` is the one refusal routed through
  `scopeSaveErrorMessage` (new optional `incompleteKey`), with editor copy that says the **details** were not saved
  and the edits are still in the form — the overrides and gallery flushes run beside that PATCH and may have
  committed. Channel names come from `scope-context`, read only when a gate message needs them (`loadChannelNamer`;
  short id when the read fails). Restore never fires the gate (I1 → B), so it has no gate message.
- *Scope controls.* Already rendered completeness warnings and refusals per pair (Phase 13); the second T096
  file pins the warn and nothing-missing cases there.
- *Test amended:* `product-archive-restore.test.tsx` finds the Status group by its checkbox: "Status" is now also
  the scoped group's value label.
- *Not translated (pre-existing literals, outside this phase):* the editor's own "Save" button and "Saved.".

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

- [x] T100 [P] [US7] [PG] [S2] RED uniqueness, every row of `data-model.md` §5's table incl. US7 #2, #5, #7, #8; global-key writes checked in every language; redirects never chain (US7 #4); self-redirect removed; **H1**: a `NULL`-language redirect of Q requires takeover for an L key in every L, even where Q holds an L key, and the confirmation says it is removed in every language; P writing its own `NULL`-language redirect as an L key keeps the `NULL` row; P writing it back as its global key replaces it with `(L, k)` rows for every L where P holds a language or C×L key; FR-014 on C×L keys; orphaned C×L key keeps reserving; membership/channel-language changes never refuse (SC-008); **HIGH-2 sequence** — P holds a key in L → Q takes P's slug `k` as its L key → P changes its slug: no `(NULL, k)` row; `(L', k) → P` for every other channel language L' where `k` is free; none in L; `k` at (C, L) still resolves to Q (served), `k` at (C, L') redirects to P; P later writing `k` back as its slug while Q holds it in L → `URL_KEY_TAKEN` naming Q; and the sibling: P removing its L key while Q holds `P.slug` in L and some channel offers L → `URL_KEY_TAKEN` naming Q, nothing saved — while removing the same key once it is orphaned (no channel offers L) is allowed (FR-015); with no collision a slug change still writes exactly one `(NULL, old)` row; **two-connection concurrency** — exactly one winner — `backend/test/integration/catalog/url-key-uniqueness.test.ts`
- [x] T101 [P] [US7] [PG] [S2] RED admin API: `GET|PUT …/url-keys`, `DELETE …/url-redirects/:id`; `URL_KEY_TAKEN` names the holder; takeover requires `confirmTakeover` and names the loser; one audit entry whose before/after hold every key and redirect row touched, and re-applying `before` restores them (`URL_KEY_TAKEN` if a key was since taken — R29); `DELETE …/url-redirects/:id` audits the deleted row; `GET` includes `redirects` while `seo` is present; `changedFields: ['urlKeys']` — `backend/test/contract/catalog/url-keys-api.test.ts`
- [x] T102 [S2] Migration `--module catalog --name product_url_keys`; entities `ProductUrlKey`, `ProductUrlRedirect` — `packages/modules/catalog/src/{migrations,backend/entities}/`
- [x] T103 [US7] [S2] `UrlKeyService` (advisory locks in sorted order, the closed check list, redirect bookkeeping, Commands `product.url_keys.update`, `product.url_redirect.delete`) — `services/url-key.service.ts`
- [x] T104 [US7] [S2] `allocateUniqueSlug` widened (A-11) and the product delete Command removes redirects (FR-072) — **handover commit** for `catalog-admin.service.ts`
- [x] T105 [US7] [S2] Routes in `routes.admin.url-keys.ts`; registration line + composition as a handover commit
- [x] T106 [S2] Handover: S1 regenerates artefacts after applying T102
  - S1 (2026-10-22): S2's registry commit was not applied; `composer:generate` re-derived the same two lines,
    `manifests:generate` moved nothing (no lockfile change).
  - S2 (2026-10-22): T100/T101 written, type-checked, **unrun** (no local Postgres) — run in fork `ci-pg`. Pure
    planner rules covered by `packages/modules/catalog/src/backend/services/url-key.service.test.ts` (35, green).
    Shared-file lines (entity registration, plugin/route composition, T104 in `catalog-admin.service.ts`, audit
    labels en/pl, `.changeset/163-catalog-url-keys.md`) are in `chore(163): s2 handover P16`; the regenerated
    `migrations-registry.generated.ts` is a separate S2-only commit. `GET …/url-keys` lists `redirects`
    unconditionally until T110 adds the `seo` presence probe with the T118b edge. A language key for a language no
    channel offers is `422 VALIDATION_FAILED` (`field: 'languageKeys'`): `SCOPE_INVALID`'s details need a channel.
- [x] T106a [S1] Phase 16 review fixes (2026-10-22): a duplicate's slug and SKU are allocated inside the
  `product.duplicate` Command, its candidate URL-key locks taken once in sorted order (`#auditedWrite`'s
  no-bus fallback is now a transaction); a soft-deleted product's slug counts as taken (`409 URL_KEY_TAKEN`,
  never a 500); the PUT's three lists capped at 64; `product_url_keys (product_id)` index; a non-UUID `:id` is
  404; the lock-wait race test fails when no waiter was observed. Owner decision U1 applied with it: the scopes
  answer carries `organizations: [{ id, name }]` (`admin-scopes-api.md` §1) and `ProductScopeControls` reads
  names from it instead of `GET /admin/organizations/:id`. New `[PG]` cases in the two files below and in
  `backend/test/contract/catalog/product-scopes-api.test.ts`; unit cases in `catalog-admin-duplicate.test.ts`.

- [x] T105a [US4] [US7] [S2] Orphaned channel × language keys are deletable (coordinator, 2026-10-25, for S1's
  Phase 9 overview): a `key: null` entry for a channel the product left, or a language its channel dropped, skips the
  membership and language-offered checks and goes through `product.url_keys.update`; the removed key stays a redirect
  in its language (Q3b). A value written to either scope is still `422 SCOPE_INVALID`. `planUrlKeyWrite` already
  behaved so; the three unit cases in `url-key.service.test.ts` and the `[PG]` case at the end of
  `url-key-uniqueness.test.ts` pin it. No code change. (S1's twin for value overrides is T071a.)

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/url-key-uniqueness.test.ts`
- `[PG] backend/test/contract/catalog/url-keys-api.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/module-graph.test.ts`

### Phase 17: [backend + storefront] ⛔384 Key resolution, redirects, alternates (US7, FR-071–FR-074, FR-111) — after Block B

- [x] T107 [P] [US7] [PG] [S2] RED resolution at (C, L): current key serves; other current key of the product in L → redirect to effective key; redirect key → redirect at every (C, L) of its language (US7 #3); key of another language → 404 (K1, US7 #1); unavailable target → 404; archived → 410 where it would be available with the archive taken away, else 404 (FR-005, O-3; asserted in full by T156s); **H1**: a `NULL`-language redirect resolves at every (C, L) — including an L in which its product **gained its first L key after** the redirect was written (seed: slug s0 → s1 writes `(NULL, s0)`, then the first L key; `s0` at (C, L) → 301 to the L key) — and a product's own current L key wins over its own `NULL` redirect with the same key; `GET /api/v1/catalog/products/:idOrSlug` by **global slug** still answers after the product gains an L key (CMS blocks, R28), and never answers a redirect; the resolve answer's target equals `productPath()` — `backend/test/integration/catalog/url-key-resolution.test.ts`
- [x] T108 [P] [US7] [PG] [S2] RED `seo` off: redirects answer 404, rows persist, writes still enforce the invariant (a takeover still requires confirmation naming the loser), `GET …/url-keys` omits `redirects` (Q-C); `seo` on again → served and listed (FR-111) — `backend/test/integration/catalog/url-redirects-seo-off.test.ts`
- [x] T109 [P] [US7] [S2] RED storefront: PDP calls `resolve`, `permanentRedirect` on `kind: 'redirect'` to `productPath()`; canonical + `alternates.languages` use effective keys through `productPath()` (FR-074); no URL is composed outside `productPath()` — the PDP redirects to the resolve answer's `path` and takes canonical/alternates from the PDP response's `paths` verbatim; no product URL is composed in `storefront/app/(catalog)/p/[slug]/{page,seo}.ts*` (asserted by a source grep in the test) — `storefront/test/catalog/pdp-redirect.test.ts`
- [x] T110 [US7] [S2] `UrlKeyResolutionService` + `GET /api/v1/catalog/products/resolve/:key` in `routes.public.url-keys.ts` (resolution order of data-model §5, H1); `getProductByIdOrSlug` accepts an id, a current key at (C, L), else a global slug (R28) — never a redirect; `GET …/url-keys` omits `redirects` unless `effectiveState.isPresent('seo')`; admin `effective[].url`, the resolve answer's `path` and the PDP response's `paths` (canonical + alternates where available to the anonymous audience) all via `productPath()` (contract §4, §6); the additive `paths` field on the PDP shape in `packages/contracts/src/catalog.ts` goes in the phase's handover commit (S1 owns that file) — `services/url-key-resolution.service.ts`, `catalog-query.service.ts` (PDP method only)
- [x] T111 [US7] [S2] `ProductSummary.slug` = effective key at (C, L) on listing and PDP (R28); `catalogProductUrlKeyReadPort` provided
- [x] T112 [US7] [S2] Sitemap: one `<loc>` per live language with effective key, composed by `productPath()` — `seo/src/backend/services/sitemap-generator.service.ts`
- [x] T113 [US7] [S2] Storefront PDP + metadata using the backend's ready `path` / `paths` (the storefront does not know the channel default language, so it never calls `productPath()` itself) — `storefront/app/(catalog)/p/[slug]/page.tsx`, `storefront/lib/api/catalog.ts`. *(Q-B is decided as option C, a separate issue: no cross-language rendering task belongs here; the path prefix later replaces `productPath()`.)*
- **Phase 9c belongs to this phase** (coordinator, 2026-10-25): T156s (RED) then T156t, after T110 and once 9a is on S2's base — see *Phase 9c* under Block Q for the tasks and the ownership exception.

- S2 (2026-10-25): T107/T108 written, type-checked, **unrun** (`[PG]`); T109 green locally (9). A case in
  `contract/seo/sitemap.test.ts` (`[PG]`) and one in `unit/seo/cross-module-ports.test.ts` (green) cover T112.
  `UrlKeyResolutionService` and `catalogProductUrlKeyReadPort` live in `services/url-key-resolution.service.ts`; the
  page's reachability (404/410) is one method, `CatalogQueryService.assertReachable`, asked by both the PDP and the
  resolution, so a key never resolves to a product the page refuses — and a redirect is answered only after it.
  `paths` (shape `productPagePathsSchema` in `product-url-keys.ts`) is required on `ProductDetail`. Effective keys
  are on the listing, PDP, grouped/bundle children and product-link tiles. **Not reached:** the Meilisearch listing
  (`search-query.service.ts` hydrates `slug: product.slug` — S1's module) and every other module's in-page links
  (cart lines, comparisons, shopping lists, quick order) still carry the global key: they redirect while `seo` is on,
  and answer not-found in a language where the product has its own key while `seo` is off. The PDP passes `?lang=` to
  `getServerContext({ langOverride })`; ~~a `lang` cookie still wins over it (existing rule, left alone)~~ —
  **L-1 = A (owner, 2026-10-26):** an explicit `?lang=` naming an active language now beats the `lang` cookie on
  the PDP (the only `langOverride` caller); an invalid or inactive one is ignored and the cookie, `Accept-Language`
  and the channel default decide as before; the cookie is not rewritten
  (`storefront/test/lib/server-context-language.test.ts`). Security
  carry 4: `seo` marks every cached sitemap stale on `product.updated.v1` naming `scopedStatus`,
  `publicationWindow`, `audience` or `urlKeys`. Shared-file lines are in `chore(163): s2 handover P17`.
  **T156s/T156t — done in P17 by S2** (coordinator, 2026-10-25, owner decision Q1): the page's "gone" answer is
  `archivedAt` only (`CatalogQueryService.assertReachable`). A non-archived `inactive` product is the absent
  product's 404; the 410 still goes only to a caller who could see the product were it not archived (global status
  read as `active`). Behaviour-neutral for rows the app writes today (writing `inactive` still sets `archivedAt`).
  `[PG]` case in `url-key-resolution.test.ts`.

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/url-key-resolution.test.ts`
- `[PG] backend/test/integration/catalog/url-redirects-seo-off.test.ts`
- `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts` (Phase 9c, T156s)
- `[PG] backend/test/contract/seo/sitemap.test.ts`
- `pnpm --filter storefront exec vitest run test/catalog/pdp-redirect.test.ts`
- `pnpm --filter storefront run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter backend run check:storefront-indexability`

- [x] T113a [US7] [S1] *(added 2026-10-26, coordinator; owner S1 — the surfaces are S1's consumer seams)* Storefront links on S1-owned surfaces use the **effective** URL key at the request's (channel, language) instead of the global `slug` — with `seo` off a product with its own key in L answers 404 at the global slug there (R28, FR-071). RED first: module-local `search/…/search-hit-channel-values.test.ts`, `carts/…/cart-line-meta.test.ts`, `backend/test/unit/comparisons/cross-module-ports.test.ts`; [PG] `backend/test/integration/catalog/effective-key-links.test.ts`. Surfaces: the Meilisearch hit (`search-query.service.ts`, `catalogProductUrlKeyReadPort`), the basket line and the up-sell strip (`carts` routes / `cart-upsell-service.ts`, same port, `productSlug: null` kept for an unavailable line — S1 decision), the comparison column (`comparison-service.ts`, same port), the quick-order type-ahead (catalog's own `catalog-quick-search.service.ts`, `loadEffectiveKeys` in-module). Shopping lists need no change: the storefront page links through the product detail's `slug`, already the effective key (R28). The search hit and the comparison column also take the channel's `minOrderQuantity` (FR-100, the listing half of T085).

### Phase 18: [backend] ⛔384 SEO writes as Commands, then per channel × language (US8, FR-075, FR-080) — after Phase 17

**Goal**: `seo`'s override writes leave the hand audit for the Command Bus (analyze C1, Constitution XIII)
**before** the channel dimension is added; then C×L resolution and the PDP wiring.

- [x] T114a [P] [US8] [PG] [S2] RED (C1): `PUT /api/v1/admin/seo/meta/:entityType/:entityId` writes exactly one audit row per request with action `seo_meta_override.upsert`, `before` = the full previous row projection on update (**non-null**) and `null` on create, `after` = the full projection; `DELETE` writes one `seo_meta_override.delete` row with the deleted projection as `before`, and **no** row when nothing was deleted; DELETE addressed by (entity, `channelId?`, `locale?`) removes exactly the addressed L / C / C×L row and leaves the other two; neither parameter → today's `locale = 'en-US'`; re-sending `before` restores the row (R29); the write and its audit roll back together on failure — `backend/test/contract/seo/meta-override-commands.test.ts`
- [x] T114 [P] [US8] [PG] [S2] RED schema + resolution: C×L → C → L → derived per field; existing rows are L scope unchanged (US8 #2 as stored data); unique per shape; `channelId` refused for non-product entity types; `channelId` of a non-member channel / unoffered locale → `SCOPE_INVALID` on PUT, allowed on DELETE (FR-014/015) — `backend/test/integration/seo/meta-channel-scope.test.ts`
- [x] T115 [P] [US8] [PG] [S2] RED PDP metadata per (C, L) (US8 #1), including a product whose pre-existing per-language override is now served (Q-A, *Intended behaviour changes* 4), and derived metadata with `seo` off — `backend/test/contract/catalog/product-seo-scoped.test.ts`
- [x] T116 [S2] Migration `--module seo --name meta_override_channel_scope`; entity changes — `packages/modules/seo/src/{migrations,backend/entities/seo-meta-override.entity.ts}`
- [x] T117 [US8] [S2] (C1) Commands `makeUpsertSeoMetaOverrideCommand` / `makeDeleteSeoMetaOverrideCommand` in the `delivery_methods/src/backend/commands/delivery-method.commands.ts` shape (`existingId` pattern, full projection, `skipAudit` on a no-op delete); `MetaTagResolverService` takes `commandBus` (wired in `seo/src/backend/index.ts` the way catalog's `index.ts` hands it to `ProductOverridesService`) instead of `auditLog`, and its `#audit` / `recordAuditFromContext` calls are **deleted in the same commit**; routes accept `channelId` (PUT body, GET/DELETE query) with the addressing rule of `contracts/seo-media-attachments.md` §1 — `packages/modules/seo/src/backend/{commands/seo-meta-override.commands.ts,services/meta-tag-resolver.service.ts,routes.ts,index.ts}`, `packages/contracts/src/seo.ts` (request schemas, additive)
- [x] T117a [US8] [S2] `MetaTagResolverService` scope walk C×L → C → L → derived; `seoProductMetaPort` (`resolveForProduct`, `listScopesForProduct`) provided — `packages/modules/seo/src/backend/{services/meta-tag-resolver.service.ts,index.ts}`
- [x] T118 [US8] [S2] PDP `seo` block through the port behind the `seo` presence probe — `catalog-query.service.ts` (`:1437` block)
- [x] T118b [S2] Declare `seoProductMetaPort` in catalog `nonBindingDependencies` as `degrades-without` with the R12 `whenAbsent` sentence (handover commit to `packages/modules/catalog/src/manifest.ts`) — same phase as the provider (T117a)
- [x] T119 [S2] `seo` docs page + PL mirror (scopes, addressing, audit); `seo` changeset (`patch`)
- *T118a (overview lists SEO scopes) moved to Phase 21 with its implementation T118c: the file is S1's, and S1 runs Phase 21 after this phase is applied — no handover needed.*

- S2 (2026-10-25): T114a/T114/T115 written, type-checked, **unrun** (`[PG]`); the pure walk and the addressing rule
  are unit-tested in `seo/src/backend/services/meta-tag-resolver.test.ts` (green). `MetaTagResolverService` takes
  `commandBus` and the membership port; `#audit` and the `recordAuditFromContext` import are gone. A Command refuses a
  row that appeared (or vanished) since the caller looked (`409 VERSION_CONFLICT`). `seo` raises catalog's
  `SCOPE_INVALID` for a non-member channel / unoffered language on PUT (`check:error-translations` green). `GET` with
  a scope answers the walked `resolved` and the row at exactly that address. The PDP reads metadata through a
  presence-probed closure in catalog's `index.ts` (`catalogSeoProductMeta`, `null` while `seo` is off — no `catch`).
  The `seoMetaWritePort` (PIM importers) still writes language rows only, now through the Command. The migration's
  FK to `sales_channels` needed no new manifest edge (`fk-dependency-drift` green). Shared-file lines (manifest edge,
  `index.ts`, `plugin.ts`, regenerated catalog module reference + PL, changesets) are in
  `chore(163): s2 handover P18`; the regenerated migrations registry is a separate S2-only commit.

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

- [x] T120 [P] [US7] [PG] [S2] RED `catalogProductScopeWritePort.applyScopes`: writes only named scopes, never removes operator overrides (FR-091); a taken key is not written, previous key kept, issue names record/language/holder, no takeover (FR-093, US7 #9); no completeness gate — `backend/test/integration/catalog/scope-write-port.test.ts`
- [x] T121 [P] [PG] [S2] RED CSV: export emits `status@<channel>` / `status@<channel>/<lang>`; import round-trips them (FR-092); whole-file rejection rule unchanged — `backend/test/integration/catalog/bulk-import-scoped-status.test.ts` *(FR-092 after Q1: a `draft` or `archived` status at any scope is refused per record by the run's existing rule — the global column already is, T156l — and status import never archives or restores)*
- [x] T122 [S2] `catalogProductScopeWritePort` provided (status, window, audience, order rules via `ProductScopesService`; keys via `UrlKeyService` in import mode) — `services/catalog-write-ports.ts`
- [x] T123 [S2] CSV columns — `catalog-bulk-import.service.ts`, `packages/modules/import_export/src/backend/services/` adapter *(the adapter's global status column moved to `productStatusSchema` in T156e — rebase onto it)*
- [x] T124 [S2] Connector-author note: which scope each field is read/written at (FR-091) — `packages/modules/catalog/docs/catalog/url-keys-and-redirects.md` § Integrations (+ PL)

- S2 (2026-10-25): T120/T121 written, type-checked, **unrun** (`[PG]`). Local unit cover: `admitImportKeys` in
  `url-key.service.test.ts`, `toScopesPatch` in `catalog-write-ports.test.ts`, the products adapter in
  `import_export/.../adapters/products.adapter.test.ts` (all green). The port is `createCatalogProductScopeWritePort`
  over the operator's `ProductScopesService.apply` (one `product.scopes.update`) and `UrlKeyService.importKeys` (one
  `product.url_keys.update`, `source` in its after-state); a refusal other than a taken key (non-member channel,
  unoffered language) refuses the call. **No gate today; when S1's T080 wires the completeness gate into
  `ProductScopesService`, this port must keep bypassing it (A-6) — T120's third case pins that.** CSV: the
  scoped-status cells are written by `CatalogBulkImportService.importProducts` inside the existing one-Command,
  all-or-nothing run (not through `ProductScopesService`, so the file stays one transaction and one audit row), with
  `product.updated.v1` `['scopedStatus']` per changed product after commit. Values are parsed with the contract's
  `productScopeStatusSchema` — no status literal in the import code. Columns are keyed by channel **code**. The
  export lists every channel in the database (inactive ones too). Shared-file lines (`contracts/catalog.ts`,
  `product-scopes.ts` port marker, `index.ts`, the regenerated sidebar, changesets) are in
  `chore(163): s2 handover P19`. T124 created `url-keys-and-redirects.md` (EN + PL) with an intro and § Integrations;
  T147 (S1) extends it.

**Verification** (one invocation per line):
- `[PG] backend/test/integration/catalog/scope-write-port.test.ts`
- `[PG] backend/test/integration/catalog/bulk-import-scoped-status.test.ts`
- `[PG] backend/test/integration/catalog/bulk-import-command.test.ts` (existing, still green)
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-import-export run typecheck`

> **Review checkpoint E** — code review + security review on Phases 16–19 (focus: advisory-lock ordering,
> takeover authorisation (operator only), redirect open-redirect safety — targets are always the
> platform's own `/p/<key>`, never stored URLs — SEO-off behaviour, and Phase 9c's 410 condition: `archivedAt`
> only, and 410 only where FR-005 / O-3 allows, 404 elsewhere).

---

## Block F — media, attachments, packaging units; URL-key and SEO UI

### Phase 20: [admin UI] URL keys, redirects and per-scope SEO (US7, US8) — after Phases 17–18

**Done (S3, 2026-10-26).** Phase 15, owner decisions P-2, P-3, P-4, PAL-1, RFQ-c and Phase 20 are done — see the
S3 note under T129.

- [x] T125 [P] [US7] [S3] RED: URL-keys panel edits global / per-language / C×L keys with "use inherited"; shows effective URL per (C, L); `URL_KEY_TAKEN` names the holder; takeover confirmation dialog names the losing product and retries with `confirmTakeover`; redirect list with delete when the response carries `redirects`; **with `seo` off (`redirects` absent) no redirect list, no note and no redirect affordance is rendered (Q-C), while the takeover confirmation still appears and names the losing product**; a takeover of a language-less (former global) redirect says the product loses it **in every language**; effective URLs shown as the response's `url` (never composed in the admin) — `admin/test/modules/catalog/product-url-keys-panel.test.tsx`
- [x] T126 [P] [US8] [S3] RED: SEO panel gains a channel selector beside the language one, shows source per field, and "use inherited" deletes exactly the selected scope's row — `admin/test/modules/seo/seo-meta-scope.test.tsx`
- [x] T127 [US7] [S3] `ProductUrlKeysPanel.tsx` in the product editor — `src/admin/components/ProductUrlKeysPanel.tsx`
- [x] T128 [US8] [S3] SEO panel per scope, deleting a scope row by (`channelId?`, `locale?`) — `packages/modules/seo/src/admin/**`
- [x] T129 [S3] i18n keys in `catalog` and `seo` bundles (handover for catalog)

- S3 (2026-10-26): **Phase 20 done.** `ProductUrlKeysPanel` sits at the top of the editor's SEO tab (the old SEO stub
  stays under it); the PUT body is the pure `urlKeysChanges(saved, draft)` in `lib/product-url-keys-api.ts` (trim +
  lower-case, `null` = use inherited, saved entries first); keys are checked against `productSlugSchema` before
  sending; deleting a redirect refreshes the redirect list only, so unsaved key edits survive. The SEO screen's meta
  editor became `seo/src/admin/pages/SeoMetaScopeEditor.tsx`: the channel list is catalog's `scope-context` read over
  HTTP (member channels only, **SEO-1 A**), a channel's languages plus "whole channel", free locale input for the
  language row (legacy `en-US` rows stay reachable), Load as before. **Outside S3 ownership:** "source per field"
  needed the admin GET to say it, so `seo`'s `GET /api/v1/admin/seo/meta/...` answers `data.sources` (additive;
  `MetaTagResolverService.resolveWithSources`, `resolve` delegates) — one commit, `feat(seo): the admin meta read
  names the scope each field comes from`, plus a `[PG]` assertion in
  `backend/test/integration/seo/meta-channel-scope.test.ts` (unrun here). Catalog strings are in
  `chore(163): s3 handover P20`; seo strings (`metaScope.*`) in the seo bundle.
- **SEO stub = A (owner, 2026-10-26).** The editor's "Page title (preview)" stub (an input that saved nothing) is
  replaced by `components/ProductSeoLink.tsx`: below the URL-keys panel, "Edit SEO meta per channel →" links to `/seo`,
  shown only while `seo` is present and the admin holds `catalog:write` (the SEO routes' and `open-seo`'s gate). The SEO
  screen has no per-product address (`SeoPage` keeps the picked product in component state), so the link opens the
  screen and its hint says to pick the product there. A deep link (`/seo?productId=…` read by `SeoPage`) is possible
  but not built. Built by S3 in Phase 23's block; test `admin/test/modules/catalog/product-seo-link.test.tsx`; strings
  in `chore(163): s3 handover P23 (SEO link)` (the stub's two strings removed).

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog/product-url-keys-panel.test.tsx`
- `pnpm --filter admin exec vitest run test/modules/seo/seo-meta-scope.test.tsx`
- `pnpm --filter admin run typecheck`
- `pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`

### Phase 21: [backend + storefront] ⛔384 Gallery per channel and alt per language (US9 a, FR-076, FR-077)

- [x] T130 [P] [US9] [PG] [S1] RED: base-image override for B2B used by B2B PDP, listing card and OG image (US9 #1); hidden image never served in B2B (US9 #2); role uniqueness per channel; Polish-only product alt → English shows the asset's alt (US9 #3) — `backend/test/contract/catalog/media-scopes.test.ts`
- [x] T131 [S1] Migration `--module catalog --name product_media_scopes`; entities — data-model §7
- [x] T132 [US9] [S1] Gallery service + routes (`channel-roles`, item `altText`, `hiddenInChannels`), Command `product.media.update`, `changedFields: ['media']` — `services/gallery.service.ts`, `routes.admin.ts`
- [x] T133 [US9] [S1] Effective gallery in C and alt at L on PDP, listing card (`#listingCardReadsFor`), OG image — `catalog-query.service.ts`, `primary-asset-url.ts`
- [x] T134 [S1] Regenerate artefacts
- [x] T134a [P] [US4] [PG] [S1] RED: extend `backend/test/contract/catalog/scope-overview.test.ts` — gallery role/hidden overrides per channel, per-language alt, and their orphans (FR-041 "every field")
- [x] T134b [US4] [S1] `ScopeOverviewService` lists them — `services/scope-overview.service.ts`
- [x] T118a [P] [US4] [PG] [S1] RED (moved from Phase 18): extend `scope-overview.test.ts` with an SEO override at L, C and C×L, and the `seo`-off case (no SEO cells, no error)
- [x] T118c [US4] [S1] `ScopeOverviewService` lists SEO scopes through `seoProductMetaPort.listScopesForProduct` behind `effectiveState.isPresent('seo')` — `services/scope-overview.service.ts`

**Verification** (one invocation per line):
- `[PG] backend/test/contract/catalog/media-scopes.test.ts`
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/gallery.test.ts`
- `[PG] backend/test/integration/catalog/gallery-batch-read.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

**Phase 21 notes** (S1, 2026-10-26):
- *Write path.* The media overrides are rows of their own tables (data-model §7: role holder keyed by (product,
  channel, role), hidden item by (item, channel)), so they do not go through `writeChannelScopeRow` /
  `writeLanguageScopeRow`, which own `product_channel_scopes` / `product_channel_language_scopes`. Same discipline:
  **one writer per bridge-row kind** — `writeGalleryChannelRole`, `writeGalleryHiddenChannels`
  (`services/gallery-scopes.ts`) — run only on the Command's `em` inside `product.media.update`
  (`objectType: 'product'`, product row locked, `skipAudit` on a no-op, event `product.updated.v1` `['media']`).
- *Routes / shapes (for S3, Phase 23).* `GET|PUT …/products/:productId/gallery/channel-roles` — read
  `{ data: Array<{ channelId, roles: { baseImage, smallImage, thumbnail: itemId | null } }> }` (only channels with an
  override); write `{ channelId, roles: { <role>?: itemId | null } }` (`null` = use inherited, absent = untouched).
  The role keys are camelCase (`baseImage` = the `base_image` label, `smallImage` = `small_image`) since the CI fix
  round on ec1efd0a3 (`check:naming`); the gallery item's `labels` keep the stored spelling.
  `PATCH …/gallery/:itemId` takes `altText` (language → text, `''` removes, unnamed languages untouched) and
  `hiddenInChannels` (replaces the set); a body with either runs as `product.media.update`, otherwise the old
  `gallery_item.update`. The admin `GalleryItem` DTO carries `altText` and `hiddenInChannels`. `422 SCOPE_INVALID
  not_a_member` for a new hidden channel / a role set in a non-member channel; clearing is always allowed.
  The route-level `gallery.update` audit row is dropped (FR-080: one entry per request). Audit label
  `auditLog.product.media.update` (EN/PL) added.
- *Audit restore.* The `before` / `after` projections name every language either side names (`''` where absent), so
  re-sending `before` (minus `itemId`) through the PATCH restores the item (FR-081).
- *Reads.* `resolvePrimaryAssetUrls` takes the channel (listing card, related products, grouped / bundle children),
  runs the chain over `effectiveGallery` and skips a legacy `product_assets` row naming a hidden image's asset; the
  PDP's `gallery[].labels` are the channel-effective ones, hidden items are dropped (also from `assets`), the OG
  image follows them, and `gallery[].altText` (new, optional in the contract) is `translationAt(item.altText, L)`
  ?? the asset's alt pick. Storefront `GallerySwitcher` uses each item's `altText`, else the product name.
- *Contracts.* `sameLanguage` moved to `scoped-translations.ts` (re-exported unchanged from `product-scopes.ts`) so
  `catalog.ts` can use the translation helpers without importing `product-scopes.ts`. Added `translationAt`,
  `applyTranslationPatch`, `translationMapPatchSchema`, `effectivePackagingUnitName` (used in Phase 22).
- *Overview (T134b, T118c).* `buildScopeOverview` takes `scopedFields` routed by shape (channel / language / both):
  `media:roles`, `media:hidden` (channel), `media:altText` (language), `seo:<field>` (L, C, C×L); non-member and
  not-offered ones are orphans. SEO comes through `catalogSeoProductScopes`, probed with
  `effectiveState.isPresent('seo')` before resolving the port, no catch (seo off → no SEO field, no error). **S3:
  the Phase 14 field-label map needs these field names.**
- *Sitemap stale set.* Not extended: the sitemap emits no image entries, so `media` changes no sitemap content.
- *Not covered (owner question).* `GalleryService.listForProducts` (product feeds) and `baseImageUrls`
  (comparisons) take no channel, so a hidden image can still reach a feed or a comparison column. T133 names
  PDP / card / OG only. Option: both port methods gain `channelId`. Not built. *(Owner decision MED-1 = A, 2026-10-26: built in Phase 22's block — see the Phase 22 notes.)*
- `gallery-batch-read.test.ts`: `list` now costs four round-trips per product (the hidden set), 2000 for 500.

**Done (2026-10-26; was "Stopped here", owner pause).** Phase 21 is complete, docs included (T147 / T148). Phase 22
was built after the pause, the RFQ half of T138 included — see the Phase 22 notes. Kept as history: at the pause
Phase 22 (T135–T139b) had not started, and the plan then was: T135 RED tests, T136 migration
`attachment_packaging_translations`, T137 services/routes (drop the route-level `auditEmit` beside the Commands
for the touched attachment and packaging routes, FR-080), T138 snapshots via `effectivePackagingUnitName` at
`basketScopeLanguage` / `raisedInScopeLanguage` (keep `resolveLinePackaging`'s name match on the global `name`),
T139 regen + changesets, T139a/b overview fields `attachments:hidden`, `attachments:name`,
`attachments:description`, `packagingUnits:name` through `scopedFields`.

**Carry-over notes (2026-10-26).**
- **T156-pal — answered 2026-10-26: PAL-1 = B** (see Phase 9d, T156-pal-a / T156-pal-b). Was: blocked, owner question. A separate "Archived products" palette action with `targetRoute:
  /catalog/products?status=archived` cannot be declared: `ModuleActionSchema.targetRoute` is
  `/^\/[A-Za-z0-9/_-]*$/` and `admin-contributions.ts` states "No query string" as a design rule. Options:
  (A) allow a query string in `targetRoute` (contracts change; strip it in the `action-route-permissions` rule and in
  `batch-fifteen-palette-off-state`'s `routeAnswers`; AppShell already navigates `to: targetRoute`);
  (B) S3 declares an SPA route `/catalog/products/archived` and the action targets it (no schema change);
  (C) keep the keyword entry on `open-products`. Either A or B also needs the list to follow `?status=` / the route
  after mount (S3). Recommendation: B.
- **Feeds staleness — report only.** `product_feeds` regenerates on its schedule only and subscribes to no product
  event, so a scope / media / status change reaches a feed at its next scheduled run. Nothing built; owner deciding.

### Phase 22: [backend + storefront] Attachments and packaging units (US9 b, FR-078, FR-079)

- [x] T135 [P] [US9] [PG] [S1] RED: attachment hidden in B2C neither listed nor referenced from the B2C PDP (US9 #4); names/descriptions per language with global fallback; packaging-unit names per language on PDP, basket and order line; placed line keeps its name after a rename (US9 #5) — `backend/test/contract/catalog/attachment-packaging-translations.test.ts`, `backend/test/integration/carts/packaging-unit-name-snapshot.test.ts`
- [x] T136 [S1] Migration `--module catalog --name attachment_packaging_translations`; entities — data-model §8
- [x] T137 [US9] [S1] Attachment + packaging services/routes accept translations and `hiddenInChannels` (admin packaging schemas stay `.strict()` with the key added). Writes ride the **existing** Commands — `product_attachment.update` (`objectType: 'product_attachment'`) and `packaging_unit.update` (`objectType: 'packaging_unit'`) — one audit entry per request, i.e. one per product (FR-080); their `before`/`after` projections gain `productId`, the translations and `hiddenInChannels`; events `changedFields: ['attachments']` / `['packagingUnits']` — `services/{attachment,packaging-unit}.service.ts`, `packages/contracts/src/catalog.ts`
- [x] T138 [US9] [S1] PDP DTO and basket/RFQ snapshot take the effective name at the scope language — `catalog-query.service.ts`, `cart-service.ts`, `rfq-service.ts` *(PDP and basket 2026-10-26; RFQ 2026-10-26, second pass — see the Phase 22 notes)*
- [x] T139 [S1] Regenerate artefacts; changesets
- [x] T139a [P] [US4] [PG] [S1] RED: extend `backend/test/contract/catalog/scope-overview.test.ts` — attachment translations / hidden per channel and packaging-unit name translations
- [x] T139b [US4] [S1] `ScopeOverviewService` lists them — `services/scope-overview.service.ts`

**Verification** (one invocation per line):
- `[PG] backend/test/contract/catalog/attachment-packaging-translations.test.ts` (asserts the audit projections of T137)
- `[PG] backend/test/integration/carts/packaging-unit-name-snapshot.test.ts`
- `[PG] backend/test/contract/catalog/scope-overview.test.ts`
- `[PG] backend/test/contract/catalog/packaging-units.contract.test.ts`
- `[PG] backend/test/contract/catalog/attachments.test.ts`
- `[PG] backend/test/integration/quote_requests/effective-names.test.ts` (T138 RFQ case)
- `pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/services/packaging-resolution.test.ts`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`

**Phase 22 notes** (S1, 2026-10-26):
- *Verification run.* No Postgres on the builder: the `[PG]` files above were written, not run —
  `attachment-packaging-translations.test.ts` (new), `packaging-unit-name-snapshot.test.ts` (new), the T139a case in
  `scope-overview.test.ts`, and `packaging-unit-minimum.test.ts` (comment only: the route-level row is gone). The
  no-PG halves ran green: `attachment-packaging-scopes.test.ts`, `scope-overview.service.test.ts`,
  `cart-batch-add.test.ts` (three snapshot cases, the request channel mocked), `catalog-attachment-packaging-shapes.test.ts`.
- *Write path.* Translations are columns of the rows themselves (`name_translations`, `description_translations`); the
  one bridge row is `product_attachment_channel_hidden`, with its single writer `writeAttachmentHiddenChannels`
  (`services/attachment-packaging-scopes.ts`), run only on the Command's `em`. The existing Commands carry the writes:
  `product_attachment.create|update` (`objectType: 'product_attachment'`, the attachment row locked on update) and
  `packaging_unit.create|update` (`objectType: 'packaging_unit'`). Projections: attachment — `productId`,
  `attachmentTypeId`, `name`, `description`, `position`, both maps, `hiddenInChannels`; unit — `productId`, `name`,
  `nameTranslations`, `baseQuantity`, `isDefault`, `minOrderUnits`. Both maps name every language either side names
  (`''` where absent), so `before` minus `productId`, re-sent, restores the row (FR-081). A no-op is `skipAudit` and
  emits nothing. Events `product.updated.v1` `['attachments']` / `['packagingUnits']` on create and update (delete
  and reorder untouched). The route-level `auditEmit` rows on attachment create/update and packaging create/update
  are dropped (FR-080). EN/PL labels `auditLog.product_attachment.create|update`,
  `auditLog.packaging_unit.create|update` added (the Command rows had none).
- *Membership guard.* `assertProductChannelMembers` (same file) is the FR-014 check for a **newly** hidden channel;
  `GalleryService#assertMembers` now delegates to it. `AttachmentService` takes the membership port (wired in
  `index.ts` and `plugin.ts`).
- *Reads.* PDP: an attachment hidden in the request's channel is dropped before its asset is read; name/description
  `translationAt(…, L) ?? global`; `packagingUnits[].name` = `effectivePackagingUnitName(unit, L)`. Only an available
  product reaches this code (row 3 of `consumers.md`), so nothing here widens availability.
- *T138 — basket done, RFQ not.* `CartService#resolveLine` computes L once (`basketScopeLanguage`, `null` for an
  operator naming the channel) and the line stores `effectivePackagingUnitName(unit, L)`; the order line copies the
  basket's snapshot (`order-service.ts`), so it keeps the name. The operator path (`input.salesChannelId`) has no
  request language here and stores the **global** name, not the channel default N2 names — recorded, not changed.
  **The RFQ half is not built**: `packages/modules/quote_requests/**` belongs to another builder in this block.
  Recipe for whoever owns it next: `PackagingUnitCandidate` gains `nameTranslations?`; `fromUnit` stores
  `effectivePackagingUnitName(unit, raisedInScopeLanguage(language, channelId))` (operator: `null` → global, as the
  basket); the **name match** in `resolveLinePackaging` stays on `unit.name` (owner decision 2026-10-26).
  `CatalogPackagingUnitRecord.nameTranslations` is already populated by `listPackagingUnitsByProductIds`.
- *Overview (T139b).* `loadAttachmentPackagingScopedFields` (one statement) feeds `attachments:hidden` (channel),
  `attachments:name`, `attachments:description`, `packagingUnits:name` (language). **S3: the Phase 14 field-label map
  needs these four names.**
- *Owner decision MED-1 = A (built).* `CatalogGalleryPort.listForProducts(ids, channelId)` drops items hidden in the
  feed's channel; `baseImageUrls(ids, channelId)` answers the channel holder of `base_image`, else the global one,
  `null` when that holder is hidden there — one statement each, as before. Callers: `feed-generation.service.ts`
  (the feed's channel), `comparison-service.ts` (`viewerSalesChannelId`). `consumers.md` row 25. `[PG]` channel
  case added to `backend/test/integration/catalog/gallery-batch-read.test.ts`.
- *Also in this block.* `serializeAdminAttribute` returns `channelScoped` / `languageScoped` and
  `adminAttributeResponseSchema` declares them (S3's T095b gap) — `[PG]`
  `backend/test/contract/catalog/attribute-scope-flags-response.test.ts`. The `withOrgScope` doc comment moved off
  `withSystemScopeActingFor` in `escape-hatch.ts`.
- *Docs.* P21's gallery page (EN + PL, cache re-pinned) is written under T147/T148; the attachments and
  packaging-unit pages for P22 were written in the second pass (EN + PL, re-pinned), with the rest of T147/T148.
- *T138 — RFQ half (S1, second pass).* `resolveLinePackaging(lines, units, scopeLanguage?)` stores
  `effectivePackagingUnitName(unit, scopeLanguage)`; `PackagingUnitCandidate.nameTranslations?` (the catalogue record
  already carries it). `RfqService#resolvePackaging` takes the channel `lineNames` is asked at — `raisedOnChannelId()`
  (hoisted) on create, `rfq.salesChannelId` on the draft edit — and passes `raisedInScopeLanguage(language, channel)`,
  `null` without a channel; so the unit name and the product name it is appended to share one scope language. The name
  match stays on `unit.name`; draft-edit pairing is by unit id first (pass 2a), so a translated snapshot does not
  unpair a stored line. Operator paths resolve no packaging (create-on-behalf has none; `modify` copies the stored
  row), so nothing changes there. Red seen: two of the four new cases in `packaging-resolution.test.ts` failed before
  the change (the other two pin behaviour that must not move). `[PG]` case added to
  `backend/test/integration/quote_requests/effective-names.test.ts`, unrun. Changeset: `mod-quote-requests` added to
  `163-catalog-attachments-packaging-per-scope.md`.
- *N2 for the unit name — **decided B and built** (owner, 2026-10-26; checkpoint F fix round): an operator naming
  the channel snapshots the unit name at that channel's default language (`CartService#channelDefaultLanguage`,
  `salesChannelResolutionPort.getById`, read only when a unit is named). The quote-seeded basket copies the quote
  line's stored name and does not re-resolve. Unit: `cart-batch-add.test.ts` (N2 block); [PG]:
  `backend/test/integration/carts/packaging-unit-name-snapshot.test.ts` (last case). The note below is history.*
  ~~N2 for the unit name — left open, owner's call.~~ An operator naming the channel (basket `input.salesChannelId`)
  snapshots the **global** unit name, while the product name beside it is at the channel's default language (N2).
  Not changed: the Phase 22 recipe and the cart comment both write "operator: `null` → global" under the 2026-10-26
  decision, and the fix needs the channel's `defaultLanguage`, which `CartService` does not read today. Size if the
  owner wants it: one channel-default read (the `SalesChannel` row, read only when a unit is named) and one call
  site in `cart-service.ts` `#resolveLine`; the RFQ has no operator path that resolves a unit today.
- *Shapes for S3 (Phase 23).* Attachment admin DTO: `nameTranslations`, `descriptionTranslations`
  (`Record<lang, string>`), `hiddenInChannels: uuid[]` (sorted). `POST|PATCH …/attachments[/:id]` accept the same three
  (maps are patches: `''` removes a language, unnamed untouched; name ≤ 160, description ≤ 4000; `hiddenInChannels`
  replaces the set; `422 SCOPE_INVALID not_a_member` for a newly hidden non-member channel). Packaging-unit admin DTO:
  `nameTranslations`; `POST|PATCH …/packaging-units[/:id]` accept `nameTranslations` (strict schemas, ≤ 160).

**Done (2026-10-26; was "Stopped here", session end).** Phase 22 built and committed (T135–T137, T139–T139b; T138 PDP and
basket half), MED-1 = A built, attribute scope flags in the admin response, `withOrgScope` comment moved, the P21
gallery page EN/PL written. Verified: contracts, platform, catalog, carts typecheck + lint; product_feeds typecheck;
catalog/carts/product_feeds/comparisons/platform unit suites; check:naming (Docker), check:language,
default-language-prose, platform-surface, docs-translations, module-docs, i18n:hardcoded. Typecheck + lint
also green for product_feeds, comparisons, backend, storefront, admin. **Not run** at that point: the `[PG]` files. What was then next — the RFQ half of T138 and the P22 docs (T147/T148) —
was done in the second pass of 2026-10-26, and N2 for the basket unit name was decided B and built in the
checkpoint F fix round (see the Phase 22 notes).
`contracts` `crm-rich-text.test.ts` "reads quickly" failed at 747 ms / 500 ms under host load 828 — untouched file.

### Phase 23: [admin UI] Media, attachments, packaging per scope (US9) — after Phases 21–22

- [x] T140 [P] [US9] [S3] RED: gallery panel per-channel roles and hide toggles; per-language alt; attachment translations + hide per channel; packaging-unit name translations — `admin/test/modules/catalog/product-media-scopes.test.tsx`, `admin/test/modules/catalog/PackagingUnitsEditor.translations.test.tsx`
- [x] T141 [US9] [S3] Gallery / attachments UI in the product editor — `src/admin/components/` (gallery and attachment sections of `ProductEditor.tsx`)
- [x] T142 [US9] [S3] `PackagingUnitsEditor.tsx` translations
- [x] T143 [S3] i18n keys (handover)

- S3 (2026-10-26): **Phase 23 done.** Both sections moved out of `ProductEditor.tsx` first (pure move) into
  `components/ProductGallerySection.tsx` / `ProductAttachmentsSection.tsx`. **Both now list the admin reads**
  (`GET …/gallery`, `…/attachments`): the public PDP they used is channel-resolved since P21/P22, so an item hidden in
  the admin request's channel vanished and the gallery's channel-effective `labels` became the baseline the page Save
  wrote back with `replace=true`. The PDP is only a best-effort URL lookup now — an image or attachment hidden in that
  channel has no preview / file link in the admin (no batch admin asset read in the stack; noted, not built).
  Gallery: a **Channel** selector over the member channels (`scope-context`) shows that channel's role holders
  (`Use inherited (Image N)` names the global holder; an image hidden there is not offered) and a hide checkbox per
  image; an **Alt text language** selector edits alt text per language (member languages ∪ languages already named).
  All staged, written by the page Save (`flushGallery`): labels PATCH as before, one `PATCH …/gallery/:id` per item
  with the alt-text patch and/or the whole hidden set (a channel the product has left is carried over), the order PUT,
  one `PUT …/gallery/channel-roles` per changed channel with the changed roles only. Attachments: a per-row
  "Translations and channels" dialog (`AttachmentScopesDialog.tsx`), one PATCH of what changed; rows show where they
  are hidden. Packaging units: a per-row "Names per language" dialog, one PATCH with the changed languages. Pure
  helpers in `lib/media-scopes.ts`. Scope overview: labels for `media:*`, `attachments:*`, `packagingUnits:name`,
  `seo:<field>`; `media:roles` resets / deletes its orphan through the channel-roles PUT, the item-level fields have
  no reset there (the overview names no item). Gallery and attachment scope controls are disabled without
  `catalog:write`; `PackagingUnitsEditor` keeps its existing ungated behaviour (it has no session in its callers'
  tests). Strings in `chore(163): s3 handover P23`. No changeset: the phase asks for none, and `.changeset/` is S1's
  (Phase 24 writes them).

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

- [x] T144 [P] [PG] [S1] RED deploy parity (FR-110, SC-001): on a seeded pre-feature dataset, listed / searchable / reachable-by-URL / sitemap / feed sets per channel × language are identical before and after the migrations, except the *Intended behaviour changes* of `plan.md` (products off and not archived — today's `draft`, `inactive` after the Q1 migration — not reachable by URL and not addable to a basket; name sort by effective name; existing per-language SEO overrides served — R21, D2, D6, Q-A) — `backend/test/integration/catalog/deploy-parity.test.ts` **Q1 additions (SC-009, FR-110, O-4)**: the seeded dataset includes `draft` products and scope rows and `inactive` products with and without `archived_at`; after the migrations no stored status other than `active` / `inactive`, no formerly `inactive` product without `archived_at`, and every formerly `inactive` product answers 410 exactly where it answered 410 before (T156b covers the migration itself)
- [x] T145 [P] [PG] [S1] SC-007 sweep: every FR-004 consumer (every row of `contracts/consumers.md`, CMS product blocks included) refuses a product off at (C, L) — one table-driven test reusing each seam's fixture — `backend/test/contract/catalog/scoped-availability-all-consumers.test.ts`
- [x] T146 [P] [PG] [S1] Test: `search` off → the Postgres listing applies the same predicate — add the search-backend-off case to `backend/test/contract/catalog/scoped-availability-matrix.test.ts` (`seo` off is already covered by T108/T115). Run it before T146a
- [x] T146a [S1] Make T146 pass if it is red (the degrade path's narrowing goes in the statement, issue #151); if green, record "no change" here
- [x] T147 [S1] Docs (EN): extend `packages/modules/catalog/docs/catalog/per-channel-per-language-overrides.md` (scopes, inheritance, status semantics, window, audience, overview, bulk, gate, order rules); new `url-keys-and-redirects.md`; `seo` and `search` pages updated *(Q1: status semantics = two values, `inactive` is plain off at every scope, archiving is the Archive / Restore action documented in `catalog.md` by T156p — link to it, do not restate)*
- [x] T148 [S1] Docs (PL): translation cache entries and materialised pages for every page above; `pnpm --filter backend run check:docs-translations`; `pnpm --filter backend run check:module-docs`
- [x] T149 [S1] Changesets: one per meaning for every published package touched (`contracts` minor; modules patch/minor as their exports changed; the Q1 status change is breaking and is written at `minor` with a breaking body — T156q, T156y, D-225 refuses `major` in `0.x`); `pnpm changeset:status`
- [x] T150 [S1] AGENTS.md traps: grep `backend/test/**` for every file path renamed or deleted in this feature; re-derive anything derived from moved files (e.g. `module-removal.test.ts` ledger); re-record a read size **only** if the band refuses it, after reading `specs/conventions/check-estate.md`

- S1 (2026-10-26, T147/T148): written from the `.changeset/163-*` bodies, not from memory. Overrides page: new
  *Availability per sales channel and language* (the availability rule, scopes and inheritance table, window,
  audience, the scopes route and its Command, scope overview and the scope-change preview, storage); status
  semantics, bulk, gate and order rules **link** to `catalog.md` (T156p's sections) instead of restating them; the
  stale "listing filters and name sorting read the baseline" claims are corrected (Postgres path follows the
  effective values; the search index sorts by the channel-default name). `url-keys-and-redirects.md`: *Managing
  keys*, *On the storefront*, *Errors* added before T124's *Integrations*. `seo.md`: the sitemap's anonymous-only
  list now states effective availability per channel and language (the meta scopes and per-key sitemap URLs were
  already documented). `search.md`: already carried *Availability per channel and language* — no change. Attachments
  and packaging units: see the Phase 22 notes. PL: cache entries re-pinned and materialised pages for all five
  pages; Polish anchors (`#status-produktu-i-archiwizacja`, `#integracje`, …) in the PL links. Checks:
  `check:docs-translations` 0 findings, `check:module-docs` 0 findings, `check:default-language-prose` 0
  violations, `pnpm --filter docs run build` green for `en` and `pl` (run after the overrides page; the later
  url-keys and seo edits add no links).

- S1 (2026-10-26, Phase 24 — T144, T145, T146/T146a, T149, T150; the three test files are [PG] and **unrun
  locally**, no Postgres on the workstation: written against the existing fixtures, `tsc -p test/tsconfig.json`
  and eslint clean, red state not observed — the coordinator runs them on ci-pg).
  - *T144* `integration/catalog/deploy-parity.test.ts`. Part A runs the Q1 migration's own `down`, seeds a
    pre-feature dataset (`active` / `draft` / `inactive` with and without `archived_at`, three audiences,
    members and non-members), runs `up` in one rolled-back transaction, and holds the pre-feature predicates —
    restated over the rows as stored before `up` — against the shipped `ProductAvailabilityService`: listed
    per channel × language × buyer, searchable (the documents' projection), the product page's 200/404/410,
    and SC-009 (only `active` / `inactive` stored, every formerly `inactive` product archived, `draft` →
    `inactive` not archived). Part B reads the HTTP surfaces on `pl_retail` over a dataset in the shape the
    migrations leave: listing per channel language, `sort=name` (intended change 3), product pages, the
    search projection, the sitemap, the feed selection count and basket add. Every other migration of the
    feature is additive (new tables, nullable or defaulted columns), so a pre-feature database holds no row
    they change. Intended change 4 (SEO overrides served) is asserted by the SEO page tests, not re-seeded here.
    **Two answers change beyond `plan.md`'s list, found while writing this — for the coordinator / PO**:
    (a) pre-feature `getProductByIdOrSlug` answered **410 to every `inactive` product before it tested the
    channel or the audience** (master `catalog-query.service.ts` ~`:1653`); after T036's deviation (security
    checkpoints A/B) the 410 is answered only where the product would be available with the archive taken
    away, so a formerly `inactive` product outside the channel or the caller's audience now answers the
    absent 404. The task text "every formerly `inactive` product answers 410 exactly where it answered 410
    before" is therefore not literally true; the test asserts the shipped (narrower) behaviour and names it.
    (b) basket add tested no status at all before (R0 F1), so formerly `inactive` (now archived) products
    were addable too; intended change 1 names only the off-and-not-archived half. Both are deliberate
    security outcomes. **Accepted as intended by the owner on 2026-10-27 (decision A)**: recorded as `plan.md`
    *Intended behaviour changes* 7 (a) and 8 (b) and spec Clarifications Session 2026-10-27; the test header
    cites them.
  - *T145* `contract/catalog/scoped-availability-all-consumers.test.ts`: one entry per `consumers.md` row,
    every entry asserting both arms (ON admitted, OFF refused with the absent id's body where the seam has
    one). Off = channel-scope `inactive` on both buyer channels (off at every (C, L)); the per-seam files keep
    the language, window and audience arms. Row 12 includes the owner's `available: false` column, row 26 the
    archived buyer 404 and operator `409 PRODUCT_ARCHIVED`, row 20 the reorder exemption (seeded, then refused
    at placement). Rows 15 and 25 refuse nothing (they pick a value) and row 10 has no backend seam — the file
    header names where each is asserted, and a last case fails if a row 1–26 has neither an entry nor a reason.
    Rows 7–8 assert the documents' projection; the index filter itself is `integration/search/…` (Meilisearch).
    **Corrected in the final fix round (C-m1)** — the ARCHIVED arm is asserted, byte-equal to the absent answer or as
    an absence, on rows 1, 2, 4, 5, 6, 7–8, 9, 14 (a basket line archived before placement) and every seam through
    `expectSingleNotFound` (12 add, 13, 16 buyer, 17 save, 21, 22); row 3 asserts the archived product's own `410`;
    row 26 is archived-only (buyer create 404, operator create 409). Elsewhere: row 11's archived exclusion is
    `integration/product_feeds/generation.test.ts`; row 18 reports `product_archived` by design
    (`quick_order/…/import-pipeline.test.ts`); row 26's draft edit, resubmit, operator edit and approved-quote
    conversion are `integration/quote_requests/archived-product.test.ts`. **Not asserted for an archived product
    anywhere**: row 20 (reorder of a line archived since — placement refuses it through row 14's seam), row 23
    (external intake, pending owner decision S-M2) and row 24 (the bulk-price probe's reason). Rows 15 and 25 stay
    waived (they pick a value, refuse nothing).
  - *T146* — a case in `scoped-availability-matrix.test.ts`: `CATALOG_SEARCH_BACKEND=meilisearch` (the harness
    pins Postgres), `withModuleOff('search', 'deactivated', …)`, then `x-search-backend: postgres` and the same
    P/Q/off/archived sets and facet counts at all four (C, L) pairs. *T146a* — **no change** expected: the route's
    `useMeili` carries `effectiveState.isPresent('search')` and the fallback is `queryService.listProducts`, whose
    `#listingNarrowing` holds `availabilityCondition` (T034). To be confirmed green on ci-pg; if red, T146a reopens.
  - *T149* — audit of the 55 `.changeset/163-*` files against `git diff --name-only <merge-base>...HEAD --
    packages/`: every touched published package is named (admin-kit, contracts, platform, page-builder-admin,
    mod-i18n, blog, carts, catalog, comparisons, import-export, inventory, orders, price-lists, product-feeds,
    quick-order, quote-requests, search, seo, shopping-lists). `prompt_actions` changed only `PROMPT_TOOLS.md`,
    outside its `files` (`dist`, `i18n`, `docs`) — no changeset, correctly. The status change is `minor` with a
    **BREAKING** body in `163-product-status-model.md` (contracts, catalog) and `163-admin-status-archive-screens.md`
    (admin-kit, page-builder-admin, …); no `major`. No new changeset needed: the one change of this phase to a
    published package is a comment in catalog's manifest. `check:release-intent` 0 violations, also with
    `--since <merge-base>` (`shape=ordinary changesets-added=55 violations=0`); `pnpm changeset:status` plans `minor`.
  - *T150* — deleted / renamed in the feature (`git log --diff-filter=DR <merge-base>..HEAD`):
    `backend/test/unit/catalog/product-status-coerce.test.ts`, `packages/modules/catalog/src/admin/components/ProductSeoLink.tsx`,
    `admin/test/modules/catalog/product-seo-link.test.tsx` → `admin/test/modules/seo/product-seo-link-zone.test.tsx`,
    the spec directory `159-` → `162-` → `163-product-data-scopes` and `.changeset/162-*` → `163-*`. Grep of each path
    and basename over `backend/test`, `admin/test`, `storefront/test`, `backend/scripts`, `scripts`, `packages`:
    no reference left (the remaining `ProductSeoLink` hits are `seo`'s own live zone). No module moved, so no
    `module-removal.test.ts` ledger entry is derived from this feature; the test is green (unit config).
    Read sizes (`unit/scripts/check-read-size.test.ts`, unit config): the one completed run had 7 reds — 6
    `stale-artefact` on `mod-catalog`, caused by this phase's manifest comment landing mid-run (catalog rebuilt
    since), and `check-pdfmake-footprint.sh`'s BSD `du -b` (the macOS gap) — and no entry the band refused;
    the drift inside the band is left alone (`check-estate.md`). A re-run hit the 900 s `beforeAll` hook timeout
    (spawn pool of 1: 178 MB free on the host); a third, with a longer hook timeout, was still running at
    handback. Nothing re-recorded. Static checks after the test files landed, all exit 0:
    `check:harness-teardown`, `check:fixture-substitution`, `check:port-dependencies`, `check:port-catches`,
    `check:module-boundary`, `check:module-docs`, `check:docs-translations`, `check:off-state-coverage`,
    `check:env-inputs`, `check:singleton-identity`, `check:platform-surface`, `check:divergence`,
    `check:diacritic-folds`, `check:release-intent`. Skipped on the Intel macOS host (false reds): `check:naming`,
    `check:language`, `test:unit:fast`, `moved-module-tree.test.ts`.
  - *Task A (review of S-3)* — `catalog` declaring `admin_roles` is the sanctioned shape and stays:
    `admin_roles` is `activation.nonDeactivatable` with `dependencies: []` (no cycle, no operator control lost,
    no absent state to degrade through — `module-composition.md` exempts a non-deactivatable owner from the
    consequence ledger), `prompt_actions` and `admin_actions` declare it for the same `permissionService` port,
    and an instance always carries it (non-deactivatable modules are closed over `dependencies`). If the port were
    ever unresolvable, `lazyPort` throws at worker start and the operation is marked failed — fail closed. The
    manifest comment now says so; `check:port-dependencies`, `check:port-catches`, `check:module-boundary` 0,
    `unit/db/module-graph.test.ts` 7/7, `bulk-operation-requester.test.ts` 4/4.

**Verification** (one invocation per line): `[PG] backend/test/integration/catalog/deploy-parity.test.ts`; `[PG] backend/test/contract/catalog/scoped-availability-all-consumers.test.ts`; `[PG] backend/test/contract/catalog/scoped-availability-matrix.test.ts`; `pnpm --filter backend run check:docs-translations`; `pnpm --filter backend run check:module-docs`; `pnpm changeset:status`; `pnpm run check:naming && pnpm run check:language` (in Docker Ubuntu on the macOS host — the BSD-tool gap)

### Phase 25: Final gate and acceptance hand-off

- [x] T151 [S1] `pnpm -r run typecheck` and `pnpm -r run lint` *(2026-10-27: green on `c8249a0f6` — hosted `quality` run https://github.com/bfluks/endora-commerce/actions/runs/40531658444 runs `pnpm -r run typecheck` and `pnpm -r run lint`)*
- [x] T152 [S1] `pnpm --filter backend run test:unit:fast` and `pnpm --filter '!backend' run test` (Docker Ubuntu on the macOS host) *(2026-10-27: green on `c8249a0f6` — the same run's `test:backend:unit` (`test:unit:fast` on Ubuntu) and `test:frontend` (`pnpm --filter '!backend' run test`) jobs)*
- [x] T153 [S1] Every `check:*` in the `quality` job: `check:module-boundary`, `check:port-dependencies`, `check:port-catches`, `check:subscribe-seam`, `check:entry-presence`, `check:off-state-coverage`, `check:action-route-permissions`, `check:bundle-pairing`, `check:release-intent -- --since origin/master`, `manifests:check`, `overlay:check` *(2026-10-27: green on `c8249a0f6` — the same run's `quality` and `quality:static` jobs run every `check:*` of the job)*
- [x] T154 [S1] Fork `ci-pg` fully green on the rebased tip; record the run URL *(2026-10-27: green on `c8249a0f6` — fork ci-pg https://github.com/bfluks/endora-commerce/actions/runs/40532195479: 127 files, 910 tests, 0 failed; SC-004 bench ×0.920 / ×0.928 default, ×1.041 / ×1.069 sort=name, ×0.991 free text)* *(T151–T154 predate the rebase onto `0bf86450d`: hosted `quality` and fork `ci-pg` re-run pending on the new tip)*
- [ ] T155 [S1] Re-run `quickstart.md` §1–§9 on a dev stack; record findings in the PR
- [x] T156 **Coordinator re-asks owner Q1 (status values A — `draft`/`active`/`inactive` — vs B — enabled/disabled per scope + global archive action) before acceptance.** If B: add a phase (contract constant + `CHECK`s + data migration mapping scope values + admin control + archive action), per research R3; nothing else changes
  - **Answered 2026-10-25** (spec Clarifications, Session 2026-10-25): B in the existing vocabulary — `active` / `inactive` at every scope, `draft` removed, `inactive` plain off everywhere, archiving a separate global Archive / Restore action, no alias. More than R3's "nothing else changes": the global status path, the PDP's 410, the bulk undo's revert keys, the gate's `statusOnAt` and three consumers also read "inactive" as "archived" (research R30). The work is **Block Q** (Phases 9a, 9b, 9c, 15a).

- 2026-10-27 (S1, Phase 25 start): rebased with `--signoff` onto `origin/master` `2b27fa2dd` (27 commits: #429
  four-place unit prices, release 0.108.0, #430 sub-cent feeds / quote PDF, #428 money follow-ups); backup ref
  `backup/163-pre-rebase-20261026` = `be4db1d62`. Two conflicts: the Polish carts page's translation cache (feature
  side taken, then re-pinned at the tip to the merged English hash and Polish page — `check:docs-translations`
  0 findings) and the `@endora-commerce/contracts` import in `orders/routes.ts` (master's `unitPriceHalfUp` beside our
  `withChannelOrderRules`; our `roundAmountHalfUp` dropped, unused once master's four-place rule replaced it).
  Fifteen files changed on both sides merged cleanly and were read: the catalog/seo migration registry (ours after
  master's, master added none to catalog/seo), `errors.ts`, the `_i18n` bundles (parse), `reference-ledgers.ts`,
  `quote-requests.ts`, `orders/index.ts`, `feed-generation.service.ts`, `OrderCreatePage.tsx`, `RfqCreatePage.tsx`,
  `cart-batch-add.test.ts`, the carts docs, `seo/package.json`, the lockfile. `composer:generate`,
  `manifests:generate` and `pnpm install --lockfile-only` moved nothing, so there is no regenerate commit;
  `--frozen-lockfile` clean. Upstream deleted only consumed changesets — nothing under `backend/test/**` names
  them. Green: `build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint` (warnings only), `check:module-boundary`,
  `port-dependencies`, `port-catches`, `subscribe-seam`, `entry-presence`, `off-state-coverage`,
  `action-route-permissions`, `bundle-pairing`, `module-docs`, `class-vocabulary`, `admin-zones`,
  `error-translations`, `docs-translations`, `release-intent --since origin/master` (55 changesets, 0 violations),
  `composer:check`, `manifests:check`, `overlay:check`; unit suites of mod-carts, mod-orders, mod-quote-requests,
  mod-product-feeds, contracts; backend `agents-router`, `error-code-routing-equality`, `module-removal`,
  `read-size-drift`, `no-new-enum-values`; admin `OrderCreatePage*`, `RfqCreatePage*`, `money-unit-price`
  (one run under load timed `OrderCreatePage.minimum` out at ~5 s; green alone twice). Not run on this Intel
  host (false reds): `check:naming`, `check:language`, `test:unit:fast`, `moved-module-tree.test.ts`; [PG] files
  are left to ci-pg. Owner decision A (2026-10-27) on T144's two findings recorded before the push (plan.md
  intended changes 7–8).
  ci-pg on `ff9f135cc`: 120/122; the two reds (`place-order-line-price-current`, `cart-read-equals-placement`, both new
  from master's #428/#429) created their products through the admin route without a status, which under Q1-d is
  `inactive` — fixed in `fb91cc237` by creating them `status: 'active'` (`createTieredProduct`,
  `createUnpricedProduct`, the inline base-priced product); no product behaviour changed.
- 2026-10-27 (S3, final fix round (UI)): *S-M1* the SEO screen takes `?entityId=` only in UUID shape and the meta
  editor encodes the id into its path; *C-m2* attachment delete asks in a kit `ModalDialog`; *Q-M5* global audience,
  URL key and order-rule changes keep every override and warn about nothing (scope controls, URL keys panel, order
  rules card); *Q-M7* the PDP alone passes `langOverride` (both call sites); *Q-L10* UX-3 vocabulary asserted in the
  URL keys panel, scope editor and bulk dialog — which found the scope editor's outcome "N override(s) reset" (now
  "… removed, the inherited value applies").
- 2026-10-27 (S1, final fix round (backend)): three code fixes from the final reviews and owner decision SEC-2; no new
  product defect was exposed by the added tests (those that are [PG] have not run yet).
  *S-L3* (fix, red first — `bulk-operation-requester.test.ts` 4 red → 9 green): a product write bulk operation with
  no known requester (empty or the all-zero sentinel) is refused at `create()`, the bulk-update route answers 401
  instead of recording the sentinel, and a queued row carrying it fails at worker start with or without a permission
  checker; `search_reindex` stays exempt (it writes no product; commented at `create()` and the plugin's enqueuer).
  `integration/catalog/bulk-operation-consumer.test.ts` used the sentinel on product writes — given a real id.
  *S-L1a* (fix, red first — `comparison-recipient-view.test.ts`): a recipient's `(removed product)` column carries a
  fresh random UUID per view, never the product id; the owner keeps the id (`DELETE /me/products/:productId`).
  *SEC-2 = A* (fix, red first, same file 4 red → 8 green): the owner's column of a product the channel's effective
  audience no longer admits them to collapses to `(removed product)` like a recipient's, counted nowhere — classified
  through `describeChannelAvailability` over the owner's unavailable columns (a non-member is absent from that answer
  and stays lifecycle). Applies to `/me` (all four writes), `/me/pdf` and the share link read by its owner; the
  operator's audit view (`administrator`) keeps every column, as its comment intends. *C-n1*: `buyerViewerOf` and
  `languageTagOf` are one module, `comparisons/src/backend/buyer-viewer.ts`. *C-m1*: archived arm in the SC-007 sweep,
  T145 note corrected above. *Q-H1*: T065 records the bench run. Tests added, all [PG] and **unrun locally** (no
  Postgres here; written against existing fixtures, red state not observed): *Q-M1* attribute filters and facet counts
  over a channel override; *Q-M2* a compared value at (C, L); *Q-M3* the order line keeps its packaging-unit name after
  a rename; *Q-M4* US3 #1–#3 over HTTP (anonymous, X, Y × B2B override, B2C inherit; listing and PDP); *Q-M6* derived
  global key on create and duplicate; *Q-L1* the sweep's scheduler (every 5 min) and the platform-off arm
  (`startPublicationWindowSweep` gained an optional `queuePrefix`, the expiry sweep's shape); *Q-L2* status import never
  archives nor restores; *Q-L3* channel delete cascades (URL keys and SEO rows deleted; media tables' `on delete
  cascade` read from `pg_constraint`); *Q-L6* the owner's PDF equals `/me` and the audit view keeps the CMP-1 column;
  SEC-2 contract cases in `contract/comparisons/share-unavailable-columns.test.ts`. *Q-M5* service half
  (`product-scopes.service.test.ts`, runnable): passed on first run — characterisation, no defect. Checks:
  `tsc -p test/tsconfig.json`, eslint, `check:fixture-substitution`, `check:shared-table-wipes`,
  `check:harness-teardown`, `serial-test-files.test.ts`; typecheck + lint of mod-catalog and mod-comparisons; unit
  suites of mod-comparisons (60) and the touched catalog tests; backend `unit/comparisons`.
- 2026-10-27 (S1, second Phase 25 rebase): rebased with `--signoff` onto `origin/master` `0bf86450d` (merge of
  #469, `specs/163-page-builder-marketing-pages/` — a different feature on the same number, one squashed commit);
  backup ref `backup/163-pre-rebase-20261027b` = `27496ac5b`. Conflicts, in replay order: `.specify/feature.json`
  (master's value kept at every stop — it is what the tip carried before); the catalog `i18n/{en,pl}.json` bundles at
  the S3 P13 handover (a three-way key merge — master's keys plus ours, no key changed on both sides; the tip equals
  the pre-rebase bundles with master's 372 added keys, checked key by key); the `AGENTS.md` appendix's Recent Changes
  (`feat/163-product-data-scopes`, `163-page-builder-marketing-pages`, `161-price-book-editor` — the script's
  branch-name entry, newest three; Active Technologies untouched, neither 163 adds a dependency); the Polish catalog
  translation cache (our side taken during the replay, re-pinned at the tip to the merged English hash and Polish
  page); `catalog-query.service.ts` `toSummary` (our effective URL key beside master's new `summary`). **Master's one
  new buyer-facing product field**, the card's `summary` (R-16 there), is derived in `toSummary` from the description
  through the same `effectiveSystemText` override and language pick as the PDP, on rows the listing has already cut
  through `filterAvailable` — no new read, no new predicate; the PDP carries it through its `...summary` spread. Its
  product blocks moved from `catalog-block-data.ts` to `block-data.ts` (storefront and `cms-components`) and gained a
  single-product `ProductCard` block on the same `getProductBySlug` request, so consumers.md row 19 is renamed, not
  added to; the block files carry no predicate (grep). Published text now cites this spec by slug (`search.md` EN +
  PL, the upgrade guide EN + PL; their Polish caches re-pinned); master's own `163-*` changesets left alone.
  `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` moved nothing — no regenerate commit.
  Upstream deleted or renamed `ImageSlider`, `ButtonLinkFields` and the `catalog-block-data` files; nothing of ours
  under `backend/test/**`, `admin/test/**` or `storefront/**` names them. Green: `--frozen-lockfile`, `build:packages`,
  `pnpm -r run typecheck`, `pnpm -r run lint` (warnings only), every T153 check plus `docs-translations` (0 findings),
  `module-docs`, `class-vocabulary`, `admin-zones`, `error-translations`, `composer:check`, `release-intent --since
  origin/master` (56 changesets, 0 violations); unit: mod-catalog (30 files) and contracts (78 files) in full; backend
  `agents-router`, `error-code-routing-equality`, `module-removal`, `read-size-drift`, `no-new-enum-values`,
  `seo/cross-module-ports`, `blog/block-declarations`; storefront `server-context-language`, `active-channel`,
  `pdp-redirect`, `ssr/catalog-blocks`, `ssr/blocks`; admin `cms/block-data-source`,
  `batch-sixteen-surfaces.module-owned-surface`. Not run here (Intel host false reds): `check:naming`,
  `check:language`, `test:unit:fast`, `moved-module-tree.test.ts`; [PG] files left to ci-pg — first among them
  master's `contract/catalog/products-list.test.ts`, which creates its products with `em.create(Product, { status:
  'active' })` and a raw `sales_channel_products` row and reads `summary` on the listing and on the PDP by slug.
  The four bundles both sides touched and auto-merged (`_i18n`, `blog`, en + pl) and the catalog pair parse with no
  duplicate key; no test of ours compares a whole product card strictly, so master's new `summary` field breaks none.

- 2026-10-28 (S1, third Phase 25 rebase): rebased with `--signoff` onto `origin/master` `0ea36c814` (176 commits:
  #485 / #489 Polish and English error placeholders written as sentences, with `check:error-translations` P5
  refusing the shape; #493 each package's `dist` cleaned before compiling; #483 `manifests:generate` reconciling
  `backend/package.json`; #487 the custom-field definition form; #488 admin tests on node 26 `localStorage`; the
  migration-class registry naming its missing entry; and `specs/163-projects-and-tasks/` — `projects`, `tasks`,
  CRM references, admin preferences); backup ref `backup/163-pre-rebase-20261028` = `c46eb1774`. Two conflicts:
  the `AGENTS.md` appendix's Recent Changes (`feat/163-product-data-scopes`, `164-admin-user-preferences`,
  `163-projects-and-tasks` — the newest three) and the catalog `i18n/{en,pl}.json` at T156e: master's sentences
  for `PRODUCT_NOT_FOUND` kept, ours for `PRODUCT_ARCHIVED` ("Product is archived." / "Produkt jest
  zarchiwizowany." — master had rewritten the old "inactive" wording); `check:error-translations` reports
  `placeholder=0 sameAsEnglish=0`, so every code of this feature is a sentence in both languages.
  **Master's product reads**: none in `catalog`, `carts`, `orders`, `quote_requests`, `search`, `seo`,
  `comparisons`, `shopping_lists`, `quick_order`, `product_feeds`, `import_export` or the storefront (only
  `package.json` / bundle lines there). The new readers are the record references of `projects`, `tasks` and
  `crm` (`[[product:<uuid>]]` names through `CatalogProductReadPort.findByIds`, gated on `catalog:read`) —
  operator surfaces with no storefront route, so no availability rule applies (consumers.md unchanged).
  `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` moved nothing — no regenerate
  commit; `--frozen-lockfile` clean.
- 2026-10-28 (S1, T155 findings fixed): four defects from the manual walk, each red first.
  *B1 (§1.5b)* — a buyer's quote line was judged at the **message** language: the customer routes passed
  `responseLanguage()` (which falls back to a bundle language — `de-DE` answers in Polish) as the scope tag, so a
  product off at (B2C, de-DE) was quoted while the basket refused it. `CreateForCustomerOptions.languageTag`
  (contracts) now carries the first `Accept-Language` tag; `RfqService.createForCustomer` / `patchDraft` /
  `resubmit` resolve the scope language, line names and unit names from it (absent: the channel default), and
  `language` stays the message language. Passed by the three customer routes, the basket's conversion
  (`actor.languageTag`) and the buyer's quick-order build. Red: `rfq-scope-language.test.ts` (2 red → green),
  `quick-order-build-service.test.ts` (1 red → green). Left at the channel default, as before and as their own
  seams already judge: the shopping-list conversion (its partition asks at `languageCode: null`) and the order
  clone to a quote. [PG] `integration/quote_requests/scoped-availability.test.ts` (German-off: RFQ 404 equal to
  the absent product's, basket 404, Polish 201) — unrun here.
  *B2 (§1.5c)* — `adminCreateQuoteRequestSchema.salesChannelId` (optional; unknown id `404 NOT_FOUND`):
  `createOnBehalf` stores it and `onBehalfWarnings` asks at it. *Create quote request* shows a **Sales channel**
  selector under the customer from `GET /admin/organizations/:id/sales-channels` (the Organization's active
  channels; the only one preselected, else a choice is required; no selector and no field when the read fails),
  prefills agreed prices on that channel, and on a `warnings` answer stays on the screen naming the products with
  **Open the quote request**. Red: contracts `quote-requests.test.ts` (2), `on-behalf-channel.test.ts` (3),
  admin `RfqCreatePage.sales-channel.test.tsx` (4 + 1). Docs EN + PL, Polish cache re-pinned. [PG] cases in the
  same `scoped-availability.test.ts`.
  *B3* — the root layout cannot take `?lang=` (layouts get no `searchParams`, and L-1 / Q-M7 keep the override
  the product page's alone, pinned by `pdp-redirect.test.ts`); the product page marks its own content instead,
  `lang={locale}` on its outermost element (WCAG 3.1.2).
  *B4* — an archived product's PDP answered HTTP 500: `productIdForKey` rethrew the resolve's `410`. It now
  answers not-found (404) like an unknown key; quickstart §5a reworded. A true 410 page is not cheap in the App
  Router (a page can only `notFound()` / redirect; a 410 needs the middleware to ask the resolve per `/p/`
  document) — not built, left to the owner.

- 2026-10-28 (S1, fourth Phase 25 rebase): onto `origin/master` `cab10b250` (11 commits: #491 display mode `none`
  withholds every amount, sales-channel identity writes through the Command Bus, palette word matching); backup
  `backup/163-pre-rebase2-20261028` = `8569358d5`. One conflict, the import list of
  `catalog-org-price-decorator.ts` (master's `LinePriceResult` and `shown()` beside our
  `CatalogProductAvailabilityPort`); the file is ours plus master's hunks exactly. Master's new
  `catalog-org-price-decorator.withheld.test.ts` built the decorator without 163's `availability` dependency —
  given one answering every product available. #491 changes which amounts are shown, not which products are
  read: no consumers.md row moves. Regeneration moved nothing. Green: `pnpm -r typecheck`, mod-catalog (31 files),
  mod-price-lists (32), contracts (82), catalog lint, the catalog-touching checks, `release-intent` (0 violations).

- 2026-10-28 (S1, T155 CACHE-1 = A, B4 = keep not-found): *CACHE-1* — a product switched off in B2C kept answering
  200 on `/p/<key>` for minutes: Next's Data Cache stores only a `200` (`patch-fetch.js`: `res.status === 200`),
  so the time-based revalidation's `404` never replaces the warmed entry, and nothing told the storefront.
  `catalog` now subscribes to `product.updated.v1`, `product.archived.v1`, `product.deleted.v1` and a product's
  `sales_channels.membership_changed` (`ctx.subscribe`, off with the module) and, through the category path's
  `StorefrontRevalidator`, drops the product's per-key tags — id, slug, URL keys, former keys — coalesced per
  event-loop turn (`ProductPageRevalidation`); a deletion drops the shared `catalog:product`. Best-effort: a failed
  key read or call is logged. The tag vocabulary moved to contracts (`CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS`) and
  the storefront's `productCacheTags` reads it. The fetch layer cannot drop the entry itself: it only ever sees
  the stale `200` (the failing revalidation is Next's background fetch), and `revalidateTag` throws during a
  render in Next 15. Red: `product-page-revalidation.test.ts` (module missing → 7 green). Listings
  (`catalog:products`) are left to their 60 s window — always a `200`, so they heal on their own.
  *B4 residual* — the read by id after the resolve (`productById` in `resolution.ts`) answers not-found for a `404`
  or `410` too (red: 4 new cases in `pdp-redirect.test.ts`).

- 2026-10-28 (S1, review fix round on `820689abe..d0bbcad93`, code review + security review): each new test seen
  red first (the `patchDraft` / `resubmit` cases by mutating the fixed call sites back). *Must 1–2* — the
  shopping-list conversion (partition and `createForCustomer`) and the buyer's order clone now take the request's
  language tag and channel, like every other buyer quote seam; the operator's clone keeps `minimums: 'warn'` and
  no tag. *Must 3 (security M1)* — `createOnBehalf` accepts only one of the Organization's active channels
  (`SalesChannelMembershipPort.listChannelsForEntity`), else `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` (new code, en/pl,
  manifest, routing ledger); admin order create still checks existence only (not changed, by decision).
  *Must 4 (security M2)* — `StorefrontRevalidator` has a 5 s timeout and logs a non-2xx answer without the secret;
  `ProductPageRevalidation` debounces 150 ms (≤ 1 s), caps a batch at 500 products (past it the shared tag once),
  keeps one call in flight, drops a deleted product by its keys (`product.deleted.v1.formerUrlKeys`) and checks
  payloads for a string `productId`. *Should 5–8* — spec.md (archived PDP = not-found page, the API's 410);
  `lineNames(…, languageTag)`; `quick_order` uses `firstLanguageTag`; the `lang` test says why it reads source.
  `shopping_lists` now owns a co-located test run (`vitest.config.ts`, generated `test` script).

- 2026-10-28 (S1, fifth Phase 25 rebase): onto `origin/master` `9559e60c3` (#497, `302e5ce52`: every price-walk
  cursor sealed by the platform's `cursorSeal`); backup `backup/163-pre-rebase3-20261028` = `2e7956f85`. Conflicts:
  `CatalogCradle` (master's `cursorSeal` beside our `processRunsWorkers`), `#priceCursor` (master's
  `#openCursor` with our `ctx` parameter for the effective-name keyset), the `CatalogQueryService` constructor
  (`log`, then master's `cursorSeal`, then our `seoProductMeta` — both call sites follow), the plugin's kernel
  import, and the Polish catalog cache at each replayed stop (its `content` set to the merged materialised page,
  `sourceHash` recomputed from the English body). #497 adds no visibility rule of its own: it seals the position
  the scan stops at, and the price walks still cut by 163's `filterAvailable`; its [PG] corpus hides products by
  audience (`organization_restricted`), which 163's rule covers. The tip equals the previous tip plus #497's
  diff. Regeneration moved nothing.

- 2026-10-28 (S1, sixth Phase 25 rebase): onto `origin/master` with #492 (the sales channel `isPublic` flag retired
  into the display-mode chain, column dropped); backup `backup/163-pre-rebase4-20261028` = `a533040c4`. Conflicts:
  the search-hydration test fixtures (master's "resolves nothing" pricing port beside our availability port), the
  listing's card reads (our `#listingCardReadsFor(em, page, ctx)`, master's removal of the `isPublic` gate), the
  upgrading page EN + PL (both 0.109.0 entries kept, master's first) and the Polish catalog / upgrading caches
  (re-pinned from the merged pages at each stop). After the replay, 163's tests still named the dropped column:
  twelve [PG] files inserted `sales_channels.is_public` and three unit fixtures set `isPublic` — removed; one search
  unit fixture needed the now-required pricing port. No 163 product code read `isPublic`; anonymous access (154) and
  `toScopeChannel` never did.
- 2026-10-29 (S1, owner decision "A" on the security review's follow-up: the server is the sole enforcer):
  `createOnBehalf` resolves `body.salesChannelId ?? raisedOnChannelId()` first and checks **that** channel against
  the Organization's active channels, so an omitted id no longer skips the `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` check;
  no channel at all (no request scope) is refused the same way (Constitution XII) — red first in
  `on-behalf-channel.test.ts` (omitted id with the default unassigned / inactive → 422, assigned → stored on it,
  none → 422); `archived-product-lines.test.ts` now names an assigned channel. Three [PG] fixtures whose ad-hoc
  Organization had no channel are bound to the default (`pdf-export`, `history`, `rep-scope`). The create screen no
  longer sends a channel-less request when the Organization's channels cannot be read: it shows
  `rfqCreate.channelsLoadError` with **Retry** and keeps Create disabled (red first in
  `RfqCreatePage.sales-channel.test.tsx`; the screen's other tests answer the channel read). Contract JSDoc, error
  comment, manifest, routing ledger, `contracts/error-codes.md`, the changeset and the module page (EN + PL, cache
  re-pinned) follow.
- 2026-10-29 (S1, code review of the "A" round): the alert stays and Retry is inert while a retry runs; no price is
  asked before a channel is settled for the current customer's Organization (one resolve per line per customer
  switch, asserted again); `createOnBehalf` and `onBehalfWarnings` share `onBehalfChannelId`; the no-channel arm has
  its own sentence (`errors.RFQ_SALES_CHANNEL_NOT_ALLOWED.no_channel`, `details.code`); the changeset leads with the
  BREAKING 201 → 422; the page no longer blames `customers:read` for a failed read.

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
| FR-010 (Q1), FR-019, FR-082 (archive) | T156a, T156c | FR-053 | T156k, T156u |
| FR-110 (Q1), SC-009 | T156b, T144 | FR-112 | T156a, T156c, T156d, T156l |
| FR-113 | T156d, T156u | FR-005 (archived 410) | T156s |
| FR-043 (Archive / Restore labels) | T156u, T156y | FR-092 (Q1) | T156l |
| FR-084 (Archive / Restore) | T156c, T156h (permission inventory) | FR-060 (archived, status only) | T156a, T078 (g) |
| SC-002 | T087; manual timing in `quickstart.md` §1 (T155) | SC-003 | T067, T093; manual check in `quickstart.md` §4 (T155) |

## Parallel execution examples

- After Block A: **S3** starts Phase 13 and **S2** starts Phase 16 while **S1** waits for #384 (or stacks).
- After Block B: S2 runs Phases 17–19 after rebasing onto S1's tip; S1 runs Phases 9–11 meanwhile (no
  shared file), then 12, 21, 22 once S2's P18 is applied.
- Within a phase, `[P]` RED tests are written together; implementation follows in order.

## Implementation strategy

MVP = Blocks A + B (US1 end to end on every consumer) + Phase 13 (operator can set it). Each later story
ships on top independently: US2 rides P7 + P13, US3 P4/P5 + P13, US4 P9 + P14, US5 P10 + P15, US6 P11 +
P15, US7 P16–P17 + P20, US8 P18 + P20, US9 P21–P23, US10 P12 + P13.

**Phase 9d resumed and closed (2026-10-26).** The `check:port-catches` red is fixed, the full check sweep is
green, and P-3a / P-3b are recorded — see the Phase 9d note. T156-pal-b landed with S3.

**Checkpoint F fix round (backend, S1, 2026-10-26).** Review findings of `0404a3b6a` (`review-163-DF/backend-fixes.md`):
- *B-1 / S-4 fixed* — a gallery `PATCH` carrying `labels` runs `product.media.update` and replaces the labels on the
  Command's `em` under the product lock (`labels` in the item projection); `PUT …/gallery/order` is
  `product.media.update` with `orderedGalleryItemIds` before/after, one transaction; the route-level `gallery.delete`,
  `gallery.reorder`, `attachment.delete` rows are gone (the services' Commands write the one row). Not changed: the
  `gallery.create` route still writes a row beside the service's `gallery_item.create` (same duplicate shape, not in
  the findings). Unit `gallery-media-command.test.ts`; [PG] `test/contract/catalog/media-scopes.test.ts` (new case).
- *B-2 fixed* — resolver comment, and the API-client rule on the packaging-units page (EN + PL).
- *B-3 fixed* — `409 PRODUCT_ARCHIVED` carries `details.productIds`. Unit `operator-line-products.test.ts`; [PG]
  `test/integration/quote_requests/archived-product.test.ts`.
- *B-4 fixed* — platform line dropped from `163-admin-attribute-scope-flags.md`.
- *B-5 left* — a warning in the channel-roles PUT response would change `GalleryChannelRoles` in contracts and the
  admin consumer S3 owns; the UI labels the case.
- *B-6 fixed* — `adminAttributeResponseSchema.numericKind` is `.nullable().optional()`; the [PG]
  `test/contract/catalog/attribute-scope-flags-response.test.ts` parses the full schema again.
- *S-1 / S-2 fixed* — six product-id tool schemas `.max(PROMPT_PRODUCT_IDS_MAX = 10 000)`; every catalog mutation tool
  dedupes ids; a per-item reason is an `HttpError`'s message, else `failed`.
- *S-3 fixed* — `BulkOperationService` re-checks the requester (`isActiveAdministrator` + `catalog:write`, through
  `admin_roles`' `permissionService`) at worker start and fails closed; `catalog` declares `admin_roles`.
- *S-5 fixed* — SEO meta routes answer `404 NOT_FOUND` for a non-UUID `:entityId`.
- *S-6 fixed* — gallery and attachments pages: hiding is presentation, the stable URL stays fetchable (EN + PL).
- *Phase 14 note* — the backend gap is closed (see there).
- *Owner decisions built:* **N2 = B** (operator-named channel → unit name at the channel's default language; Phase 22
  note) and **CMP-1 = A** (non-owner reader → `(removed product)` column for an unavailable product;
  `consumers.md` row 12). [PG] `test/integration/carts/packaging-unit-name-snapshot.test.ts` (new case),
  `test/contract/comparisons/share-unavailable-columns.test.ts` (new).

**Checkpoint D+F fix round (UI, S3, 2026-10-26).** Review findings of `0404a3b6a` (`review-163-DF/ui-fixes.md`);
owner decisions **UX-1 = A, UX-2 = A, UX-3 = A, UX-4 = A** (owner, 2026-10-26). CI reds of PR #11 first:
`check:class-vocabulary` (the attachment dialog's `b2b-alert` → kit `Alert`) and `check:admin-zones` (catalog's SEO
link gated on `{ module: 'seo' }` → new zone `product.editor.seo.after`, contributed by `seo`; `seo` gains
`react-router-dom` as an optional peer through `manifests:generate`). Every behaviour change was seen red first.
- *C-1 fixed* — the product PATCH runs alone first; the override and gallery flushes run only once it is accepted.
- *C-2 / D5 fixed* — SEO meta editor: load sequence drops stale answers, selectors disabled in flight, load on
  selection (a typed locale on Enter / blur / Load), status cleared on scope change, discard-draft and Use inherited
  dialogs, waits for the channel list. *C-8* — scope-context types come from contracts (SEO editor, scope editor).
- *UX-4 fixed* — the SEO screen reads `?entityType=product&entityId=`; the zone link passes the product.
- *D3 / D7 / C-6c fixed* — bulk result rows name products by name + SKU (list labels, `batch-by-id` for the rest;
  `lib/product-labels.ts`) and a scoped row links to `?tab=scopes`, which the editor now opens; error banner
  `role="alert"`, theme tokens instead of hex.
- *D4 / UX-2 / C-9 / D13 / D14 fixed* — the gallery stays mounted once opened and reports staged edits to the
  unsaved-changes prompt; Add / Remove wait for Save while edits are staged ("Save your changes first."); removal and
  preview are kit `ModalDialog`s; "Use inherited (Image N, hidden here)"; role options "Image N · file" (file = the
  asset URL's last segment — the gallery read has no filename); hidden channel role holder flagged; alt-text hint per
  language; label radios assign on change; read-only note.
- *UX-1 / D11 / D11b / C-7 fixed* — overview: text resets and orphan deletes confirm in a dialog; channel values in a
  "Whole channel" column, language values in an "Every channel" row (no reset in a `<th>`); focusable named scroll
  region, sticky row headers, loading live region, 24px targets; focus returns to the heading; no channel-level URL
  key reset.
- *UX-3 fixed* — "Use inherited" / "Użyj dziedziczonego" and "No longer applies" / "Nie obowiązuje już" across the
  overview, URL keys, scope editor and bulk; PL `notOffered` "Język nieoferowany w kanale".
- *C-3 / C-4 / C-6b / D9 / D10 fixed* — URL keys panel: works without scope-context; a repeated takeover re-asks;
  grammar refusals mark their field; inherited key as visible text; "Not saved yet" / "No changes to save"; h4
  section headings.
- *C-5 / D9 / D15 / D16 fixed* — contracts export `ATTACHMENT_NAME_MAX`, `PACKAGING_UNIT_NAME_MAX`; packaging units
  gated on `canWrite`; both dialogs share refusal / "Nothing was saved. Try again." wording, "Saving…", a discard
  prompt on Escape / Cancel and inherited-value hints (`ScopedDialogParts.tsx`); two undefined-class ledger entries
  drained.
- *C-10 / D17 / D18 / D19 / D21 fixed* — editor messages from the bundles; Edit price disabled with its reason and
  the Archived tab's address documented (EN + PL); attribute Save `aria-busy` (it was already disabled, so no double
  preview); bulk scoped status has no default value; narrowing confirmation uses plural forms.
- *Left* — D17's roving tabindex / `aria-controls` on the list tabs (needs a tabpanel and arrow-key handling across
  the list page; not contained). B-5 (channel-roles warning) stays labelled in the UI only.
- *Docs* — overrides, URL keys and SEO pages (EN + PL, cache refreshed) follow UX-3 and the new SEO editor flow.
- *Not run on this host* (Intel macOS false reds): `check:naming`, `check:language`, `test:unit:fast`.
- 2026-10-27 (S1, CI reds on `dea35d0c4`): the six comparisons catalog-availability stubs gain
  `describeChannelAvailability` (empty map — they drop no id); **product defect** — a channel's default language counts as
  offered (`toScopeChannel`) on every read path, but the override PATCH validator, the scopes read/write
  (`memberChannels`, `orphaned`, status-language spelling), the scope overview, the URL-key read/write and the scope
  context read the raw `languages` list, so a channel listing no languages refused its own default (ci-pg Q-M2) — all now
  go through `toScopeChannel` (unit red first in `product-overrides.service.test.ts`); admin CRM reds are flakes, no 163
  commit touches CRM or `ReferenceField` (`comments` green 9/9 locally, 6 under parallel load; `board-card-fields`
  2/3, its one red the same ~5 s timeout as CI, while a recursive typecheck loaded the host).
