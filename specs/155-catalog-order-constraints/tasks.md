# Tasks: minimum order quantities (pieces and packaging units) and the returnable flag

**Feature**: `specs/155-catalog-order-constraints/` | **Issues**: #285, #294
**Input**: `spec.md` (clarified: Q0–Q10, P1–P4, threat-model line), `plan.md`, `research.md`
(R1–R20), `data-model.md`, `contracts/{catalog-api,cart-and-checkout-api,quote-requests-api,returns-api,error-codes}.md`,
`quickstart.md`. Measured on `origin/master` at `39b9b9989`. Revised 2026-10-15 after analyze and the
security threat model.

**Organisation**: twenty-three phases (Phases 1–21 plus 8a and 12a), each sized for
**one builder spawn** (≤ 10 tasks) and ending with an exact **Verification** block. Tests are mandatory
(Principle III): inside every phase each `RED` task — a failing test — precedes the task that makes it
pass; run it and see it fail first. Task ids are stable: a task added later takes a letter suffix
(`T056a`), never a renumbering.

## Format

`- [ ] T### [P?] [US?] [PG?] description — file path(s)`

- **[P]** — may run in parallel with its neighbours (different files, no unfinished dependency).
- **[US1…US6]** — the spec's user story; none = foundational or cross-cutting.
- **[PG]** — needs Postgres + Redis + Meilisearch. Not in `test:unit:fast`, **not run by CI before
  merge** (D-198): run locally, **one file per invocation**, and paste the result into the PR.
- **RED** — the deliverable is a failing test.
- **[S#] / [F#]** — the threat it answers (plan § *Security threat model — disposition*: `S` = design
  candidates, `F` = the security engineer's findings); **[D#]** — the plan's reinterpretation it
  implements.
- Phase tags: **[backend]**, **[admin UI]**, **[storefront]**, **[docs]**.

## Rules for every phase (read once)

- **Every commit `git commit -s`** (the `dco` job). Never add `Co-Authored-By` or any AI trailer.
  Identity inline: `git -c user.name="…" -c user.email="…" commit -s`.
- Start from a clean tree. After editing anything under `packages/`, rebuild it
  (`pnpm --filter <package> run build`, or `pnpm run build:packages`) **before** running any backend,
  admin or storefront test — tests read `dist`, `tsc` reads sources.
- **Test helpers import services from `dist`, never from a package's `src`.** A helper that imports a
  module service or entity from `src` loads a second copy of the entity classes beside the `dist` copy
  the server uses, and MikroORM then treats them as two entities. Use the package specifier
  (`@endora-commerce/mod-<id>`, `backend/test/helpers/package-entities.ts`).
- **Never put a test beside `src/manifest.ts`** (`manifests:check` refuses it). Module unit tests:
  `packages/modules/<id>/src/backend/**`; admin tests: `admin/test/modules/<module>/`; storefront:
  `storefront/test/<area>/`; backend contract/integration: `backend/test/{contract,integration}/<module>/`.
- **`[PG]` commands.** Run from `backend/`, one test file per invocation, each prefixed with this
  environment (the local stack's ports — adjust only if your stack differs):

  ```bash
  TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b_test REDIS_URL=redis://localhost:6380 MEILISEARCH_URL=http://localhost:7700 MEILISEARCH_API_KEY=devMasterKeyChangeMe
  ```

  In the Verification blocks a `[PG]` line is written `[PG] pnpm exec vitest run <file>` and means
  exactly: `cd backend && <the environment above> pnpm exec vitest run <file>`. Never chain a `[PG]`
  line with `&&` to another command.
- Non-`[PG]` backend tests: `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <path>`
  (paths resolve against `backend/`; a package file is `../packages/...`). Module unit tests run
  through the package: `pnpm --filter @endora-commerce/mod-<name> exec vitest run <path under the package>`.
- **`pnpm -r` is reserved for the final gate (Phase 20)** — on the development host it exhausts
  memory. In a phase, type-check each package the phase touched, by name
  (`pnpm --filter <package> run typecheck`), plus `backend` when backend tests changed.
- **React component tests render inside `<StrictMode>`** (the admin root does). Mark a request "done"
  only when its answer has arrived; clean up in the effect's cleanup.
- Contract/integration tests use **per-run unique** fixture names (SKU, slug, packaging-unit name,
  e-mail) and never permanently mutate a shared role; restore any setting they flip.
- Many tests use the fictional channel `…0000000000c1`; where a channel matters use
  `systemDefaultSalesChannelId(em)`.
- After a migration, an entity or a manifest change: `pnpm --filter backend run composer:generate`,
  `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`; commit every
  regenerated artefact in the same commit. **If `composer:generate` rewrites a
  `docs/docs/module-reference/<module>.md`, refresh its Polish cache entry
  (`docs/translation-cache/pl/generated:module-reference--<slug>.json`) and the materialised page under
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/` in the same commit**
  (`docs/docs/contributing/documentation-i18n.md` § *Three-step edit sequence*), then
  `check:docs-translations`.
- Migrations are scaffolded, never numbered:
  `pnpm --filter backend run migration:new -- --module <id> --name <slug>`.
- **A new error code lands in one commit** with its `ERROR_CODES` member, its `MINTED_ERROR_CODES`
  entry (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), the owner manifest's
  `errorCodes` declaration, `errors.<CODE>` in the owner's `i18n/en.json` **and** `pl.json`, and the
  `composer:generate` output with its Polish module-reference refresh (`contracts/error-codes.md`).
- **Never make a customer-facing request schema strict** (146 M4). The admin packaging schemas keep
  their existing `.strict()`.
- Every `catch` around a port call has `rethrowIfModuleDisabled(err)` as its first line
  (`specs/conventions/module-composition.md` item 7).
- **A line that failed visibility, channel or packaging-unit resolution never carries a product name
  or a minimum** in any refusal or report (FR-035). Assert it wherever a hidden product appears.
- Public repository: English only outside bundles; no customer names, ticket ids other than #285/#294,
  or demo URLs in code, tests, docs, changesets or commit messages.

## Dependency chain

```text
P1 ─► P2 (HTTP contracts, rule) ─► P3 (schema) ─► P4 (catalogue read port)
                                                   └─► P5 (catalogue writes, DTOs, catalogue codes)
                                                         └─► P6 (cart single) ─► P7 (cart batch) ─► P8 (placement, preview) ─► P8a (admin create, intake, admin preview)
                                                                                                 ├─► P9 (quick order, lists)
                                                                                                 └─► P10 (quote buyer) ─► P11 (quote operator, warnings)
                                                         P8 ─► P12 (returns: stamp, port) ─► P12a (returns: policy, FR-033)
P5…P12a ─► P13 (admin catalogue) ─► P14 (admin quote/order/quick order)
P5…P12a ─► P15, P16, P17 (storefront)
P13…P17 ─► P18 (off-state, docs, changesets) ─► P19 (OpenAPI, [PG] sweep) ─► P20 (quality.yml) ─► P21 (other workflows)
```

`cart-service.ts` / `cart-read-port.ts` (P6, P7), `order-service.ts` (P8, P12) and `rfq-service.ts`
(P10, P11) are each edited by more than one phase: **build those phases in sequence on one checkout**.

## macOS host routing (used by P20 and P21)

Four gate steps give false results on the macOS host (BSD tools, `awk -v` newlines, `/private/var`
tmpdir, `du -sb`). Run them in Docker on the **committed** branch tip, never against the host
`node_modules`:

```bash
# ubuntu — the two shell checks (read-only mount)
docker run --rm -v "$PWD":/repo:ro -w /repo ubuntu:24.04 bash -c \
  'apt-get update -qq && apt-get install -y -qq git perl >/dev/null && git config --global --add safe.directory /repo && bash scripts/check-naming.sh && bash scripts/check-language.sh'

# node — clone the committed tip into the container, install and build inside, then run <CMD>
docker run --rm --init -v "$PWD":/src:ro node:22.18-slim bash -c \
  'apt-get update -qq && apt-get install -y -qq git ca-certificates >/dev/null && git config --global --add safe.directory "*" && git clone -q /src /work && cd /work && git checkout -q '"$(git rev-parse HEAD)"' && corepack enable && pnpm install --frozen-lockfile && pnpm run build:packages && <CMD>'
```

`<CMD>` ∈ `pnpm --filter backend run test:unit:fast` · `pnpm --filter '!backend' run test` ·
`pnpm --filter backend run pack-gate -- --no-build` · `pnpm run check:pdfmake-footprint`. Do not
prefix `PATH` with `/usr/local/bin` on the host (an old node there breaks corepack).

---

## Phase 1: Setup — done 2026-10-16

**Goal**: a known-good baseline.

- [x] T001 Create `feat/155-catalog-order-constraints` from `origin/master`; create `specs/155-catalog-order-constraints/` with this feature's artefacts (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/*.md`, `tasks.md`); run `.specify/scripts/bash/update-agent-context.sh` (what `/speckit.plan` would have run — it writes the `AGENTS.md` appendix, which `backend/test/unit/docs/agents-router.test.ts` watches) and commit the result with the spec; `pnpm install --frozen-lockfile && pnpm run build:packages`
- [x] T002 Record the baseline: `pnpm --filter @endora-commerce/mod-carts run test`, `…/mod-catalog run test`, `…/mod-quote-requests run test`, and `[PG]` each file under `test/integration/carts/` and `test/integration/returns/`, one per invocation — note any pre-existing red in the PR description
  - **Baseline recorded 2026-10-16** on `feat/155-catalog-order-constraints` at `e2cc42b8d` (code = `origin/master` `39b9b9989`), macOS host, after `pnpm install --frozen-lockfile && pnpm run build:packages`; local stack Postgres 5432, Redis 6380, Meilisearch 7700. **No pre-existing red** — neither a genuine repo red nor a macOS-host gap.
    - `mod-carts` 2 files / 26 tests passed · `mod-catalog` 8 / 79 passed · `mod-quote-requests` 16 / 220 passed.
    - `[PG]` `test/integration/carts/` — 22 files, one per invocation, 79 tests passed, 0 failed.
    - `[PG]` `test/integration/returns/` — 15 test files (`helpers.ts` is not a test), one per invocation, 53 tests passed, 0 failed.

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts run test`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/docs/agents-router.test.ts`

Verified 2026-10-16: contracts 29 files / 538 tests passed; `mod-carts` typecheck clean; `agents-router.test.ts` 22 / 22 passed.

---

## Phase 2: [backend] Foundational — the rule and every HTTP shape (Principle II)

**Goal**: the pure rule, the bounds and every additive Zod shape exist with tests; every consumer
still compiles. Record and port **interface** changes land later, as the first task of the phase that
changes their producer (P4, P6, P7, P10, P12), so no phase leaves the tree uncompilable.

- [x] T003 [P] RED unit test for `order-minimums.ts` — every row of `data-model.md` §6, plus: a line with no product record → `product_unavailable`, counted nowhere (FR-037); ineligible types ignored; `minOrderQuantity` 1 ≡ none; vanished unit ⇒ no unit rule, pieces still counted; snapshot vs current base quantity; exempt lines counted, never flagged; output order = input order, pieces before unit for one line; `isValidOrderMinimum` accepts 1 and 1 000 000 and refuses 0, −1, 1.5, 1 000 001 [F5]; `minimumRefusal` (first line's code, every line in `details.lines` with `productName` and the caller's key, top-level `productName`/`minimum`/`packagingUnitName` of the first — SC-004, analyze F11); **performance**: 10 000 lines over 10 000 products evaluates within a generous bound (catches a quadratic regression) [F4] — `packages/contracts/src/order-minimums.test.ts`
- [x] T004 [P] RED schema test for the catalogue shapes — update-product accepts `minOrderQuantity` (1…1 000 000, `null`) and `returnable`, refuses 0, −1, 1.5, 1 000 001 [F5]; bulk fields accept `returnable` alone; packaging create/update accept `minOrderUnits` in the same range, refuse 1 000 001 and **still refuse an unknown key**; `packagingUnitSchema`, `productDetailSchema` (incl. `packagingUnits[].minOrderUnits`), `productSummarySchema` parse with and without the new keys — `packages/contracts/src/catalog-order-rules.test.ts`
- [x] T005 [P] RED schema test for cart/order/quick-order/list shapes — `cartViewLineSchema` `belowMinimum` + `minOrderQuantity` optional; `cartDroppedLineReasonSchema` has `below_minimum` and a dropped line may carry `minimum`; `orderPreviewTotalResponseSchema.belowMinimumLines` defaults to `[]` and accepts `kind: 'product_unavailable'` without `minimum`; `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` ends with `BELOW_MINIMUM_QUANTITY` and keeps the first four in order; `quickOrderRejectionReasonSchema` has `below_minimum`, a rejected row may carry `minimum` + `productTotal`, a recognised row may carry `warning`, the summary may carry `warningCount`; `quickOrderBuildResponseSchema.rejected` optional with `productName`; `conversionSkipSchema` `below_minimum` + `minimum`; **FR-038**: `QUICK_ORDER_BUILD_MAX_ITEMS` and `ADMIN_ORDER_MAX_ITEMS` are exported and equal 200, and `quickOrderBuildRequestSchema`, `adminCreateOrderRequestSchema`, `adminOrderPreviewRequestSchema` still **parse** 201 items (the bound is the services', so the refusal is a 422, not the schema's 400 — research R20) [F4] — `packages/contracts/src/order-minimum-shapes.test.ts`
- [x] T006 [P] RED schema test for quote/returns/comparison shapes — `createQuoteRequestLineSchema` accepts `packagingUnitId`; `createQuoteRequestSchema` **strips** a top-level or per-line `minimums` key (non-strict, M4) [S3]; `quoteRequestItemSchema` `minimumWarning` / `packagingUnitId` optional; `CreateForCustomerOptions` with `minimums: 'warn'` type-checks; `returnableLineSchema` `returnable` + `notReturnableReason`; `returnableResponseSchema.reason` has `no_returnable_lines`; `comparisonProductSummarySchema.minOrderQuantity` optional — `packages/contracts/src/quote-return-shapes.test.ts`
- [x] T007 Implement `order-minimums.ts` per `data-model.md` §5 (constants, `isValidOrderMinimum`, `evaluateOrderMinimums` — linear, `Map`-indexed —, `minimumRefusal`) with its own rule input types (not `Pick<>`s of records not yet extended); export from `packages/contracts/src/index.ts` — `packages/contracts/src/order-minimums.ts`
- [x] T008 Catalogue Zod additions per `contracts/catalog-api.md` §0–§4 (`packagingUnitSchema.minOrderUnits` is `.nullable().optional()` so `pim_pimcore` and the current DTO builder keep compiling) — `packages/contracts/src/catalog.ts`
- [x] T009 Cart and order Zod additions per `contracts/cart-and-checkout-api.md` §3, §8, §10 (incl. `ADMIN_ORDER_MAX_ITEMS`; no schema `.max()`) — `packages/contracts/src/carts.ts`, `packages/contracts/src/orders.ts`
- [x] T010 Quick-order and shopping-list Zod additions per `contracts/cart-and-checkout-api.md` §5–§6 (incl. `QUICK_ORDER_BUILD_MAX_ITEMS`; no schema `.max()`) — `packages/contracts/src/quick-order.ts`, `packages/contracts/src/shopping-lists.ts`
- [x] T011 Quote, returns and comparison additions per `contracts/quote-requests-api.md` §1, §3, §4 and `contracts/returns-api.md` §2 — `packages/contracts/src/quote-requests.ts`, `returns.ts`, `comparisons.ts`
- [x] T012 Build contracts; type-check the consumers by name (Verification). If a `Record<AdminOrderPreviewMessageCode, …>` or a reason union elsewhere becomes non-exhaustive, note the file for P14/P16 rather than editing UI here (measured: `OrderCreatePage.tsx` holds two constants, not a map)

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts exec vitest run src/order-minimums.test.ts`
- `pnpm --filter @endora-commerce/contracts exec vitest run src/catalog-order-rules.test.ts src/order-minimum-shapes.test.ts src/quote-return-shapes.test.ts`
- `pnpm --filter @endora-commerce/contracts run build`
- `pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`
- `pnpm --filter @endora-commerce/mod-quick-order run typecheck`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter backend run typecheck`
- `pnpm --filter admin run typecheck`
- `pnpm --filter storefront run typecheck`

Verified 2026-10-16: `order-minimums.test.ts` 51 / 51 passed; the three shape tests 62 / 62 passed; contracts build, typecheck and lint clean; `mod-orders`, `mod-quick-order`, `mod-carts`, `backend`, `admin`, `storefront` typecheck clean (also `mod-returns`, `mod-quote-requests`, `mod-catalog`). Full contracts suite 33 files / 651 tests passed after `orders.test.ts`'s pinned precedence gained `BELOW_MINIMUM_QUANTITY`. Deviation: `returnableLineSchema.returnable` is `.optional()` until P12a makes `getReturnable` emit it (`contracts/returns-api.md` §2 writes it required; required now would break `mod-returns`). Hand-mirrored unions left for the UI phases: `OrderCreatePage.tsx` `unavailableReasonKey` and `quick_order/src/admin/api/quick-order-client.ts` (P14); `storefront/lib/api/{cart,quick-order,shopping-lists}.ts`, `storefront/components/CartDroppedLinesBanner.tsx` (P16); `storefront/lib/api/returns.ts` (P17).

---

## Phase 3: [backend] Foundational — schema

**Goal**: three migrations, four entity extensions, registered (the `carts` exemption reads master's existing `cart_items.agreed_quantity`, `data-model.md` §2).

- [x] T013 [P] [PG] RED integration test: `products.min_order_quantity` null by default and refuses 0 and 1 000 001 (check constraint) [F5]; `products.returnable` is `false` for a row inserted without it (FR-004); `product_packaging_units.min_order_units` null by default and refuses 0 and 1 000 001 — `backend/test/integration/catalog/order-rules-schema.test.ts`
- [x] T014 [P] [PG] RED integration tests: `order_items.returnable_at_purchase` and `quote_request_items.packaging_unit_id` exist, nullable, `null` on rows inserted without them — `backend/test/integration/orders/returnable-at-purchase-schema.test.ts`, `backend/test/integration/quote_requests/packaging-unit-id-schema.test.ts` *(Revised 2026-10-18, rebase onto master: the `carts` column and its migration were dropped; the exemption reads master's `cart_items.agreed_quantity` — `data-model.md` §2, research R4.)* The `cart_items` schema test went with the column.
- [x] T015 Scaffold and fill `order_rules` per `data-model.md` §1 (`down` drops both checks and the three columns) — `pnpm --filter backend run migration:new -- --module catalog --name order_rules`
- [x] T016 ~~Scaffold and fill `cart_item_quote_seeded_quantity` per §2 — `--module carts`~~ — superseded: no `carts` migration. *(Revised 2026-10-18, rebase onto master: the `carts` column and its migration were dropped; the exemption reads master's `cart_items.agreed_quantity` — `data-model.md` §2, research R4.)*
- [x] T017 Scaffold and fill `order_item_returnable_at_purchase` per §3 — `--module orders`
- [x] T018 Scaffold and fill `item_packaging_unit_id` per §4 — `--module quote_requests`
- [x] T019 [P] Entity properties (each added to `[OptionalProps]`, doc comment citing the FR) — `packages/modules/catalog/src/backend/entities/product.entity.ts` (`minOrderQuantity`, `returnable`), `product-packaging-unit.entity.ts` (`minOrderUnits`), `packages/modules/carts/src/backend/entities/cart-item.entity.ts` (none — the existing `agreedQuantity` is read, its doc comment cites FR-028), `packages/modules/orders/src/backend/entities/order-item.entity.ts` (`returnableAtPurchase`), `packages/modules/quote_requests/src/backend/entities/quote-request-item.entity.ts` (`packagingUnitId`)
- [x] T020 Regenerate and commit artefacts: `composer:generate` (`backend/src/db/migrations-registry.generated.ts`, `entities-registry.generated.ts`, and any module-reference page with its Polish cache entry and mirror), `manifests:generate`, `pnpm install --lockfile-only`
- [x] T021 Run the schema tests and the registry/graph tests; `db:fresh` on a scratch database applies all three

**Verification** (one invocation per line):
- `[PG] pnpm exec vitest run test/integration/catalog/order-rules-schema.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/returnable-at-purchase-schema.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/packaging-unit-id-schema.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts test/unit/db/fk-dependency-drift.test.ts test/unit/db/module-graph.test.ts`
- `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts`

---

## Phase 4: [backend] Catalogue read port and records (R7)

**Goal**: every consumer can read minimums, the flag and a product set's packaging units.

- [x] T022 [P] RED type-level contract test: a `CatalogProductRecord` literal without `minOrderQuantity`/`returnable` fails to compile (`// @ts-expect-error`), `CatalogPackagingUnitRecord` requires `minOrderUnits`, `CatalogProductReadPort` requires `listPackagingUnitsByProductIds` — `packages/contracts/src/catalog-order-rules.test.ts` (extend)
- [x] T023 [P] [PG] RED integration test: `catalogProductReadPort.findById` / `findByIds` carry `minOrderQuantity` and `returnable`; `findPackagingUnitInProduct` carries `minOrderUnits`; `listPackagingUnitsByProductIds([b, a, unknown])` answers both products' units ordered by product id, position, name, nothing for the unknown id, `[]` for `[]` — `backend/test/integration/catalog/read-port-order-rules.test.ts`
- [x] T024 Add the record fields and the port method per `contracts/catalog-api.md` §5, **with the doc comment stating that callers pass only vetted product ids** [F12] — `packages/contracts/src/catalog.ts`
- [x] T025 Implement the mapping and `listPackagingUnitsByProductIds` (one query, `productId: { $in }`, the documented order) — `packages/modules/catalog/src/backend/services/catalog-product-read.service.ts`
- [x] T026 Fix the typed literals the change reds, found with the per-package typecheck — measured on `39b9b9989`: port literals in `backend/test/integration/promotions/attribute-criterion-resolution.test.ts`, `backend/test/unit/comparisons/cross-module-ports.test.ts`, `backend/test/unit/comparisons/viewer-priced-columns.test.ts`; record literals in `backend/test/unit/comparisons/{base-image-comes-from-catalog,cross-module-ports,viewer-priced-columns}.test.ts`, `backend/test/unit/search/indexer-sql-boundary.test.ts`, `backend/test/unit/seo/cross-module-ports.test.ts`, `backend/test/unit/shopping_lists/cross-module-ports.test.ts`, `packages/modules/search/src/backend/services/cross-module-ports.test.ts` — add the fields with neutral values (`null`, `false`, `async () => []`), no behaviour change
- [x] T027 Build `contracts`, `mod-catalog`; run the port checks (plan I2)

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/contracts exec vitest run src/catalog-order-rules.test.ts`
- `[PG] pnpm exec vitest run test/integration/catalog/read-port-order-rules.test.ts`
- `pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `pnpm --filter @endora-commerce/mod-search run typecheck`
- `pnpm --filter backend run typecheck`
- `pnpm --filter backend run check:port-shape`
- `pnpm --filter backend run check:port-dependencies`

---

## Phase 5: [backend] US1 / US2 / US5 — catalogue writes, storefront DTOs, catalogue error codes (FR-001 – FR-005, FR-014/016 data)

**Goal**: operators can set, clear and audit both minimums and the flag, within range on every write
path; the storefront DTOs carry the minimums; the three catalogue-owned codes exist.

- [x] T028 [P] [US1] [US5] [PG] RED contract test: `PATCH /api/v1/admin/catalog/products/:id` sets and clears `minOrderQuantity`, refuses 0 / 1.5 / 1 000 001 [F5] and a non-null value on a bundle (`422 VALIDATION_FAILED`, `details.field`) [D5]; **`POST` create with a non-null minimum on a bundle is refused the same way** [D5, analyze F14]; sets `returnable` on simple, configurable, grouped, bundle, virtual; admin GET returns both; an untouched pre-existing product reads `returnable: false` (US5 #3); the Command's audit `before`/`after` carry both keys (FR-005); **bulk** `POST …/bulk-update` with `{ returnable: true }` over **200** products succeeds in one request, each `changedFields` naming `returnable` (US5 #4, SC-005), and writes **one `product.update` audit row per product whose `stateBefore.returnable` / `stateAfter.returnable` are the old and new value**, plus the summary row (FR-003, analyze F3) — on the synchronous path and on the queued path, whose undo restores `returnable`; **after a minimum and the flag change, an existing cart line, order line, quote-request line and return-case line seeded beforehand are byte-for-byte unchanged** (FR-005, analyze F9) — `backend/test/contract/catalog/product-order-rules.test.ts`
- [x] T029 [P] [US2] [PG] RED contract test: packaging-unit create/update with and without `minOrderUnits`; `null` clears; 0 and 1 000 001 refused through the route; an unknown key still refused (strict); response carries `minOrderUnits`; audit `before`/`after` carry it; a `CatalogPackagingPort.create` call without the key (the `pim_pimcore` shape) still works (FR-002); **a `CatalogPackagingPort.create`/`update` call with `minOrderUnits` 0 or 1 000 001 is refused `422 VALIDATION_FAILED` by the service** (no route schema in the way) [F5] — `backend/test/contract/catalog/packaging-unit-minimum.test.ts`
- [x] T030 [P] [US1] [US2] [PG] RED contract test: `GET /api/v1/catalog/products/:slug` carries `minOrderQuantity` (`null` for a bundle even when stored) and `packagingUnits[].minOrderUnits`; the list and a search hit carry `minOrderQuantity`; a comparison's products carry it — `backend/test/contract/catalog/storefront-minimum-dto.test.ts`
- [x] T031 [US1] [US5] Implement the product write: range check with `isValidOrderMinimum` in the service, the type rule on create and update (D5), assignment, `changedFields`, and both keys in `stateBefore`/`stateAfter`; `serializeAdminProduct` adds both — `packages/modules/catalog/src/backend/services/catalog-admin.service.ts`, `src/backend/routes.admin.ts`
- [x] T032 [US2] Implement `minOrderUnits` in create/update (service-level range check) /`before`/`after`/`#dto` — `packages/modules/catalog/src/backend/services/packaging-unit.service.ts`
- [x] T033 [US5] Bulk edit passes `returnable` through `applyToOneProduct` (and the "nothing else to do" skip condition counts it); the per-product audit comes from the legacy `updateProduct` unchanged — `packages/modules/catalog/src/backend/services/catalog-bulk-update.service.ts`
- [x] T034 [US1] [US2] Storefront projections: catalogue detail + list (eligible types only), search hit projection, comparison summary — `packages/modules/catalog/src/backend/services/catalog-query.service.ts` (or the detail/list builder it delegates to), `packages/modules/search/src/backend/services/search-query.service.ts`, `packages/modules/comparisons/src/backend/services/comparison-service.ts`
- [x] T035 Mint `PRODUCT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_MISMATCH` **in one commit**: `ERROR_CODES`, three `MINTED_ERROR_CODES` entries (`to: 'catalog'`, reason: noun rule D-121 T1, raisers named), catalogue manifest `errorCodes` (re-derive the comment's count), `errors.*` in both bundles per `contracts/error-codes.md` (sentences name the product; the mismatch sentence names the line number); `composer:generate` and the Polish module-reference cache entry and mirror if the catalogue page moved — `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `packages/modules/catalog/src/manifest.ts`, `packages/modules/catalog/i18n/{en,pl}.json`
- [x] T036 Build `mod-catalog`, `mod-search`, `mod-comparisons`; run the error and command checks; **threat F13**: confirm no unaudited writer sets the new fields — the grep in Verification must show writes only in `catalog-admin.service.ts` (`#applyProductUpdate`, create) and `packaging-unit.service.ts`; a hit in a `pim_*` module, a product clone/duplicate path or a seed/sync service means routing that write through the audited service (or recording why it is exempt) before the phase closes

**Verification** (one invocation per line):
- `[PG] pnpm exec vitest run test/contract/catalog/product-order-rules.test.ts`
- `[PG] pnpm exec vitest run test/contract/catalog/packaging-unit-minimum.test.ts`
- `[PG] pnpm exec vitest run test/contract/catalog/storefront-minimum-dto.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/error-code-routing-equality.test.ts test/unit/_i18n/registered-bundles-shape.test.ts`
- `pnpm --filter backend run check:error-translations`
- `pnpm --filter backend run check:bundle-pairing`
- `pnpm --filter backend run check:command-coverage -- --strict`
- `pnpm --filter backend run check:docs-translations`
- `pnpm --filter @endora-commerce/mod-catalog run test`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`
- `git grep -nE "(minOrderQuantity|minOrderUnits|returnable)[[:space:]]*[:=]" -- 'packages/modules/*/src/backend/**' ':!**/*.test.ts' ':!packages/modules/returns' ':!packages/modules/orders'` (F13 — review every hit as T036 describes)

Verified 2026-10-16: `product-order-rules.test.ts` 23 / 23, `packaging-unit-minimum.test.ts` 9 / 9, `storefront-minimum-dto.test.ts` 7 / 7 (each `[PG]`, one per invocation); routing-equality + bundle-shape 86 / 86; `check:error-translations`, `check:bundle-pairing`, `check:command-coverage -- --strict`, `check:docs-translations` clean; `mod-catalog` 8 files / 79 tests, typecheck clean (also `contracts`, `mod-search`, `mod-comparisons`, `backend` typecheck; `backend` lint clean); `openapi-baseline.test.ts` still green. `composer:generate` and `manifests:generate` moved no artefact. **F13**: the line above uses the POSIX class `[[:space:]]` (macOS `git grep -E` reads `\s` literally and would miss `x = y` assignments). Every write of the three fields is in `catalog-admin.service.ts` (create, `#applyProductUpdate`), `packaging-unit.service.ts` (create, update) and `catalog-bulk-update.service.ts` (`partial.returnable`, which feeds the audited legacy `updateProduct`); the remaining hits are reads/projections (audit snapshots, DTOs, read port, search, comparisons). No `pim_*`, seed or sync writer sets them; `CatalogProductWritePort` delegates to the audited service; the bulk undo restores `returnable` inside its `product.bulk_update.undo` Command. `duplicateProduct` copies neither field (the duplicate starts with no minimum and `returnable: false`) — no unaudited write, recorded as an open product question. Added `isOrderMinimumEligibleType` to `order-minimums.ts` so the write rule and the three projections share one predicate. The packaging-unit routes also write a bare `product_packaging_unit` audit row beside the Command's (pre-existing double audit, not changed here).

---

## Phase 6: [backend] US1 / US2 / US3 / US4 — cart single add, edit, view, exemption (FR-006a, FR-006, FR-007, FR-013, FR-028, FR-037)

**Goal**: the storefront and API add/edit paths enforce the rule; the cart view flags lines; quote
lines are exempt while their quantity equals the quote's; add's preconditions live in one resolver.

- [x] T037 [P] RED contract test: `CartItemRecord.quoteSeededQuantity` required (type-level) and `isQuoteSeededLineExempt` truth table (`data-model.md` §2) — `packages/contracts/src/order-minimum-shapes.test.ts` (extend)
- [x] T038 [P] [US1] RED unit test for the cart's prospective-lines builder: add bumps the matching `(product, variant, unit)` line or appends a `new` key; edit replaces one quantity; exemption from the predicate; the touched key is the one judged; a missing record yields `product_unavailable` for the touched line — `packages/modules/carts/src/backend/services/cart-minimums.test.ts`
- [x] T039 [P] [US1] [US2] [US3] [PG] RED integration test: US1 #3, #4, #6; US2 #3, #4, #5, #6, #7; US3 #1–#5; edit to 0 and `DELETE` always succeed (FR-007); a hidden product below its minimum answers the unchanged `404` (S2); a refused add makes **no** `price_lists` call (spy on the port); the refusal's message names the product and the minimum, in Polish with `Accept-Language: pl` and English otherwise (plan I1, FR-006, SC-004); **FR-037**: an edit of a line whose product row was removed answers `404 PRODUCT_NOT_FOUND` with no name and leaves the line unchanged — `backend/test/integration/carts/minimums.test.ts`
- [x] T040 [P] [US4] [PG] RED integration test, FR-028: seed through `replaceItemsForCustomer` with a source → lines exempt; US4 #7 (checkout of A × 5 places), #7a, #7b, #7c; **#7d state-based: 5 → 12 succeeds and is no longer exempt, 12 → 5 succeeds and is exempt again, 5 → 6 refused** (P2); bump makes the line non-exempt while it differs; login merge likewise; reorder seed (no source) exempts nothing; a later seed replaces exemptions; only `replaceItemsForCustomer` writes `agreed_quantity` (plan I4: assert with `git grep` in the test's comment and with a row read) [S4] — `backend/test/integration/carts/quote-seeded-exemption.test.ts`
- [x] T041 [P] [US1] [PG] RED contract test: `GET /api/v1/cart` lines carry `minOrderQuantity` and `belowMinimum` (a line below after the minimum was raised — US1 #5 first half; an exempt line `null`); a line whose product row was removed is `unavailable: true`, `unavailableReason: 'not_purchasable'`, `belowMinimum: null` (FR-037); a catalogue read failure (stubbed port) answers `5xx`, not a cart without flags (D7); `?view=mini` unchanged — `backend/test/contract/carts/cart-view-minimums.test.ts`
- [x] T042 Add `quoteSeededQuantity` (mapped from the entity's `agreedQuantity`) to `CartItemRecord` and `isQuoteSeededLineExempt` per `data-model.md` §2 — `packages/contracts/src/carts.ts`
- [x] T043 [US1] Extract `addItem`'s preconditions (`cart-service.ts:221–289`) into `#resolveLine(actor, input)` with **no behaviour change** (the existing add-item suites in Verification prove it) [F1]; implement `cart-minimums.ts` (builder + one `listPackagingUnitsByProductIds` over vetted ids + `evaluateOrderMinimums` + `minimumRefusal`) and call it in `addItem` after `#resolveLine` and before `#resolveLineUnitPrice`, and in `updateItem` for `quantity ≥ 1` — `packages/modules/carts/src/backend/services/cart-minimums.ts`, `cart-service.ts`
- [x] T044 [US4] `replaceItemsForCustomer` writes `agreed_quantity` (master's column) when `options.sourceQuoteRequestId` is set; `toCartItemRecord` maps it to the record's `quoteSeededQuantity` — `packages/modules/carts/src/backend/services/cart-read-port.ts` (placement's `cart-placement-apply-port.ts:52` reuses `toCartItemRecord`, measured, so the placement read carries the field with no second mapper)
- [x] T045 [US1] Cart full view: per-line `minOrderQuantity`, `belowMinimum` and the FR-037 `unavailable` mapping, evaluated outside the view's tolerant `catch`es (R11, D7) — `packages/modules/carts/src/backend/routes.ts`
- [x] T046 Build `contracts`, `mod-carts`; port-catch and command checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-carts exec vitest run src/backend/services/cart-minimums.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/minimums.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/quote-seeded-exemption.test.ts`
- `[PG] pnpm exec vitest run test/contract/carts/cart-view-minimums.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/add-item-failure-modes.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/add-item-channel-assortment.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/cart-line-refusal-codes.test.ts`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter backend run check:command-coverage -- --strict`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`

---

## Phase 7: [backend] US4 — cart batch add and conversions (FR-011, FR-035, FR-026 cart side) [D1]

**Goal**: one resolve-then-judge batch for every batch path; a hidden product is indistinguishable
from an unknown id; quote → cart reports minimums distinctly; cart → quote sends the unit id.

- [x] T047 [P] RED type-level test for `CartWritePort.addItems`, `CartBatchLineInput`, `CartBatchLineOutcome` — `packages/contracts/src/order-minimum-shapes.test.ts` (extend)
- [x] T048 [P] [US4] RED unit test for the batch: **resolution first** — a hidden, out-of-channel or unknown product and an unknown packaging unit each get `failed` with the same 404 an unknown id gets, no `productName`, no `minimum`, and count toward no total; with `'throw'` the first resolution failure is thrown **before anything is written** [F1]; **two passes** — split variants A-red 5 + A-blue 5 (min 10) both added [D1]; A-red 5 + A-blue 3 both `below_minimum`; a rejected pallet line lowers the pieces total and pass 2 rejects the piece lines too; existing below-minimum cart lines never rejected; exempt lines count; outcomes in input order; `'throw'` rethrows a step-3 refusal with earlier lines added, `'report'` returns `failed`; `ModuleDisabledError` always rethrown; **performance**: 200 batch lines against a 200-line cart within a generous bound [F4] — `packages/modules/carts/src/backend/services/cart-batch-add.test.ts`
- [x] T049 [P] [US4] [PG] RED contract test, quote → cart: a request line below its minimum is dropped with `reason: 'below_minimum'` and `minimum`, never `no_price_in_customer_list` (US4 #8); a quote-only line keeps `no_price_in_customer_list`; split variants summing to the minimum are both appended; **a line whose product is now hidden from the buyer (minimum 10, quantity 5) is dropped as `not_purchasable` exactly like an unknown product — no `minimum`** [F1, FR-035, US4 #16] — extend `backend/test/contract/carts/cart-conversions.contract.test.ts`
- [x] T050 [P] [US4] RED unit test for the cart → quote call shape: a packaging line sends `packagingUnitId` and no name/base when the unit exists; a line whose unit was deleted is sent as plain pieces with its quantity unchanged (US4 #11) — extend `backend/test/unit/carts/cross-module-ports.unit.test.ts`
- [x] T051 Add `addItems` and the batch types to `CartWritePort` per `contracts/cart-and-checkout-api.md` §4 — `packages/contracts/src/carts.ts`
- [x] T052 [US4] Implement `CartService.addItems` (resolve every line through `#resolveLine`, one cart read, two-pass evaluation, internal add with the minimum already decided, per-line outcomes, at most `CART_MAX_LINES` lines) and the port adapter; mark the write with its `command-coverage-ignore` reason like `addItem` — `packages/modules/carts/src/backend/services/cart-service.ts`, `cart-read-port.ts`
- [x] T052a [US4] Bring the test doubles of `CartWritePort` and their callers in line (analyze F10). **Measured expectation**: none of the five files reds the type-check — `backend/test/unit/orders/inline-address-cleanup-presence.test.ts` and `backend/test/unit/shopping_lists/cross-module-ports.test.ts` cast with `as unknown as`, `packages/modules/quick_order/src/backend/services/one-click-service.test.ts` with `{} as` / `as unknown as`, and `backend/test/contract/orders/admin-create-sales-channel-edges.test.ts` / `backend/test/integration/carts/seed-bookkeeping.test.ts` stub nothing (they use the real port). What breaks is **behaviour**: a double that stubs only `addItem` fails at runtime once its service calls `addItems` (admin create in `inline-address-cleanup-presence`, list → cart in `shopping_lists/cross-module-ports`), and `OneClickService` gains a constructor argument (P9). Add `addItems` to those doubles and re-run the two real-port files. Re-derive the population first: `git grep -n "CartWritePort" -- backend/test 'packages/modules/*/src/**/*.test.ts'` and `git grep -n ": CartWritePort =\|satisfies CartWritePort"`
- [x] T053 [US4] `createCartFromQuoteRequest` via `addItems(…, { onLineError: 'report' })`, mapping `below_minimum`, a `failed` 404 → `not_purchasable`, any other `failed` → `no_price_in_customer_list` (R12.5) — `packages/modules/carts/src/backend/services/cart-conversion-service.ts`
- [x] T054 [US4] `convertToQuoteRequest`: one `listPackagingUnitsByProductIds` over the cart's own lines; send `packagingUnitId` for a live unit, plain pieces otherwise; stop sending name and base quantity — same file
- [x] T055 Build; checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-carts exec vitest run src/backend/services/cart-batch-add.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/carts/cross-module-ports.unit.test.ts test/unit/orders/inline-address-cleanup-presence.test.ts test/unit/shopping_lists/cross-module-ports.test.ts`
- `[PG] pnpm exec vitest run test/contract/carts/cart-conversions.contract.test.ts`
- `[PG] pnpm exec vitest run test/contract/carts/cart-conversions-happy.contract.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/seed-bookkeeping.test.ts`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter @endora-commerce/contracts run typecheck`
- `pnpm --filter @endora-commerce/mod-carts run typecheck`
- `pnpm --filter backend run typecheck`

---

## Phase 8: [backend] US1 / US4 — placement and the checkout preview (FR-008, FR-036, FR-037) [F2, F3]

**Goal**: nothing below a minimum can be placed; a quote line is exempt only while its quote source is
confirmed valid; the check runs before the first side effect.

- [x] T056 [P] [US1] [US4] [PG] RED integration test: placement refuses a basket with a line below a minimum (US1 #5, US2 #7) with the first line's code, a message naming that product and its minimum, and every line (with `productName`, `cartItemId`) in `details.lines`; a reorder of A × 5 seeds, flags and is refused at placement (US4 #4); an accepted-quote basket with an unchanged A × 5 places (US4 #7); **the refusal happens before any side effect: `stock_levels.reserved` unchanged, no business id consumed, no order row** [F3]; **a direct `OrderPlacementPort.placeOrder` call** with a below-minimum basket is refused (port entry point) [F3]; **FR-037**: a basket line whose product row was removed → `404 PRODUCT_NOT_FOUND`, `details.cartItemIds`, nothing written; `POST /api/v1/orders/preview-total` lists the same lines in `belowMinimumLines` (the removed product as `product_unavailable`, no name) and `[]` for a valid basket — `backend/test/integration/orders/place-order-minimums.test.ts`
- [x] T056a [P] [US4] [PG] RED integration test, FR-036 (US4 #7e) [F2]: a basket seeded from an accepted quote with A × 5 (A minimum 10) places while the quote is valid; **then, each from a fresh seed**: the quote cancelled after conversion → the preview flags A and placement refuses it; `expires_at` moved into the past → refused; two baskets of one quote (the buyer and the organization's administrator both convert) — the first places, the second is refused below the minimum; every seeded line removed and replaced by a price-list line of A × 5 (no agreed line left) → refused; in each refused case the cart view still shows A as exempt (the deliberate face-value gap, FR-028) — `backend/test/integration/orders/place-order-quote-source-exemption.test.ts`
- [x] T056b [P] [US4] [PG] RED-then-green: with `quote_requests` switched off, a seeded A × 5 basket is flagged by the preview and refused at placement (no source can be vouched, R17); switching it back on restores the exemption — extend `backend/test/integration/quote_requests/off-state.test.ts`
- [x] T056c [P] [US4] RED unit test for the pure `quoteSourceHonoursExemptions(judged, quoteRequest, now)`: judge accepted × `expiresAt` null / past / future; every judge refusal (`not-found`, `other-organization`, `not-convertible`, `already-ordered`, `no-agreed-line`) → false — `packages/modules/orders/src/backend/domain/quote-source-exemption.test.ts`
- [x] T059 [US1] Placement per research R19: hoist one `findByIds` + `listPackagingUnitsByProductIds` over the basket to right after the empty-basket check and reuse it for totals (`order-service.ts:1726` stops reading again) and later for the stamp; then the vouch (T059a); then `evaluateOrderMinimums` with the honoured exemptions — `product_unavailable` → `404 PRODUCT_NOT_FOUND` `details.cartItemIds`, a minimum violation → `minimumRefusal(…, 'cartItemId')` — all **before** the value gate, the business id, stock and credit — `packages/modules/orders/src/backend/services/order-service.ts`
- [x] T059a [US4] Move `#vouchedQuoteRequestSource` (with its advisory lock) up to right after the product read; return `{ sourceQuoteRequestId, quoteRequest }`; reuse the answer for the stamp at `:1777` (no second call); add `domain/quote-source-exemption.ts` (`quoteSourceHonoursExemptions`, the `expiresAt` rule restated beside `judgeQuoteRequestSource`) — `order-service.ts`, `packages/modules/orders/src/backend/domain/quote-source-exemption.ts`
- [x] T060 [US1] `previewTotal`: the read-only quote-source assessment (same port reads and judge, `Order` count on an `emFactory()` fork of `orders`' own table, no lock) and `belowMinimumLines`; the route returns it — `order-service.ts`, `packages/modules/orders/src/backend/routes.ts`
- [x] T063 Build `mod-orders`; checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-orders exec vitest run src/backend/domain/quote-source-exemption.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/place-order-minimums.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/place-order-quote-source-exemption.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/place-order-from-quote-request.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/place-order-failure-preserves-cart.test.ts`
- `pnpm --filter @endora-commerce/mod-orders run test`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter backend run check:transaction-context`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`

---

## Phase 8a: [backend] US4 — admin create, API intake, admin preview, bounds (FR-009, FR-035, FR-038) [F1, F3, F4]

**Goal**: admin create and API intake refuse below-minimum lines through the batch and are backed by
placement; oversized requests are refused whole.

- [x] T057 [P] [US4] [PG] RED integration test: admin create with A × 5 refused with the minimum message (US4 #6); A-red × 5 + A-blue × 5 accepted [D1]; a product hidden from the customer acted for (minimum 10, × 5) → the same `404` as an unknown id, no name or minimum [F1, US4 #16]; **placement backstop**: with the batch step wrapped by a test double that admits every line, the same request is still refused — by `placeOrder` [F3]; the same four cases on API intake — `backend/test/integration/orders/admin-create-minimums.test.ts`, `backend/test/contract/orders/api-intake-minimums.test.ts`
- [x] T057a [P] [US4] [PG] RED contract test, FR-038 (US4 #17): `POST /api/v1/admin/orders` and `POST /api/v1/admin/orders/preview` with 201 items → `422 VALIDATION_FAILED` with `details.code: 'too_many_items'` and `maximum: 200` (not the schema's 400), and no catalogue read happens (spy); 200 items pass the bound — `backend/test/contract/orders/admin-order-bounds.test.ts`
- [x] T058 [P] [US4] [PG] RED contract test: admin preview marks a below-minimum line `BELOW_MINIMUM_QUANTITY` with `minimum`; a hidden + below-minimum line keeps `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` and carries **no** `minimum` (precedence, FR-035) — extend `backend/test/contract/orders/admin-order-preview-availability.test.ts`
- [x] T061 [US4] Admin create and API intake build their transient basket with `addItems(…, { onLineError: 'throw' })` and refuse on any `below_minimum` with `minimumRefusal(…, 'index')`; admin create and the admin preview handler refuse more than `ADMIN_ORDER_MAX_ITEMS` items as their first step (`422 VALIDATION_FAILED`, `too_many_items`) — `packages/modules/orders/src/backend/services/order-creation-admin-service.ts`, `order-api-intake-service.ts`
- [x] T062 [US4] Admin preview message `BELOW_MINIMUM_QUANTITY` (after the existing four; evaluated only on lines that passed them) — `packages/modules/orders/src/backend/routes.ts` (preview handler), `services/preview-line-availability.ts` if the step belongs there
- [x] T063a Build `mod-orders`; checks
- [x] T063b [US4] **In scope — owner ruling 2026-10-16.** RED-then-green: `POST` API order intake with 201 lines → `422 VALIDATION_FAILED` `too_many_items`, `maximum: 200`, nothing resolved or added; 200 pass the bound. Implement the bound as the first statement of the intake service (`ADMIN_ORDER_MAX_ITEMS` reused, or a sibling constant in contracts); add the breaking-behaviour note to the `mod-orders` changeset — `backend/test/contract/orders/api-intake-minimums.test.ts` (extend), `packages/modules/orders/src/backend/services/order-api-intake-service.ts`

**Verification** (one invocation per line):
- `[PG] pnpm exec vitest run test/integration/orders/admin-create-minimums.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/api-intake-minimums.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/admin-order-bounds.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/admin-order-preview-availability.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/admin-create-sales-channel-edges.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/admin-create-sales-channel.test.ts`
- `pnpm --filter @endora-commerce/mod-orders run test`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`

---

## Phase 9: [backend] US4 — quick order and shopping lists (FR-010, FR-011, FR-035, FR-038)

**Goal**: preview, build, one-click and list → cart report or apply minimums; the preview judges file
totals; the operator's preview warns.

- [x] T064 [P] [US4] RED unit test for the import preview (P1): the product's total across the file, all variants summed after the merge — A-red 4 + A-blue 6 (min 10) both recognised, A-red 4 + A-blue 3 both rejected `below_minimum` with `minimum` 10 and `productTotal` 7 (US4 #1c); rows rejected for an existing reason count toward no total; **buyer audience** rejects, **unrestricted (operator) audience** keeps the rows recognised with `warning` and counts `warningCount` (US4 #1d); summary counts follow; the resolved `maxRows` is clamped to 10 000 [F4] — extend `packages/modules/quick_order/src/backend/services/import-pipeline.test.ts`
- [x] T065 [P] [US4] RED unit test: one-click without a quantity uses the product's minimum for simple/configurable, **1 for a bundle with a stored minimum** (type filter, analyze F14), 1 with no minimum, and passes an explicit quantity through — extend `packages/modules/quick_order/src/backend/services/one-click-service.test.ts`
- [x] T066 [P] [US4] RED unit test for the build service: target `cart` maps `below_minimum` outcomes to `rejected[]` (with `productName`) and passes `onLineError: 'throw'` — for the buyer **and** for the operator (US4 #1d, cart still rejects); target `quote_request` passes `minimums: 'warn'` only when the actor is `operator`; more than 200 items refused `422 VALIDATION_FAILED` `too_many_items` before any port call [F4] — `packages/modules/quick_order/src/backend/services/quick-order-build-service.test.ts`
- [x] T067 [P] [US4] [PG] RED contract tests: US4 #1 (A × 5 + D × 1 → D added, A rejected with 10); #1a (buyer import rejects A × 5); #1b (cart holds A × 8, preview rejects A × 5, build adds it); #1c (variants summed across the file); #1d (operator import keeps A × 5 buildable with a warning; operator build to the customer's cart rejects it — the quote half is T084); #2 (one-click orders 10; one-click with an explicit 5 is refused by the add path); **one-click placement backstop**: with `cartWritePort.addItem` wrapped by a test double that admits the line unchecked, one-click of A × 5 is still refused — by `placeOrder` [F3]; #16 (a hidden product in a build → the same 404 as an unknown id, and **nothing** added from the batch [F1]); #17 (201 items → 422 `too_many_items`, nothing added) — extend `backend/test/contract/quick_order/build.test.ts`, `admin-build.test.ts`, `csv-import.test.ts`, `one-click-place.test.ts`
- [x] T068 [P] [US4] [PG] RED contract test: list → cart with A × 5 and D × 1 adds D and skips A with `below_minimum` and `minimum` (US4 #3), through both `POST /api/v1/shopping-lists/:id/convert-to-cart` and `POST /api/v1/cart/from-shopping-list/:id`; **a list line whose product is now hidden is skipped `product_not_found` exactly like a deleted product, with no `minimum`** [F1, US4 #16] — extend `backend/test/contract/shopping_lists/crud-and-convert.test.ts`
- [x] T069 [US4] Import pipeline: one evaluation over all recognised rows after the merge (records it already loads through `catalog-lookup.ts`); buyer audience → `rejected`, unrestricted audience → `warning`; clamp `import_max_rows` at read — `packages/modules/quick_order/src/backend/services/import-pipeline.ts`, `src/backend/index.ts`
- [x] T070 [US4] Build service: `addItems` for target `cart`, `rejected[]` in the response; an `actor` option forwarding `minimums: 'warn'` on the quote target; the item bound as the first statement; the admin route passes `actor: 'operator'` as a literal, never from the body (threat F10) — `packages/modules/quick_order/src/backend/services/quick-order-build-service.ts`, `src/backend/routes.admin.ts`
- [x] T071 [US4] One-click default quantity via `catalogProductReadPort` with the type filter; `OneClickService` gains the port as a constructor argument (update its composition) — `packages/modules/quick_order/src/backend/services/one-click-service.ts`, `src/backend/index.ts`
- [x] T072 [US4] `convertToCart` via `addItems(…, { onLineError: 'report' })`: `below_minimum` → skip with `minimum`; a `failed` 404 → skip `product_not_found`; any other `failed` → rethrown, as `addItem` threw it before — `packages/modules/shopping_lists/src/backend/services/shopping-list-service.ts`
- [x] T073 Build `mod-quick-order`, `mod-shopping-lists`; checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-quick-order exec vitest run src/backend/services`
- `[PG] pnpm exec vitest run test/contract/quick_order/build.test.ts`
- `[PG] pnpm exec vitest run test/contract/quick_order/admin-build.test.ts`
- `[PG] pnpm exec vitest run test/contract/quick_order/csv-import.test.ts`
- `[PG] pnpm exec vitest run test/contract/quick_order/one-click-place.test.ts`
- `[PG] pnpm exec vitest run test/contract/shopping_lists/crud-and-convert.test.ts`
- `pnpm --filter backend run check:port-dependencies`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter @endora-commerce/mod-quick-order run typecheck`
- `pnpm --filter @endora-commerce/mod-shopping-lists run typecheck`

---

## Phase 10: [backend] US4 — quote requests: packaging resolution and buyer checks (FR-012, FR-026, FR-027, FR-029, FR-031)

**Goal**: buyer quote writes validate packaging and refuse below-minimum lines, before pricing,
writing nothing.

- [x] T074 [P] RED type-level test: `QuoteRequestLineRecord.packagingUnitId` optional — `packages/contracts/src/quote-return-shapes.test.ts` (extend)
- [x] T075 [P] [US4] RED unit test for `resolveLinePackaging`: every row of `contracts/quote-requests-api.md` §1; id wins over name/base; **an unknown id, a deleted unit's id and another product's unit id all give the single reason `unknown_unit`** (the distinction only reaches the logger) [F6]; all failures listed — `packages/modules/quote_requests/src/backend/services/packaging-resolution.test.ts`
- [x] T076 [P] [US4] RED unit test for the quote line builder: keys = indexes; resolved unit id and snapshot base; FR-031 (b) exemption exactly when `pairLines` pairs and `referenceInputsUnchanged` holds; resubmit lines pieces-only, no exemption — `packages/modules/quote_requests/src/backend/services/quote-minimums.test.ts`
- [x] T077 [P] [US4] [PG] RED integration test, FR-026/FR-027: US4 #10 (id → catalogue values stored whatever else was sent; name + base 64 accepted; base 50 or an unknown name → 422 `PACKAGING_UNIT_MISMATCH` naming the line number and product, nothing written) [S5]; another product's unit id and a random id give the identical body [F6]; a hidden product's line → 404 first [S2]; US4 #11 (cart → quote with a deleted unit → plain pieces); a pallet minimum counted over the request's lines in that unit; **analyze F14: admin `modify` carries the stored `packagingUnitId` of a paired line; the customer `GET /api/v1/quote-requests/:id` and `listItems` expose `packagingUnitId`** — `backend/test/integration/quote_requests/packaging-units.test.ts`
- [x] T078 [P] [US4] [PG] RED integration test, FR-012/FR-029/FR-031: US4 #5 for direct, cart, quick order and shopping-list submissions; #5a buyer clone refused; #5b accept a representative's below-minimum revision; #5c unchanged line survives a draft edit, a change to 6 is refused; #5d resubmit refused; every refusal's message names the product and the minimum and `details.lines[]` carry `productName` (SC-004, analyze F11); a locked buyer's price proposal is refused with `RFQ_PRICE_PROPOSAL_NOT_ALLOWED` first; a hidden product → 404 first [S2]; a refusal makes no `buyerLinePricePort` call and writes no row, event or revision; a body carrying `minimums: 'warn'` (top level and per line) is still refused [S3] — `backend/test/integration/quote_requests/minimums.test.ts`
- [x] T079 Add `packagingUnitId` to `QuoteRequestLineRecord` — `packages/contracts/src/quote-requests.ts`
- [x] T080 [US4] Implement `packaging-resolution.ts` and `quote-minimums.ts`; wire them into `createForCustomer` (after `:327–337`, before `:344`), `patchDraft` (after the pairing, before pricing; pairing reads the resolved name) and `resubmit` (before `:667`); `listPackagingUnitsByProductIds` only over the ids `#acquirableProductsById` vetted [F12]; honour `options.minimums` — `packages/modules/quote_requests/src/backend/services/{packaging-resolution,quote-minimums,rfq-service}.ts`
- [x] T081 [US4] Store `packagingUnitId`; admin `modify` carries it with the stored snapshot; `listItems` and the customer serialisation expose it — `rfq-service.ts`, `rfq-admin-service.ts`, `quote-request-read-port.ts`, `services/customer-projection.ts`
- [x] T082 Build `mod-quote-requests`; run the module's quote-request integration files for regressions (Verification lists them one per line)

**Verification** (one invocation per line; T082 adds one `[PG]` line per existing file under `test/integration/quote_requests/` and records them in the PR):
- `pnpm --filter @endora-commerce/mod-quote-requests exec vitest run src/backend/services/packaging-resolution.test.ts src/backend/services/quote-minimums.test.ts src/backend/services/line-carry-over.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/packaging-units.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/minimums.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/admin-create-origin.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/cart-conversion-reference.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/conversion.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/created-from-admin.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/draft-edit-rate-limit.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/expiry-rules.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/expiry-schedule.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/expiry-sweep.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/expiry-worker.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/history-colleague-actor.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/history.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/line-carry-over.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/line-channel-assortment.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/list-totals-parity.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/migration.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/negotiation-enforcement.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/negotiation-loop.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/negotiation-policy-routes.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/packaging-unit-id-schema.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/pricing-history-schema.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/reference-price.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/rep-scope.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/rfq-packaging-snapshot.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/sales-channel-attribution.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/settings-channel.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/tax-totals.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/unpriced-acceptance.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/visibility.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/webhooks.test.ts`
- `pnpm --filter backend run check:port-catches`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`

---

## Phase 11: [backend] US4 — quote requests: operator actor and admin warnings (FR-012 actor rule, FR-030)

**Goal**: representatives are never refused; they see a warning on each below-minimum line; the
customer never sees it.

- [x] T083 [P] [US4] [PG] RED contract test: admin create-on-behalf and modify with A × 5 succeed (US4 #9); `GET /api/v1/admin/quote-requests/:id` items carry `minimumWarning` `{ kind: 'pieces', minimum: 10 }`, a pallet line `{ kind: 'packaging_unit', … }`, a line at the minimum `null`; the customer `GET /api/v1/quote-requests/:id` and the list carry no `minimumWarning` anywhere [S7] — `backend/test/contract/quote_requests/admin-minimum-warning.test.ts`
- [x] T084 [P] [US4] [PG] RED contract test: buyer `POST /api/v1/orders/:id/clone-to-quote` of an order with A × 5 → 422 naming the line (US4 #5a); the admin route creates the request and the admin read shows the warning (US4 #15); an operator quick-order import of A × 5 built to a quote request creates it and warns (US4 #1d, #15) — extend `backend/test/contract/orders/clone-to-quote.test.ts`, `backend/test/contract/quick_order/admin-build.test.ts`
- [x] T085 [US4] Admin serialisation computes `minimumWarning` over the request's lines (no exemption, one catalogue read) — `packages/modules/quote_requests/src/backend/services/rfq-service.ts` (`serializeFull(…, true)`)
- [x] T086 [US4] `OrderCloneToQuoteService.clone(…, { actor })`: the admin route passes `'operator'` → `minimums: 'warn'`; the buyer route the default; `actor` is a literal in each route's own code, never read from a request body or query (threat F10) — `packages/modules/orders/src/backend/services/order-clone-to-quote-service.ts`, `src/backend/routes.ts`
- [x] T087 Build `mod-quote-requests`, `mod-orders`, `mod-quick-order`; checks

**Verification** (one invocation per line):
- `[PG] pnpm exec vitest run test/contract/quote_requests/admin-minimum-warning.test.ts`
- `[PG] pnpm exec vitest run test/contract/quote_requests/customer-routes.test.ts`
- `[PG] pnpm exec vitest run test/contract/orders/clone-to-quote.test.ts`
- `[PG] pnpm exec vitest run test/contract/quick_order/admin-build.test.ts`
- `pnpm --filter backend run check:port-dependencies`
- `pnpm --filter @endora-commerce/mod-quote-requests run typecheck`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`
- `pnpm --filter @endora-commerce/mod-quick-order run typecheck`

Verified 2026-10-16: RED first — `admin-minimum-warning.test.ts` 3 / 4 failed on the missing `minimumWarning` (create on behalf and `modify` with A × 5 already answered 200, Phase 10 never gated them; the S7 absence test passed before and after), `clone-to-quote.test.ts` 1 / 5 failed (admin clone 422 `PRODUCT_BELOW_MINIMUM_QUANTITY`; the buyer refusal and the F10 body/query pin already held), `admin-build.test.ts` 1 / 7 failed (no warning on the admin read). Green: the four `[PG]` lines above 4 / 4, 10 / 10, 5 / 5, 7 / 7; `quote-minimums.test.ts` gains `quoteMinimumWarnings` (module unit run 39 / 39). Regression, one per invocation: `contract/quote_requests/{admin-routes,convert,expiry-enforcement,list-views}` 10 / 3 / 6 / 12; `integration/quote_requests/{admin-create-origin,created-from-admin,negotiation-loop,negotiation-enforcement,minimums,packaging-units}` 10 / 5 / 13 / 23 / 13 / 11; `openapi-baseline.test.ts` 2 / 2. `check:port-dependencies`, `check:port-catches`, `check:command-coverage -- --strict` clean; `mod-quote-requests`, `mod-orders`, `mod-quick-order`, `backend` typecheck clean; `backend`, `mod-quote-requests` lint clean (`mod-orders` lint: one pre-existing `OrderDetail.tsx` hook warning). `mod-quick-order` needed no change: its operator build already passed `actor: 'operator'` (Phase 9).

---

## Phase 12: [backend] US6 — returns, orders side: the stamp and the port (FR-016a, FR-017, FR-025)

**Goal**: placement records returnability as an explicit boolean on every new line; `returns` can read
it.

- [x] T088 [P] RED type-level test: `OrderReturnContextLine.returnableAtPurchase: boolean | null` required — `packages/contracts/src/quote-return-shapes.test.ts` (extend)
- [x] T090 [P] [US6] [PG] RED integration test: checkout, one-click, admin create, API intake and an accepted-quote checkout each stamp `returnable_at_purchase` from the product's flag at that moment; changing the flag afterwards changes no line (FR-016a, US6 #6); no new row is ever `null`; a row inserted without the column reads `null` — `backend/test/integration/orders/returnable-at-purchase.test.ts`
- [x] T090a [P] [US6] RED unit test for the stamp mapping (`returnableAtPurchase(record)`): `true` only for a record whose `returnable === true`; an absent record, or a record whose flag is missing (a stub or an older producer), → `false`, never `null` (FR-016a fail-closed, P4, US6 #9) — `packages/modules/orders/src/backend/services/returnable-at-purchase.test.ts`
- [x] T092 [P] [US6] [PG] RED-then-green: with `returns` off, an order placed records `returnable_at_purchase`; after switching `returns` on, `GET /api/v1/orders/:id/returnable` answers from it (Principle XVII) — extend `backend/test/integration/returns/off-state.test.ts`
- [x] T093 Add `returnableAtPurchase` to `OrderReturnContextLine` — `packages/contracts/src/returns.ts`
- [x] T094 [US6] `returnable-at-purchase.ts` (the pure mapping); stamp in `placeOrder` from the record hoisted in T059; map in the return-context provider — `packages/modules/orders/src/backend/services/{returnable-at-purchase,order-service,order-return-context}.ts`
- [x] T097 Build `contracts`, `mod-orders`; checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-orders exec vitest run src/backend/services/returnable-at-purchase.test.ts`
- `[PG] pnpm exec vitest run test/integration/orders/returnable-at-purchase.test.ts`
- `[PG] pnpm exec vitest run test/integration/returns/off-state.test.ts`
- `pnpm --filter @endora-commerce/mod-orders run typecheck`
- `pnpm --filter @endora-commerce/mod-returns run typecheck`

---

## Phase 12a: [backend] US6 — returns policy, refusal and per-line totals (FR-017 – FR-020, FR-022, FR-025, FR-033, SC-003, SC-006)

**Goal**: return cases refuse non-returnable lines; complaints untouched; no request can exceed a
line's remaining quantity however it splits it.

- [x] T089 [P] [US6] RED unit test for the returns policy: `null` ⇒ returnable; reason precedence `order_not_completing` → `fully_returned` → `no_returnable_lines`; `return` with a non-returnable line refused listing every such line once; `complaint` never checked; **per-line totals: entries summed per `orderItemId` before the remaining-quantity check, for both kinds** (FR-033) — `packages/modules/returns/src/backend/services/return-eligibility.test.ts`
- [x] T091 [P] [US6] [PG] RED integration test: US6 #1 (R returnable, N `notReturnableReason: 'product_not_returnable'`), #2 (`422 RETURN_LINE_NOT_RETURNABLE`, the sentence naming N's product, `details.lines` naming N, no case) [S6], #3 (all non-returnable → `eligible: false`, `reason: 'no_returnable_lines'`), #4 (complaint for N accepted), #5 (a case opened before continues), #6, #7 (pre-feature order: every line returnable), #9 (a line stamped `false` by the fail-closed rule is not returnable; a complaint is accepted) — `backend/test/integration/returns/returnable-lines.test.ts`
- [x] T091a [P] [US6] [PG] RED integration test, FR-033 / SC-006 (US6 #8) [F7]: line R × 4, nothing returned — a `return` case listing it 3 + 3 → `422 VALIDATION_FAILED` `qty_exceeds_returnable`, no case; the same as a `complaint` → refused; 2 + 2 → accepted, stored as **two** case lines with their own `reasonId`; after it, 1 more → refused (0 left); a `return` case naming one non-returnable line twice is refused once for it (`orderItemIds` deduplicated) — `backend/test/integration/returns/duplicate-lines.test.ts`
- [x] T095 Mint `RETURN_LINE_NOT_RETURNABLE` **in one commit**: enum, ledger `to: 'returns'`, returns manifest `errorCodes`, both returns bundles (the sentence names the product), **`composer:generate`, and — if it rewrote `docs/docs/module-reference/returns.md` — its Polish cache entry `docs/translation-cache/pl/generated:module-reference--returns.json` and the mirror under `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/`** (analyze F4) — `packages/contracts/src/errors.ts`, `backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `packages/modules/returns/src/manifest.ts`, `packages/modules/returns/i18n/{en,pl}.json`
- [x] T096 [US6] `getReturnable` and `createCase` per `contracts/returns-api.md` §2–§3 — `packages/modules/returns/src/backend/services/return-eligibility.ts` (pure policy), `return-case-service.ts`. **Coordinator ruling (2026-10-16):** `returnableLineSchema.returnable` stays `.optional()` until this task; the commit that makes `getReturnable` emit `returnable` tightens it to required `z.boolean()` per `contracts/returns-api.md` §2 in the same commit (`packages/contracts`).
- [x] T096a [US6] `createCase` aggregates requested quantities per `orderItemId` before the remaining-quantity check (both kinds) and stores the entries as sent — `return-case-service.ts`
- [x] T097a Build `mod-returns`; checks

**Verification** (one invocation per line):
- `pnpm --filter @endora-commerce/mod-returns exec vitest run src/backend/services/return-eligibility.test.ts`
- `[PG] pnpm exec vitest run test/integration/returns/returnable-lines.test.ts`
- `[PG] pnpm exec vitest run test/integration/returns/duplicate-lines.test.ts`
- `[PG] pnpm exec vitest run test/integration/returns/submit-case.test.ts`
- `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/error-code-routing-equality.test.ts`
- `pnpm --filter backend run check:error-translations`
- `pnpm --filter backend run check:docs-translations`
- `pnpm --filter backend run check:off-state-coverage`
- `pnpm --filter @endora-commerce/mod-returns run typecheck`

Verified 2026-10-16: RED first — `return-eligibility.test.ts` failed to import (no module), `returnable-lines.test.ts` 9 / 11 failed (no per-line `returnable`, N's return accepted with 201, its complaints then short of quantity; #5 and the R-only return already passed), `duplicate-lines.test.ts` 3 / 4 failed (3 + 3 accepted as a return and as a complaint, the non-returnable duplicate accepted; 2 + 2 then 1 more already held), `off-state.test.ts` 1 / 2 failed (no per-line verdict). Green: unit 18 / 18 (module suite 52 / 52), the four `[PG]` lines 11 / 11, 4 / 4, 7 / 7 and `off-state.test.ts` 2 / 2; `error-code-routing-equality.test.ts` 23 / 23; `contracts` suite 730 / 730 (gains the required-`returnable` assertion). Regression, one per invocation: `integration/returns/{audit,authorize-rma,comments,corrective-invoice-outcome,list-and-bulk,notification-language,notifications,reasons,return-shipping,seeder,settle-refund,settlement-ordering,workflow-config}` 1 / 3 / 3 / 4 / 5 / 1 / 2 / 2 / 5 / 1 / 10 / 3 / 5 (there is no `contract/returns/` directory); `openapi-baseline.test.ts` 2 / 2. `check:error-translations`, `check:bundle-pairing`, `check:docs-translations`, `check:off-state-coverage`, `check:port-catches`, `check:command-coverage -- --strict` clean; `contracts`, `mod-returns`, `backend` typecheck and lint clean. `composer:generate` and `manifests:generate` moved no generated artefact, so no Polish module-reference refresh was needed. Check order in `createCase`: per-line totals (unknown line, then sums), reason, returnability (`return` only).

---

## Phase 13: [admin UI] US1 / US2 / US5 — catalogue admin (FR-001 – FR-003, FR-034)

**Goal**: the product editor, the packaging editor and the bulk edit expose the settings in PL and EN.

- [x] T098 [P] [US1] [US5] RED admin test in `<StrictMode>`: `ProductOrderRulesCard` shows "Returnable" for every type and "Minimum order quantity (pcs)" only for simple/configurable; loads current values; the input has `min=1 max=1000000`; saves via `PATCH` (empty input → `null`); shows the server's error; labels in `en` and `pl` — `admin/test/modules/catalog/ProductOrderRulesCard.test.tsx`
- [x] T099 [P] [US2] RED admin test in `<StrictMode>`: the packaging editor shows and edits "Minimum (units)" (same range), clears it, sends `minOrderUnits` — `admin/test/modules/catalog/PackagingUnitsEditor.min.test.tsx`
- [x] T100 [P] [US5] RED admin test in `<StrictMode>`: the bulk edit dialog's "Returnable" section sends `{ returnable: true }` / `false`, nothing when untouched, and shows the hint that products are not returnable until marked (FR-034), in `en` and `pl` — `admin/test/modules/catalog/ProductsBulkEditDialog.returnable.test.tsx`
- [x] T101 [US1] [US5] `ProductOrderRulesCard.tsx`, mounted in the Inventory tab for every type (`ProductEditor.tsx:795–802`) — `packages/modules/catalog/src/admin/components/ProductOrderRulesCard.tsx`, `src/admin/pages/ProductEditor.tsx`
- [x] T102 [US2] Minimum column/field — `packages/modules/catalog/src/admin/components/PackagingUnitsEditor.tsx`
- [x] T103 [US5] Returnable section and hint — `packages/modules/catalog/src/admin/components/ProductsBulkEditDialog.tsx`
- [x] T104 Catalogue bundle keys (flat, both languages) — `packages/modules/catalog/i18n/{en,pl}.json`
- [x] T105 Admin typecheck, the module's admin tests, `i18n:hardcoded`, `check:bundle-pairing`

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/catalog`
- `pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend run check:bundle-pairing`
- `pnpm --filter admin run typecheck`
- `pnpm --filter @endora-commerce/mod-catalog run typecheck`

---

## Phase 14: [admin UI] US4 — quote warning, order preview message, quick-order import (FR-009, FR-011, FR-030)

- [x] T106 [P] [US4] RED admin test in `<StrictMode>`: `RfqDetail` Overview and Modify show "Below minimum (10 pcs)" / the pallet variant on a line with `minimumWarning`, nothing otherwise, in `en` and `pl` — `admin/test/modules/quote_requests/RfqDetail.minimum-warning.test.tsx`
- [x] T107 [P] [US4] RED admin test **in `<StrictMode>`**: the create-order preview renders `BELOW_MINIMUM_QUANTITY` with the minimum in both languages; a preview answer arriving after unmount sets no state — `admin/test/modules/orders/OrderCreatePage.minimum.test.tsx`
- [x] T108 [P] [US4] RED admin test **in `<StrictMode>`**: the operator quick-order import shows a row with `warning` as **buildable** (selectable, included in the build) with a "below minimum (N pcs)" badge, in `en` and `pl` (P1 C, US4 #1d); a build to the cart lists `rejected[]` lines with product and minimum; a build to a quote request shows no rejection — `admin/test/modules/quick_order/import-below-minimum.test.tsx`
- [x] T109 [US4] Warning badge — `packages/modules/quote_requests/src/admin/pages/RfqDetail.tsx` (or `admin/reference-view.tsx` where the line cells live); keys `rfq.detail.minimum.*` in `packages/modules/_i18n/i18n/{en,pl}.json` (the `core` bundle `RfqDetail` reads)
- [x] T110 [US4] Preview message label — `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx`, `packages/modules/orders/i18n/{en,pl}.json`
- [x] T111 [US4] Import warning badge, rejected-lines list, reason union and labels — `packages/modules/quick_order/src/admin/api/quick-order-client.ts`, the quick-order admin page, `packages/modules/quick_order/i18n/{en,pl}.json`
- [x] T112 Admin typecheck, tests, `i18n:hardcoded`, `check:bundle-pairing`

**Verification** (one invocation per line):
- `pnpm --filter admin exec vitest run test/modules/quote_requests test/modules/orders test/modules/quick_order`
- `pnpm --filter backend run i18n:hardcoded`
- `pnpm --filter backend run check:bundle-pairing`
- `pnpm --filter admin run typecheck`

---

> **Storefront test shape (Phases 15–17).** The storefront suite has no interactive renderer —
> `storefront/package.json` carries `vitest` and `react-dom` and no Testing Library or DOM
> environment, measured on `39b9b9989` — so, as in 146 T078, tests exercise **exported pure units**
> (initial quantity, input floor, statement text, report-row mapping) and `renderToString` of
> components given fixed props. Interaction is left to the owner's manual walk (`quickstart.md`).

## Phase 15: [storefront] US1 / US2 / US4 — product page, card, comparison (FR-014, FR-016, SC-002)

- [x] T113 [P] [US1] [US2] RED storefront test of exported pure helpers used by `ProductBuyActions` — `orderFloor(product, unit | null)` (pieces minimum; for a unit `minOrderUnits`; 1 when none) and `minimumStatement(product, unit | null, locale)` ("minimum 10 pcs"; "min. 2 × Pallet = 128 pcs"; `null` when none) — plus a `renderToString` of `ProductBuyActions` with a minimum showing the statement and `min`/`value` = 10 (US1 #2, #6; US2 #2); PL and EN — `storefront/test/catalog/pdp-minimum.test.tsx`
- [x] T114 [P] [US4] RED storefront test of the exported quantity helper the card and comparison buttons call (`cardAddQuantity(minOrderQuantity)` → the minimum, 1 when none) and of the payload builder each passes to `addProductToCartAction` (US4 #12) — `storefront/test/catalog/product-card-minimum.test.tsx`, `compare-add-minimum.test.tsx`
- [x] T115 [US1] [US2] `ProductBuyActions.tsx` — input floor, initial value, statement (unit-aware), through the T113 helpers
- [x] T116 [US4] `ProductCardActions.tsx`, `CompareAddToCartButton.tsx` (new `minOrderQuantity` prop), `ComparisonTable.tsx` passes it
- [x] T117 Strings in `storefront/lib/i18n/messages.ts` (total `Record`: Polish is a `tsc` obligation)
- [x] T118 Storefront typecheck, lint, tests; `check:rsc-discipline`, `check:storefront-indexability`

**Verification** (one invocation per line):
- `pnpm --filter storefront exec vitest run test/catalog`
- `pnpm --filter storefront run typecheck`
- `pnpm --filter storefront run lint`
- `pnpm --filter backend run check:rsc-discipline`
- `pnpm --filter backend run check:storefront-indexability`

---

## Phase 16: [storefront] US1 / US4 — cart, checkout, quick order, lists (FR-008, FR-011, FR-013, FR-015, FR-037)

- [x] T119 [P] [US1] RED storefront test: `renderToString` of `CartLine` with `belowMinimum` shows "below the minimum (10 pcs)" / the pallet variant and `min` = `minOrderQuantity` on its input; the pure `belowMinimumText(line, locale)` in PL and EN (US1 #4, #5); **a line with `unavailable: true`, `unavailableReason: 'not_purchasable'` renders as "no longer available" with remove only, and the pure `cartBlocksCheckout(view)` is `true` for it (FR-037 — the server has emitted `unavailableReason: null` until now, so this rendering is new)** — `storefront/test/checkout/cart-line-minimum.test.tsx`
- [x] T120 [P] [US1] RED storefront test: the pure `canPlaceOrder(preview)` is `false` with any `belowMinimumLines` (including `product_unavailable`), and a `renderToString` of the summary block lists them (a `product_unavailable` line by the cart's own line name, "no longer available") — `storefront/test/checkout/checkout-below-minimum.test.tsx`
- [x] T121 [P] [US4] RED storefront test of the report mappers: a buyer quick-order preview row (`below_minimum` with `productTotal` — "the product's total in this file is 7, minimum 10"), a build `rejected[]` entry, a list `skipped[]` entry and a dropped line with `below_minimum` each render their PL/EN sentence with the minimum (`renderToString` of `CartDroppedLinesBanner`; the quick-order and list label helpers) — `storefront/test/account/batch-below-minimum.test.tsx`
- [x] T122 [US1] Cart line and page (below-minimum line, unavailable line, checkout link disabled while `cartBlocksCheckout`) — `storefront/components/CartLine.tsx`, `storefront/app/(commerce)/cart/page.tsx`
- [x] T123 [US1] Checkout page reads `belowMinimumLines` — `storefront/lib/api/orders.ts` (the `preview-total` client), `storefront/app/(commerce)/checkout/page.tsx` and the client component it renders the summary with
- [x] T124 [US4] Quick-order and list reports, dropped-lines banner — `storefront/lib/api/quick-order.ts`, `storefront/app/(account)/quick-order/…`, `storefront/app/(account)/shopping-lists/…`, `storefront/components/CartDroppedLinesBanner.tsx`
- [x] T125 Strings in `messages.ts`; storefront typecheck, lint, tests

**Verification** (one invocation per line):
- `pnpm --filter storefront exec vitest run test/checkout test/account`
- `pnpm --filter storefront run typecheck`
- `pnpm --filter storefront run lint`

Verified 2026-10-16: `test/checkout test/account` 26 files / 194 tests passed; full storefront suite 130 files / 1338 tests passed (after the stepper fix: the cart line's −/+ post `step`, so "+" is no longer shadowed by the input's `quantity`); storefront typecheck clean; lint 0 errors (17 pre-existing warnings, none in files this phase touched); `check:rsc-discipline` 0 findings. Coordinator addition: `quickOrderBuildResponseSchema.rejected[]` gains optional `packagingUnitName`, set by the build service and named in the admin on-behalf build list (`onBehalf.build.rejectedUnits`, plus `rejectedUnitsUnnamed`); contracts suite 34 files / 731 passed, `quick-order-build-service.test.ts` 10 / 10, `admin test/modules/quick_order` 19 / 19, `[PG] test/contract/quick_order/build.test.ts` 7 / 7; `contracts`, `mod-quick-order`, `admin`, `backend` typecheck clean. Deviation: a build line carries no packaging unit, so a `packaging_unit` refusal cannot be produced over HTTP — the RED is in the service unit, contracts shape and admin tests, and the contract test gained a wire-shape assertion only. Deviation: the checkout page called no preview before; it now asks `preview-total` server-side with the preselected methods and falls back to the cart view's flags. `submit_for_approval` is not blocked by below-minimum lines (left for the owner). **Owner ruling 2026-10-18: "Submit for approval" is blocked the same way.** Storefront: the cart's primary CTA (extracted from `cart/page.tsx` to `components/CartPrimaryCta.tsx` so it can be rendered in a test) and `CartApprovalBanner` render the submit control disabled, with no form behind it, and a visible note (`cart.approvalBlocked`, PL/EN) linked by `aria-describedby` while `cartBlocksCheckout` — `storefront/test/checkout/cart-approval-blocked.test.tsx`. Server: `POST /api/v1/cart/submit-for-approval` refuses a basket below a minimum with the placement codes (`422 PRODUCT_BELOW_MINIMUM_QUANTITY` / `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, `404 PRODUCT_NOT_FOUND` for a gone product), judged as the cart view flags it (`assertCartMeetsMinimums` in `carts`' `cart-minimums.ts`), after the existing refusals and before the state flips — `[PG] pnpm exec vitest run test/contract/carts/cart-approval-minimums.test.ts` (RED: 200 `pending` for a 3-of-10 basket; GREEN 2 / 2).

---

## Phase 17: [storefront] US4 / US6 — quote draft, returns form, order detail (FR-032, FR-021)

- [x] T126 [P] [US4] RED storefront test (units, not an SSR render of the `localStorage` view — 146 T078): `renderToString` of exported `DraftLine` with a minimum shows `min` = 10 and, for quantity 3, "below the minimum (10 pcs)" (US4 #14) while keeping "remove"; pure `clampDraftQuantity(q, minimum)`; `addToRfqDraft` (pure on a passed-in array) adds at least the minimum; the quote-add quantity helper used by the product page, `AddToRfqButton` and the product card starts at the minimum (US4 #13) — `storefront/test/rfq/rfq-draft-minimum.test.tsx`
- [x] T127 [P] [US4] RED storefront test of the server action `readDraftMinimums(slugs)`: distinct slugs, at most 8 in flight [S8], a non-2xx answer ⇒ minimum unknown (plan I5), session cookie forwarded — `storefront/test/rfq/rfq-draft-minimums-action.test.ts`
- [x] T128 [P] [US6] RED storefront test of the pure `returnFormModel(returnable, locale)` — selectable lines, "not returnable" lines with their reason (PL/EN), and the mode: `return_and_complaint`, `complaint_only` for `no_returnable_lines` ("no products in this order are returnable"), `none` for `order_not_completing` / `fully_returned` (US6 #1, #3, #4) — and a `renderToString` of the form's line list — `storefront/test/account/returns-new-returnable.test.tsx`
- [x] T129 [P] [US6] RED storefront test of the pure `orderReturnAction(returnable)` → `return` when eligible, `complaint` for `no_returnable_lines`, `null` otherwise, with its PL/EN label — `storefront/test/account/order-detail-return-action.test.tsx`
- [x] T130 [US4] Draft model and add actions — `storefront/lib/rfqDraft.ts`, `components/ProductBuyActions.tsx`, `components/rfq/AddToRfqButton.tsx`, `components/pricing/QuoteRequestCta.tsx`, `components/ProductCardActions.tsx`
- [x] T131 [US4] `readDraftMinimums` server action (pattern `getResolvedPricesBulk`, `storefront/lib/api/pricing.ts:110–137`) and `RfqDraftView` wiring — `storefront/lib/api/rfq.ts` (or `lib/actions/`), `storefront/components/rfq/RfqDraftView.tsx`
- [x] T132 [US6] Return form and order detail — `storefront/app/(account)/returns/new/page.tsx`, `storefront/app/(account)/orders/[id]/page.tsx`, `storefront/lib/i18n/messages.ts`
- [x] T133 Storefront typecheck, lint, tests; `check:rsc-discipline`

**Verification** (one invocation per line):
- `pnpm --filter storefront exec vitest run test/rfq test/account`
- `pnpm --filter storefront run typecheck`
- `pnpm --filter storefront run lint`
- `pnpm --filter backend run check:rsc-discipline`

---

## Phase 18: [docs] Off-state, documentation, changesets, deferred defects (FR-034)

- [x] T134 [PG] Re-run the switchable modules' off-state files and the coverage check: `quick_order`, `shopping_lists`, `quote_requests` (extended in T056b), `carts`, `returns` (extended in T092) — no new obligation is expected (no new route, worker, subscriber, timer or hook; research R17)
- [x] T135 [P] Catalogue pages: minimums (pieces, per unit, product total across variants, independent checks, types, range 1–1 000 000), returnable flag — **FR-034: on release every existing product is not returnable, so lines of orders placed after the release are not returnable until marked; mark them with the bulk "Set returnable" action; orders placed before the release are unaffected** —, recorded at purchase, audit (bulk audited per product) — `packages/modules/catalog/docs/catalog/packaging-units.md`, `packages/modules/catalog/docs/catalog.md`
- [x] T136 [P] Module pages: carts (enforcement, batch resolve-then-judge, quote-line exemption state-based and face value in the cart), orders (placement refusal before side effects, exemption only while the quote is still valid, preview, admin preview, 200-line bound, `returnable_at_purchase` fail-closed), quote_requests (packaging id, one reason for an unusable id, buyer refusals, representative warnings, draft exemption), quick_order (preview judges file totals; operator preview warns; build bound 200; import ceiling 10 000; one-click minimum), shopping_lists (skip reasons), returns (per-line returnability; **`eligible: false` with `no_returnable_lines` now means "no return, a complaint is still possible" — `eligible` answers for `return`-kind cases only** (analyze F13); duplicate lines summed per order line, FR-033) — `packages/modules/{carts,orders,quote_requests,quick_order,shopping_lists,returns}/docs/*.md`
- [x] T137 [P] Polish: every page edited in T135–T136 — cache entry `docs/translation-cache/pl/packages--modules--<id>--docs--<page>.md.json` (`sourceHash`, `content`) **and** the materialised page under `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/`
- [x] T138 [P] Changesets (`minor`, one per meaning, written for the consumer): `@endora-commerce/contracts` (rule function, bounds constants, schema/record/port additions, four codes, `addItems`, `CreateForCustomerOptions.minimums`, the FR-038 bound constants), `mod-catalog` (columns, admin fields, read-port method — **implementers of typed `CatalogProductReadPort` stubs must add `listPackagingUnitsByProductIds`, and its callers must pass only vetted ids**; **FR-034: existing products become not returnable for new orders by default — mark them with the bulk action; orders placed before the release are unaffected**), `mod-carts` (enforcement, view fields, batch add — **a batch with an unknown or hidden product now fails before any line is added** —, quote → cart reasons, cart → quote sends the unit id), `mod-orders` (placement refusal, exemption only while the quote source is valid, preview fields, admin preview code, recorded flag, admin create bound 200), `mod-quote-requests` (packaging validation — **a buyer request with a non-matching packaging label is now refused, including a draft edit of an existing request whose stored label no longer matches a catalogue unit** —, buyer refusals, warnings), `mod-quick-order` (file-total preview, operator warnings, **builds of more than 200 lines are refused, including to a quote request**, import ceiling), `mod-shopping-lists`, `mod-returns` (**`eligible: false` with `no_returnable_lines` still allows a complaint; duplicate order lines in one request are summed**; FR-034 statement), `mod-comparisons`, `mod-search` — `.changeset/155-*.md`
- [x] T139 [P] Carry `plan.md` § *Deferred defects* into the PR description verbatim
- [x] T140 Run the docs and release checks

**Verification** (one invocation per line):
- `[PG] pnpm exec vitest run test/integration/quick_order/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/shopping_lists/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/quote_requests/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/carts/off-state.test.ts`
- `[PG] pnpm exec vitest run test/integration/returns/off-state.test.ts`
- `pnpm --filter backend run check:off-state-coverage`
- `pnpm --filter backend run check:module-docs`
- `pnpm --filter backend run check:docs-translations`
- `pnpm --filter backend run check:doc-snippets`
- `pnpm --filter backend run check:release-intent`

---

## Phase 19: OpenAPI baseline and the `[PG]` sweep

- [x] T141 Re-record `backend/test/fixtures/openapi-baseline.json`: `UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run test/contract/kernel/openapi-baseline.test.ts`; review the diff — **additions only** (plan I3); then run without the flag
- [x] T142 `[PG]` Every file this feature added or extended, **one `vitest run <file>` per invocation**, from `backend/` with the `[PG]` environment: the `[PG]` files of Phases 3–12a and 18, plus `test/contract/admin_users/permission-inventory.test.ts`, `test/contract/kernel/harness-parity.test.ts`, `test/integration/carts/cart-pricing-recompute.integration.test.ts`, `test/integration/orders/place-order-from-quote-request.test.ts`, `test/contract/quote_requests/customer-routes.test.ts` — paste the summary into the PR (D-198)
- [x] T143 Deleted or moved anything? `git diff --name-status --diff-filter=DR origin/master...HEAD`; grep each old path under `backend/test/`; `composer:check`, `manifests:check`, `overlay:check`; `git status --porcelain` clean
- [x] T144 Walk `quickstart.md` §1–§7 on `pnpm run dev` and note any divergence in the PR (the owner's manual test follows) — **done as the owner's manual test, 2026-10-19: passed after fix rounds**

**Verification**: T141–T143 exit 0; T144 notes recorded.

Verified 2026-10-18, after rebasing onto `origin/master` (`dcf1de310`):
- **T141** — re-recorded with `UPDATE_OPENAPI_BASELINE=1` (`[PG]` env); the fixture did not move (byte-identical to `origin/master`'s). Expected: this feature adds no route path (every endpoint in `contracts/*.md` already exists in the fixture), and the harness document carries paths without request or response bodies, so new response fields and error codes do not render there. Re-run without the flag: 2 / 2 green.
- **T142** — 84 `[PG]` files, one `vitest run` per invocation, all green, 623 tests: the `[PG]` files of every Verification block in Phases 3–12a and 18, every contract/integration file this branch adds or modifies (incl. `cart-approval-minimums`), the five files named above, and master's `cart-line-repricing`, `cart-line-refusal-codes`, `place-order-line-price-current`, `place-order-from-quote-request` and `price-matrix-*` (one contract, four integration).
- **T143** — `--diff-filter=DR` against `origin/master` is empty (the `148-` spec directory, the dropped `carts` migration and its schema test were added and removed inside the branch); no reference to `148-catalog-order-constraints`, `quote_seeded_quantity`, `cart_item_quote_seeded_quantity` or `quote-seeded-quantity-schema` remains under `backend/`, `admin/test`, `docs/`, `packages/`, `storefront/` or `.changeset/`; `composer:check`, `manifests:check`, `overlay:check` all clean; tree clean.

---

## Phase 20: Final — `quality.yml` gate (macOS: Docker routing above)

Re-read `.github/workflows/quality.yml` first; if a step was added, run it too. One command per
invocation. This is the only phase where `pnpm -r` is allowed.

- [x] T145 `pnpm install --frozen-lockfile && pnpm run build:packages` (host), then `pnpm -r run typecheck` and `pnpm -r run lint`, each on its own
  - **2026-10-18, host, `2d3c0f55c`**: install rc=0 (up to date), `build:packages` rc=0, `pnpm -r run typecheck` rc=0 (80 projects), `pnpm -r run lint` rc=0 (80 projects; 3 pre-existing `no-console` warnings in `backend/test/perf/`). After the two T146 fixes (`e353b3d6c`): `build:packages`, `mod-catalog` typecheck + lint, `admin` and `backend` typecheck, rc=0 each.
- [x] T146 `test:backend:unit` — **in Docker `node:22.18-slim --init`**, `<CMD>` = `pnpm --filter backend run test:unit:fast`, run alone (includes `agents-router.test.ts` and the generated-registry tests)
  - **2026-10-18, Docker `node:22.18-slim --init`, clone at `e353b3d6c`**: rc=1 on the first full run at `2d3c0f55c` with two branch reds, both fixed — `returns` missing from the error-code roster (`f47dd7b3f`) and six undefined `b2b-alert` renders in `ProductOrderRulesCard` reported through `moved-module-tree.test.ts` (`e353b3d6c`). The routing recipe above lacks CI's `corepack prepare pnpm@9.15.0 --activate`; without it `dockerfile-workspace-supply.test.ts` reds on a corepack download of the latest pnpm, so the re-run added it. Re-run: 349/354 files, 7599/7609 tests; the 10 reds were all `Test timed out in 30000ms` in tree-scanning tests under load, and each of the five files is green alone in the same container (`module-package-manifest` 105, `check-fixture-substitution` 28, `check-module-boundary` 154, `check-platform-surface` 67, `migration-scaffold-roots` 15).
- [x] T147 `quality` run-block, verbatim and in order, on the host — each step on its own; **except `pnpm run check:pdfmake-footprint`, which runs in Docker `node:22.18-slim`** (vacuous on macOS `du -sb`). A `[read-size drift]` report is left alone; re-record **only** an entry whose band refuses the run, re-measured in a clean tree, never computed from a delta and never by widening a band (`specs/conventions/check-estate.md` § *When a read size is re-recorded*)
  - **2026-10-18, host, `e353b3d6c`**: 45 steps after typecheck/lint (T145), one per invocation, each rc=0; no `[read-size drift]` report; `check:release-intent` violations=0. `check:pdfmake-footprint` in Docker `node:22.18-slim`: rc=0, 14.1 MB of 32.0 MB.
- [x] T148 `quality:static` — **in Docker `ubuntu:24.04`** (`check-naming.sh`, `check-language.sh`)
  - **2026-10-18, Docker `ubuntu:24.04`, `e353b3d6c`**: `check-naming.sh` OK (8243 files), `check-language.sh` OK (6753 files), rc=0.
- [x] T149 `test:frontend` — **in Docker `node:22.18-slim --init`**, `<CMD>` = `pnpm --filter '!backend' run test` (the only command that reaches the module packages' co-located tests)
  - **2026-10-18, Docker `node:22.18-slim --init`, `e353b3d6c`**: first run rc=1 on the known `packages/cli/test/dev-all.test.ts` flake (2 tests), green alone (24/24). `--no-bail` re-run: 70 of 71 packages green; `admin` 2 reds in the quick-search case of `OrderCreatePage`/`RfqCreatePage.product-browser.test.tsx` (the second page is not touched by this branch), both green alone (14/14, 18/18). `admin` alone: 302/303 files, the one red being the known `crm/board-card-fields.test.tsx` flake, green alone (23/23); the product-browser files green in that run.
- [x] T150 `release:changeset` — `pnpm --filter backend run check:release-intent -- --since origin/master && pnpm --filter backend run test:release-gate` (host)
  - **2026-10-18, host, `e353b3d6c`**: `check:release-intent -- --since origin/master` rc=0 (changesets-added=9, violations=0); `test:release-gate` rc=0 (29/29).

**Verification**: T145–T150 all exit 0, each run on its own; results pasted into the PR.

---

## Phase 21: Final — the other pull-request workflows

- [x] T151 `pack-gate` — **in Docker `node:22.18-slim --init`**, `<CMD>` = `pnpm --filter backend run pack-gate -- --no-build`
- [x] T152 `boot-gate` — `bash scripts/boot-gate.sh --with-negatives` (needs Docker; say so in the PR if unavailable)
- [x] T153 `build:docs` — `pnpm --filter docs run build && pnpm --filter backend run verify:docs-build`
- [x] T154 `dco` — `node backend/scripts/dco-signoff.ts origin/master HEAD`
  - **2026-10-18, fork CI (PR #2) at `4fe927602`**: `pack-gate`, `boot-gate`, `build:docs` and `dco` jobs all passed.

**Verification**: T151–T154 exit 0 (T152 may be "not runnable here: no Docker"); results in the PR beside T142's. Then: rebase onto the newest `origin/master`, re-run Phases 20–21, owner's manual test, PR.

---

## Review fix round A (U4) — backend defects from the review pack

Each RED test was written first and seen failing; then fixed.

- [x] T155 [PG] D1 — a request refused for a minimum (or an unknown product) leaves the customer's basket exactly as it was, on admin create and the API intake: `CartWritePort.addItems` gains `onBelowMinimum: 'throw'` (whole-batch refusal between the judgement and the write) and `replaceExisting` (judge the batch alone; clear the cart only after it passed). `assertBatchMeetsMinimums` deleted. RED: `backend/test/integration/orders/request-refusal-basket.test.ts` (QA's K × 3 repro, admin and intake), `cart-batch-add.test.ts` (D1 blocks)
- [x] T156 [PG] D3/D4 — the product name is in the language of the refusal's sentence on every path: `request.responseLanguage()` (platform, the envelope's own ladder, memoised) and `pickLocalized` (contracts); the three first-tag `Accept-Language` parsers deleted. RED: `minimums-polish.test.ts` (`it.fails` → `it`, plus `en;q=0.2,pl;q=0.9`), `carts/minimums.test.ts` (`pl;q=0.9`), `place-order-minimums.test.ts` (Polish placement and preview), `request-refusal-basket.test.ts` (admin stored `en` + header `pl`; intake q-weighted), `response-language.test.ts`, `localized-name.test.ts`
- [x] T157 D2 — packaging-unit totals compared exactly (bigint fractions). RED: `order-minimums.boundary.test.ts` (7 + 1 + 1 + 1 on base 10, minimum 1)
- [x] T158 [PG] FR-031 (b) — a draft-edit line pairs and stays unchanged by its stored `packagingUnitId` after the unit is renamed. RED: `packaging-units.test.ts`, `line-carry-over.test.ts`
- [x] T159 One `toCartDroppedLines` in `@endora-commerce/contracts` (a root may not value-import a module package), called by both roots. RED: `packages/contracts/src/shopping-lists.test.ts`
- [x] T160 Nits — `cart-batch-add.test.ts` drops the wall-clock bound; a failed batch outcome carries the refusal's `details`, which `convertToCart` re-raises. RED: `cross-module-ports.test.ts`, `cart-batch-add.test.ts`

**Not in this round**: UI/storefront items, the returns complaint question, quantity upper bounds, the bulk Command Bus question (owner decisions or round B). `contracts/cart-and-checkout-api.md` §4 still shows `addItems(…, { onLineError })` without `onBelowMinimum`, `replaceExisting` and `language`, and §5's admin-create row (and the API intake) predate them — left for the product owner, who holds that file this round.


## Review fix round B (U4) — owner rulings R1 and R5, UI review, test gaps

Each RED test was written first and seen failing, then fixed — except the T166 jsdom cases, which cover behaviour that was already right (test gaps) and were mutation-checked instead: with the blur handler removed they fail.

- [x] T161 [PG] R5 / FR-039 — submit for approval judges the basket as placement does: a quote-seeded line is exempt only once the quote source is confirmed valid (same organization, `Approved`, not expired, not yet ordered, an agreed line present). `orders` publishes `OrderQuoteSourcePort` (`orderQuoteSourcePort`, the checkout preview's lock-free `#previewedQuoteRequestSource`); `carts` resolves it lazily — no new dependency edge (`carts` already declares `orders` and `quote_requests`). Fail-closed while `quote_requests` is off. Storefront submit fallback through PL/EN messages (`cart.submitForApprovalFailed`). `contracts/cart-and-checkout-api.md` §4/§5 brought up to round A's `onBelowMinimum`/`replaceExisting`. RED: `backend/test/contract/carts/cart-approval-minimums.test.ts` (18a valid; expired, cancelled, already ordered, other organization; `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`; 404 `details.cartItemIds`; Polish message; `quote_requests` off), `cart-minimums.test.ts`, `storefront/test/product-cart-action-messages.test.ts`
- [x] T162 [PG] Round A residue — a replacing batch (`replaceExisting`, `onLineError: 'throw'`) prices every line it is about to write before clearing the basket, so `CART_PRODUCT_UNPRICED` / `CART_PRODUCT_QUOTE_ONLY` leave the basket intact on admin create and API intake. The line cap cannot trigger on the fresh basket (≤ 200 lines). Residual: a price edited between the pre-check and the write can still refuse after the clear; placement prices again. RED: `backend/test/integration/orders/request-refusal-basket.test.ts` (unpriced on admin create, quote-only on intake)
- [x] T163 [PG] R1 — a `complaint` line recorded not returnable at purchase is stored with `approvedRefundAmount` 0; `defaultRefundAmount` stays the amount paid (it is settlement's cap — 0 there would forbid any refund). The admin settlement form pre-fills from the stored approved amount; the case view marks the line **Not returnable at purchase** (kit `Badge`, `mod-i18n` `returns.detail.notReturnableAtPurchase`, EN/PL); the case detail items carry `returnableAtPurchase` from `OrderReturnContextPort`. Nothing pays out without the operator: settlement is the one admin route. RED: `backend/test/integration/returns/returnable-lines.test.ts` (R1), `admin/test/modules/returns/ReturnDetail.notReturnable.test.tsx`
- [x] T164 UI review — `ProductOrderRulesCard` on kit `Checkbox`/`Input`/`Button`; `PackagingUnitsEditor` keeps a refused minimum invalid until its value changes; `CartLine` hidden default submit so Enter posts the typed quantity; redirect reports capped at 20 + count, projected, parsed defensively; `CompareAddToCartButton` takes the table's locale; `place-order-gate` JSDoc; `OrderCreatePage` line width. RED: `ProductOrderRulesCard.test.tsx`, `PackagingUnitsEditor.min.test.tsx`, `cart-line-minimum.test.tsx`, `batch-below-minimum.test.tsx`, `compare-add-minimum.test.tsx` (locale)
- [x] T165 Docs and changesets — carts, orders and returns pages EN + PL with the translation cache re-pinned; changesets `mod-carts`, `mod-orders`, `contracts`, `mod-returns` (+ `mod-i18n`), `mod-catalog`
- [x] T166 Test gaps — (jsdom cases superseded by T172) jsdom (`// @vitest-environment jsdom`, no new dependency; the storefront suite is otherwise SSR-only per `.claude/skills/ux-laws/SKILL.md` §5) for `ProductCardActions` / `CompareAddToCartButton` clicks (`quantity: 10`), PDP blur normalisation, quote-draft "Set to N" and blur; `OrderCreatePage.minimum` asserts on the unmounted-update warning only; `import-below-minimum` tests the unit refusal through the page; product-browser `waitFor` after the quick-add click (both pages)

## Review fix round C (U4) — re-review findings

Each RED test was written first and seen failing, then fixed.

- [x] T167 [PG] One-click no longer empties the basket before a refusal: the line goes through `addItems` with `onLineError: 'throw'`, `onBelowMinimum: 'throw'` and `replaceExisting`, which clears only once nothing is left to refuse the line for. A placement refusal after the seed still leaves the basket holding the one-click line — inherent to buying through the basket, out of scope. RED: `backend/test/contract/quick_order/one-click-place.test.ts` (below the minimum, unpriced — basket still K × 3; the F3 backstop double now overrides `addItems`), `one-click-service.test.ts`
- [x] T168 `addItems` refuses `replaceExisting` with `onLineError: 'report'` before anything is read or written (a reported write-step failure would come after the clear). Port JSDoc and `contracts/cart-and-checkout-api.md` §4. RED: `cart-batch-add.test.ts`
- [x] T169 Docs — `contracts/cart-and-checkout-api.md` §12 names both new `CartApprovalService` arguments (`catalogProductReadPort`, then `orderQuoteSourcePort`); changesets: `mod-carts` (the header-less `GET /api/v1/cart` names lines in the channel default language; `replaceExisting` needs `'throw'`), `mod-quick-order` (one-click keeps the basket on a refusal), `platform` (second envelope install)
- [x] T170 Redirect reports held to a URL budget: names cut to 80, the encoded report ≤ 6 000 characters by dropping its last lines into `more`; the reader holds the same bounds (oversize → empty, names cut, fields projected, `more` clamped to 10 000); one `emptyReport()`. RED: `storefront/test/account/batch-below-minimum.test.tsx`
- [x] T171 Nits — `assertCartMeetsMinimums` hands `confirmQuoteSource` the mark's quote id (no `!` in `CartApprovalService`); `installResponseLanguage` throws on a second install with a different resolver and shares the first's memo on the same one. RED: `cart-minimums.test.ts`, `packages/platform/src/http/response-language.test.ts`

## Review fix round D (U4) — acceptance follow-ups

- [x] T172 Owner ruling: the storefront jsdom tests revert to server-render tests (supersedes T166's jsdom cases). `pdp-minimum`, `product-card-minimum`, `compare-add-minimum` and `rfq/rfq-draft-minimum` drop `// @vitest-environment jsdom` and every `react-dom/client` case. The interaction rules are pure helpers the components call — `normaliseOnBlur` (PDP blur, `lib/orderMinimum.ts`), `draftQuantityFloor` (the quote draft's floor and its "Set to N" value), `draftQuantityOnType` and `draftQuantityOnBlur` (`lib/rfqDraft.ts`); the card and comparison clicks already sent `cardAddToCartPayload`. Each helper is unit-tested with the cases the jsdom tests covered (below the floor, empty, non-numeric, above it, nothing typed), and each component is held to calling it by a source-wiring assertion, mutation-checked (the card payload and the "Set to N" value replaced: both fail). Interaction wiring beyond that is left to the owner's manual test; permitting jsdom for client components is proposed separately in issue #355.

## Review fix round E (U4) — owner ruling S8 A: the touched storefront components follow the page locale

Each RED test was written first and seen failing, then fixed. Every string and accessible name
below goes through the storefront catalogue (`lib/i18n/messages.ts`, `en-US` + `pl-PL`).

- [x] T173 Buy controls — `ProductBuyActions` (unit selector name, quantity label, quote button and its confirmation, the "single piece"/"pcs" defaults, the four `CartAddedPopup` labels it now passes), `AddToRfqButton` (inline pl/en map replaced by catalogue keys), `CompareAddToCartButton` (idle/adding/added label, the refusal fallback — the backend's sentence when it gave one), `ProductCardActions` (every tooltip and accessible name; takes `locale` from `ProductCard`). Transient states through pure helpers in `lib/buyActionLabels.ts`. RED: `storefront/test/catalog/buy-actions-locale.test.tsx`
- [x] T174 Quick-order page — headings, intro, template link, dropzone label, paste label, search, both tables' columns, the quantity inputs' accessible names (`Quantity for {sku}`), preview pills and notices, row actions, build confirmations, the mobile bar. The actions' own refusals travel as a `?problem=` code the page words (an unknown code shows nothing); a backend refusal stays `?error=` with its `detail`. RED: `storefront/test/account/quick-order-locale.test.tsx` (page awaited and server-rendered, EN and PL)
- [x] T175 Native `min` bubbles — the shopping-list row quantity form is `noValidate`; `updateQtyAction` validates through `parseListQuantity` (`lib/shoppingListQuantity.ts`, 1–9999) and a refusal is worded beside the input (`?qtyError=<itemId>`, `aria-invalid`, a polite live region mounted on every row, as on the cart line); the input gains an accessible name and its `Save` button a catalogue label (it sits in the same `UpdateQtyForm`). The return form is `noValidate`; `submit` already clamps to `1 … remaining`, and the input is linked to the "of N" bound. No minimum hint on either: a list holds any positive quantity (the minimum binds at list → cart, FR-011) and a return has none. RED: `storefront/test/account/shopping-list-quantity.test.tsx`, `storefront/test/account/returns-quantity-validation.test.tsx`


## Final gate (U4) — 2026-10-19

- Rebased onto `origin/master` `3d9ca98cd` (six commits: feature 154 PR A, the sales-channel access
  rule). Conflicts kept both sides: `reference-ledgers.ts` (154's and 155's minted codes),
  `quote_requests/off-state.test.ts` and `quick_order/one-click-place.test.ts` (imports),
  `platform/src/http/index.ts` (both side-effect imports). No migration re-stamp (master added none
  to `catalog`, `orders`, `carts`, `quote_requests` or `returns`); the `AGENTS.md` appendix merged
  clean; `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` left no diff.
- `[PG]` run on the fork (`fork-pg-tests`, one `vitest run` per file):
  <https://github.com/bfluks/endora-commerce/actions/runs/39222850146> at `f49d9d990` — **88 files,
  0 failed, 657 tests**: every contract/integration file this branch adds or modifies, the `[PG]`
  files of every Verification block, T142's five cross-cutting files, `openapi-baseline` and master's
  `cart-line-repricing`, `cart-line-refusal-codes`, `place-order-line-price-current` and
  `price-matrix-*`. The first run (`39218234925`, at `637c6a3a1`) had two branch reds, both test
  fixtures, fixed in `7b1ab3ae0` (the locked quote-request buyer's Organization bound to the fixture
  channels — 154's access rule answered 403) and `f49d9d990` (the one-click placement backstop
  doubles `addItems`, the write path since T167), plus a non-test path in the list.
- Pull-request checks green at `f49d9d990`: `quality`, `quality:static`, `test:backend:unit`,
  `test:frontend`, `release:changeset`, `pack-gate`, `boot-gate`, `build:docs`, `dco`
  (<https://github.com/endora-commerce/endora-commerce/pull/366/checks>). This record is the only
  change after that tip (`specs/` only).
- `node backend/scripts/dco-signoff.ts origin/master HEAD`: 0 findings.
- Upstream PR: <https://github.com/endora-commerce/endora-commerce/pull/366> — closes #285 and #294.
- Rebased on `origin/master` `e41a8b0f6` (156 assets library, 154 PR B/C, API description, SEO fix): tip `85e648473`, PR checks green (<https://github.com/endora-commerce/endora-commerce/pull/366/checks>), `[PG]` 88 files / 0 failed / 657 tests (<https://github.com/bfluks/endora-commerce/actions/runs/39269164406>).
- Rebased on `origin/master` `4aa101a51` (154 sign-in, registration, storefront channel and basket channel attribution; release 0.107.0): conflicts kept both sides — 154's per-channel basket on every cart path plus 155's minimums, quote-source exemption, response language and `addItems` options; follow-ups `561cdcf91`, `67e719c51`, `1b7dc4ca2`, `6cdfa8e9a`; no migration re-stamp. `[PG]` 61 files / 0 failed / 493 tests, including master's 21 new or changed 154 contract/integration files (<https://github.com/bfluks/endora-commerce/actions/runs/39375981217>); DCO 0 findings.

---

## Requirement coverage

Every FR traces to a RED task:
FR-001 → T003, T004, T013, T028, T098 · FR-002 → T004, T013, T029, T099 · FR-003 → T028, T098, T100 ·
FR-004 → T013, T028 · FR-005 → T028, T029 · FR-006a → T003, T038, T039, T048 · FR-006 → T039 ·
FR-007 → T039 · FR-008 → T056, T120 · FR-039 → T161 · FR-009 → T039, T056, T057, T058, T067 · FR-010 → T065, T067 ·
FR-011 → T048, T049, T064, T066, T067, T068, T108, T121 · FR-012 → T078, T083, T084 ·
FR-013 → T041, T119 · FR-014 → T030, T113 · FR-015 → T119 · FR-016 → T030, T114 ·
FR-016a → T090, T090a, T091 · FR-017 → T089, T091 · FR-018 → T089, T091, T128 · FR-019 → T091, T091a ·
FR-020 → T089, T091 · FR-021 → T128, T129 · FR-022 → T091 · FR-023 → T035, T095, T104, T117 (+ PL
assertions in T039) · FR-025 → T089, T091 · FR-026 → T050, T075, T077 · FR-027 → T077 ·
FR-028 → T037, T040, T056 · FR-029 → T078 · FR-030 → T083, T084, T106 · FR-031 → T076, T078 ·
FR-032 → T126, T127 · FR-033 → T089, T091a · FR-034 → T100, T135, T138 (docs/changeset, reviewed) ·
FR-035 → T039, T048, T049, T057, T058, T067, T068, T077, T078 · FR-036 → T056a, T056b, T056c ·
FR-037 → T003, T038, T039, T041, T056, T119, T120 · FR-038 → T005, T057a, T063b, T066, T067.
SC-001 → T039, T040, T056, T056a, T057, T067, T068, T078 · SC-002 → T113 · SC-003 → T091 ·
SC-004 → T003, T035, T039, T077, T078, T091, T095 · SC-005 → T028, T100 · SC-006 → T091a.

Threats → task (plan § *Security threat model — disposition*): S1 → T039, T078 · S2 → T039, T077, T078 ·
S3 → T006, T078 · S4 → T040 · S5 → T077 · S6 → T091 · S7 → T083 · S8 → T127 · S9 → T056, T056a ·
F1 → T043, T048, T049, T057, T067, T068 · F2 → T056a, T056b, T056c, T059a · F3 → T056, T057, T059, T067 ·
F4 → T003, T005, T048, T057a, T064, T066, T067 · F5 → T003, T004, T013, T028, T029 · F6 → T075, T077 ·
F7 → T089, T091a · F12 → T024, T080 · F8 → T040 · F9 → T040 · F10 → T006, T066, T078, T086 · F11 → — (accepted) · F13 → T028, T036 · F14 → T090, T090a, T091, T135, T138 · F15 → T127.

## Parallel opportunities

- Phase 2: T003 ‖ T004 ‖ T005 ‖ T006. Every phase's RED tasks are mutually parallel.
- Phase 3: T015, T017, T018 touch three modules (T016 superseded) and may be scaffolded together; T019 ‖ the migrations.
- After Phase 12a: Phases 13 ‖ 15 ‖ 16 ‖ 17 (admin and storefront trees), Phase 14 after 13 only if they share a bundle file.
- Phase 18: T135 ‖ T136 ‖ T138 ‖ T139.

## Implementation strategy

MVP = Phases 1–6 (configure minimums and flag; storefront add/edit enforced, cart view flags).
Then batch paths and placement (7–9), quote requests (10–11), returns (12, 12a), UI (13–17);
Phases 18–21 close the feature.
