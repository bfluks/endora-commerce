# Tasks: Custom fields as admin list filters (`specs/157-custom-fields-list-filters/`)

**Input**: [spec.md](./spec.md) (clarified 2026-10-16), [plan.md](./plan.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/list-filter-api.md](./contracts/list-filter-api.md),
[contracts/admin-surfaces.md](./contracts/admin-surfaces.md), [quickstart.md](./quickstart.md).

**Organisation**: thirteen phases, each ≤ 10 tasks and **independently committable** on
`feat/157-custom-fields-list-filters` (branched from `origin/master` in its own `git worktree` —
T000; `git commit -s`, English conventional message, no AI trailer). Each phase ends with a
**Verification** block: one command per line, run serially, in order — **only the phase's new or
changed tests, the derived-artefact tests whose input the phase changed, and its `[PG]` files**;
the heavy suites run on the fork's CI in Phases 12–13 (standing rule 12). Phases are marked
**[backend]**, **[admin UI]**, **[docs]** or **[gate]**; admin UI phases may be routed to
`endora-commerce-designer`.

**Feature number.** `157` in this file (the directory, the branch, the `cf157_` fixture prefix,
`.changeset/157-*`) is the number T000 confirmed free on `origin/master` above the floor; the
draft number was renamed to it before the first commit.

**Refreshed 2026-10-19 against `origin/master` `3d9ca98cd`** (the plan was written on `194698a9e`,
its spec on `fda284a45`). Fourteen commits landed since `194698a9e` (feature 154 PR A — sales-channel
access —, newsletter engagement tracking, customer sign-in throttling, admin grant ceilings); none
touches `custom_fields`, saved views, `admin-kit`, the CRM board or the three list endpoints, so
**no task is already done or invalidated**. What moved: line positions in
`packages/contracts/src/errors.ts` and `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
(new codes — T007 appends beside them), `backend/test/fixtures/openapi-baseline.json` (T027/T037
re-record anyway), `backend/scripts/check-port-dependencies.ts` (two platform-owned names — T026's
premise unchanged: `orders` still resolves `customFieldValueService` without `custom_fields` in
`dependencies`), and `backend/test/helpers/*` (buyers are now assigned to the store they shop on —
standing rule 6). Admin routes are outside the new sales-channel access step, so the three new
`…/custom-field-filters` routes need no `salesChannelAccess` option. Anchors were re-verified; the
corrections are listed in plan.md § *Refresh 2026-10-19*. The in-flight
`feat/155-catalog-order-constraints` overlaps this plan in shared files only (plan.md § *Overlap
with feat/155*).

## Format

`- [ ] T### [P?] [US?] Description — path(s)`

- **[P]** — may be written in parallel with its neighbours (different files, no dependency on an
  unfinished task).
- **[US1] [US2] [US3]** — the story served; none = shared.
- **RED** — the deliverable is a failing test. Run it and see it fail **for the reason named**
  before starting the task that turns it green (Constitution III).

## Standing rules for every task

1. **Rebuild what you edit.** Tests read each package's `dist`; `tsc` reads sources. After editing
   anything under `packages/`, run `pnpm --filter <package> run build` before a test that imports
   it (`@endora-commerce/contracts`, `@endora-commerce/admin-kit`, `@endora-commerce/mod-custom-fields`,
   `@endora-commerce/mod-orders`, `@endora-commerce/mod-quote-requests`, `@endora-commerce/mod-crm`,
   `@endora-commerce/mod-i18n`). A test helper that imports a service from `src` can load a second
   copy of an entity class — import from `dist`.
2. **Admin component tests render inside `<StrictMode>`** — wrap the element passed to
   `renderWithI18n` (`admin/test/helpers/render-with-i18n.tsx` does not add it). Set an "alive"
   flag in the effect body and clear it in cleanup; mark an action done only once its response
   has arrived.
3. **Never put a test next to a module's `src/manifest.ts`** — `manifests:check` rejects it.
   Module unit tests go under `src/backend/` beside their subject; admin tests under `admin/test/`;
   server-bound tests under `backend/test/{contract,integration}/`.
4. **Paths in `pnpm --filter backend …` commands resolve from `backend/`** — a module source is
   `../packages/modules/<id>/src/…`. `check:*` scripts are `backend` scripts.
5. **Postgres-backed tests run one file per invocation**, from `backend/`, with the services
   environment **derived from the root `.env`, never hard-coded**: this repository is built on
   two machines whose published ports differ (one: Postgres 5432, Redis 6380, Meilisearch 7700;
   the other: 55433, 56379, 57700), and both record theirs in `.env` as `POSTGRES_PORT`,
   `REDIS_PORT`, `MEILISEARCH_PORT`. Nothing is exported — an agent's shell is reset between
   commands, so a variable defined once does not survive to the next line. Every server-bound
   command in this file is therefore written out in full in the **`[PG]` line form**:

   ```bash
   (cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run <one file>)
   ```

   It reads only those seven keys (never sources the whole file), falls back to `.env.example`'s
   defaults for an absent key, and needs the root `.env` present — copy it into a fresh worktree
   before the first `[PG]` line. To check the expansion on a new machine, run the line once with
   `sh -c 'echo $TEST_DATABASE_URL $REDIS_URL $MEILISEARCH_URL'` in place of
   `pnpm exec vitest run <one file>`. A unit test without services:
   `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <file>`.
6. **Fixtures are per run.** Every definition key a server-bound test creates is
   `` `cf157_${randomUUID().slice(0, 8)}_<name>` `` and every record title/mark carries the same
   suffix; assertions check membership by id, never a whole list's length (the test database is
   shared across files). Definitions a test creates are deleted in `afterAll`. A test that needs a
   buyer to create an Order or a Quote Request uses a buyer assigned to the store it shops on
   (since feature 154 a customer request on an unassigned channel is refused) — reuse the seeded
   buyers or `backend/test/helpers/sales-channel-access.ts`, as current placement tests do.
7. **No permanent shared-state mutation.** Extra admins get **their own** stub session ids in
   `backend/test/helpers/test-actors.ts` (`ADMIN_COOKIES`) and their roles/users are created by the
   test file itself; no existing role is edited. A test that changes the CRM board's stored card
   fields reads the stored choice first and writes it back in `afterAll`.
8. **A regenerated artefact is committed with its input** — `composer:generate` (migrations
   registry, docs sidebar, module map), `manifests:generate` + `pnpm install --lockfile-only`
   (package manifests, lockfile), `UPDATE_OPENAPI_BASELINE=1` (OpenAPI fixture).
9. **A new error code lands in one commit with all four of its places**: `ERROR_CODES`, the
   `MINTED_ERROR_CODES` ledger, the owning manifest's `errorCodes`, and the sentence in both bundles.
10. **Deleting or moving a file?** `grep -rn` its name across `backend/test`, `admin/test`, `docs/`
    and `backend/scripts/ledgers` in the same commit (`AGENTS.md`, traps).
11. **Public repository**: English only in code, tests, specs, docs and commits (Polish only in
    `pl.json` and the Polish docs tree); no client names, ticket ids or private file references.
12. **Remote-CI rule.** Locally: filtered `typecheck` / `lint` of each workspace the phase touched,
    the phase's own new or changed tests (named files, never a whole admin module directory), the
    derived-artefact tests its inputs feed, its `[PG]` files and the `check:*` scripts named. **Never
    locally**: `pnpm -r …`, the whole `test:unit:fast`, `test:frontend`, `pack-gate`, `boot-gate`,
    the docs build, or a sweep of unchanged server-bound files — those run on the fork's CI on the
    pushed tip (Phases 12–13), which is also where `check:naming` / `check:language` run on Linux.
    Any command containing a pipe starts with `set -o pipefail;`.

---

## Phase 1: Shared contracts and the minted error code **[backend]**

**Goal**: every shape of [contracts/list-filter-api.md](./contracts/list-filter-api.md) §1–§2 in
`@endora-commerce/contracts`, before any route (research R-1, R-2, R-4, R-6, R-11).

- [x] T000 **Upstream drift check and worktree — stop and report on any finding.** This plan was
  refreshed against `origin/master` `3d9ca98cd`. From the primary checkout's parent directory, with
  `N` the first free number (replace `<N>`); each line is self-contained:
  ```bash
  git -C endora-commerce fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
  set -o pipefail; N=<N>; specs_on_master="$(git -C endora-commerce ls-tree --name-only origin/master specs/)" && { printf '%s\n' "$specs_on_master" | grep -E "^specs/${N}-" && echo "STOP: ${N} is taken on origin/master" || echo "${N} is free on origin/master"; }
  set -o pipefail; git -C endora-commerce show origin/master:specs/pre-migration-history/README.md | grep -F '| Last pre-migration feature |'
  set -o pipefail; N=<N>; remote_heads="$(git -C endora-commerce ls-remote --heads origin)" && { printf '%s\n' "$remote_heads" | grep -E "refs/heads/[a-z]+/${N}-" && echo "STOP: a remote branch carries ${N}" || echo "no remote branch carries ${N}"; }
  git -C endora-commerce log --oneline 3d9ca98cd..origin/master -- packages/modules/custom_fields packages/contracts/src/custom-fields.ts packages/contracts/src/crm.ts packages/contracts/src/saved-list-views.ts packages/admin-kit/src/components packages/modules/orders/src/backend/routes.ts packages/modules/orders/src/backend/services/order-list-service.ts packages/modules/orders/src/backend/services/order-export-service.ts packages/modules/orders/src/admin/pages/OrdersList.tsx packages/modules/quote_requests/src/backend/routes.admin.ts packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts packages/modules/quote_requests/src/admin/pages/RfqList.tsx packages/modules/crm/src/backend/services/opportunity-service.ts packages/modules/crm/src/backend/services/board-service.ts packages/modules/crm/src/backend/domain/board-card-fields.ts packages/modules/crm/src/admin/pages/OpportunitiesList.tsx packages/modules/crm/src/admin/pages/OpportunityBoardPage.tsx backend/test/integration/custom_fields backend/test/integration/quote_requests/off-state.test.ts backend/test/integration/crm/off-state.test.ts
  git -C endora-commerce grep -n -E "listFilter|list_filter|customFieldListFilterPort|customFieldFilters|CUSTOM_FIELD_FILTER_UNAVAILABLE" origin/master -- packages backend/test admin/test
  ```
  **Stop and report** when `${N}` is taken or not above the floor, a remote branch carries it, or
  the `grep` prints anything. The `git log` will print `feat/155-catalog-order-constraints`' merge
  if it has landed: then re-derive the anchors plan.md § *Overlap with feat/155* lists as shifting
  (`orders/src/backend/routes.ts:604` → `:607`, `contracts/src/orders.ts:493-525` → `:510-542`,
  `rfq-service.ts:1340` → `:1513`) and correct the task text before T001; any **other** commit on those paths is a stop. Then stand the worktree up
  (`AGENTS.md` § *Commands*; never a symlinked `node_modules`), copy the four untracked `.env`
  files, build, and run the **renumber sweep** (every occurrence of the draft number in
  `specs/<dir>` and the changeset names below → `${N}`; done — the draft number was swept to 157):
  ```bash
  git -C endora-commerce worktree add ../endora-commerce-wt-<N> -b feat/<N>-custom-fields-list-filters origin/master
  bash endora-commerce-wt-<N>/scripts/setup-worktree.sh
  for f in .env backend/.env admin/.env storefront/.env; do cp -p "endora-commerce/$f" "endora-commerce-wt-<N>/$f" || echo "MISSING: $f"; done
  git -C endora-commerce-wt-<N> check-ignore -v .env backend/.env admin/.env storefront/.env
  (cd endora-commerce-wt-<N> && pnpm run build:packages)
  ```
  Do not start a second service stack from the worktree — the copied `.env` points at the primary
  checkout's services.
  **Result** (2026-10-19): fetched `origin/master` `74cbeca9b`; `N` = 157; floor: last
  pre-migration feature `136`. `157 is free on origin/master`; `no remote branch carries 157`. The
  path-scoped `git log 3d9ca98cd..origin/master` printed nothing (eight commits since the refresh base, six of them
  non-merge: feature 154 PR C and a SEO fix; none touches the named paths, nor `contracts/src/orders.ts`,
  `contracts/src/errors.ts`, `contracts/src/index.ts`, `custom_fields` or the error-code ledger);
  `feat/155-catalog-order-constraints` has not landed, so no anchor moved. The `git grep` printed
  two lines, both a substring false positive present since the spec base: `listFiltersSchema` in
  `packages/modules/blog/src/backend/routes.admin.ts:46,78` (also on `3d9ca98cd` and `fda284a45`) —
  not drift. Worktree, `.env` copies and `setup-worktree.sh` were done by the coordinator; the
  packages had not been built, so `pnpm run build:packages` was run here before any test.
- [x] T001 [P] **RED** New `packages/contracts/src/custom-fields.test.ts`: `customFieldFilterSchema` accepts each operator alone and rejects an unknown one (`like`) by `.strict()`; `contains` is trimmed and bounded 1–200, `in` 1–50 entries of 1–200, `min`/`max` reject `'ten'` and accept `'-12.5'`, `from`/`to` reject `'2026-02-30'`; `customFieldFiltersSchema` rejects key `Bad-Key`, `custom:x` and `__proto__`, accepts `constructor` as an ordinary key (refusing it is the port's job, T018), accepts 10 keys and rejects 11 (`CUSTOM_FIELD_FILTERS_MAX_KEYS`), accepts 100 `in` values summed over keys and rejects 101 (`CUSTOM_FIELD_FILTERS_MAX_IN_VALUES`; threat model F-1); `customFieldFiltersQueryParamSchema` maps `undefined` and `''` to `undefined`, refuses an **array** (a repeated parameter — threat model F-3), refuses `'{x'` with message `customFieldFilters is not JSON`, locates a bad bound at path `[key, 'from']` relative to the parameter, and refuses a raw string over 8000 characters; is **idempotent** — `parse(parse(raw))` equals `parse(raw)`, an already-parsed object validated, an invalid object refused (contract §1.2: the route validator replaces `request.query` and the Orders handlers parse it again); `customFieldDefinitionSchema` requires `listFilter: boolean`; `createCustomFieldDefinitionSchema.parse` without `listFilter` leaves it `undefined`; `updateCustomFieldDefinitionSchema.parse({ labelDefault: 'x' })` carries neither `listFilter` nor `config` (the erase-on-patch regression the schema's comment describes); `customFieldEntityTypeInfoSchema` requires `listFilter`; `customFieldListFilterFieldSchema` has no `audience`, `required`, `config` or `listFilter` and is `.strict()` (threat model F-7); `isCustomFieldFilterUnavailableFailure` is true for an `Error` named `CustomFieldFilterUnavailableError` with a `keys` array and false for a plain `Error`, `null` and `{ keys: [] }`; `CUSTOM_FIELD_DEFINITION_ERROR_CODES` contains `list_filter_unsupported`. Fails: exports do not exist
- [x] T002 Implement the additions in `packages/contracts/src/custom-fields.ts` exactly as contract §1 (filter schemas, `CUSTOM_FIELD_FILTERS_MAX_KEYS` = 10 and `CUSTOM_FIELD_FILTERS_MAX_IN_VALUES` = 100, the JSON parameter schema modelled on `crm.ts:386-410`, `listFilter` on the definition/create/update/record/entity-type shapes, the field DTO and its response envelope, `CustomFieldListFilterPort`, `CustomFieldListFilterCondition`, the failure interface and guard, the error-code union member); confirm `packages/contracts/src/index.ts` re-exports them; T001 green — **As built**: Zod 4's `z.record` skips an own `__proto__` key silently rather than refusing it, so `customFieldFiltersSchema` pipes the record behind a check that refuses that key explicitly (T001 holds it). `CustomFieldListFilterPort`'s doc block carries no `Container name:` marker yet: `check:port-shape` refuses a published name nothing registers, so the marker lands with the registration in T020
- [x] T003 [P] **RED** Extend `packages/contracts/src/crm.test.ts`: `crm.OpportunityFieldFilterSchema` **is** `customFieldFilterSchema` (`toBe`); every existing `fieldFilters` case stays as it is. Fails: two distinct objects
- [x] T004 In `packages/contracts/src/crm.ts:367-378` replace the operator object with `export const OpportunityFieldFilterSchema = customFieldFilterSchema;` (keep `OpportunityFieldFilter`, `OpportunityFieldFiltersSchema`, `fieldFiltersParamSchema` unchanged) and rewrite the `fieldFilters` doc comment (`:420`) to the two modes of contract §5.3; T003 green, existing `crm.test.ts` green
- [x] T005 [P] **RED** Extend `packages/contracts/src/orders.test.ts`: `adminOrdersListQuerySchema` parses `customFieldFilters='{"src":{"in":["a","b"]}}'` to the object, leaves it `undefined` when absent, and refuses a malformed bound with an issue at `['customFieldFilters', 'src', 'min']`; `adminOrdersListQuerySchema.parse(adminOrdersListQuerySchema.parse(q))` equals the single parse for a query carrying `customFieldFilters`, `status` twice and `pageSize` (the double parse `routes.ts:604` performs after the route validator). Fails: unknown key stripped
- [x] T006 Add `customFieldFilters: customFieldFiltersQueryParamSchema` to `adminOrdersListQuerySchema` (`packages/contracts/src/orders.ts:493-525`); T005 green
- [x] T007 Mint `CUSTOM_FIELD_FILTER_UNAVAILABLE` in **one commit** (standing rule 9; contract §2): member of `ERROR_CODES` in `packages/contracts/src/errors.ts`; `MINTED_ERROR_CODES` entry in `backend/test/fixtures/error-code-routing/reference-ledgers.ts` (`to: 'custom_fields'`, tier `T1`, reason: the noun is the definition and its list-filter attribute, decided by `custom_fields`' port; raised by `orders`, `quote_requests` and `crm`, as `CUSTOM_FIELD_VALUE_INVALID` is raised by its hosts); `{ code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE' }` in `packages/modules/custom_fields/src/manifest.ts` `errorCodes` with a sentence in its doc block; `errors.CUSTOM_FIELD_FILTER_UNAVAILABLE` in `packages/modules/custom_fields/i18n/en.json` and `pl.json` with `{key}`
- [x] T008 Record sweep for the new required members: `set -o pipefail; grep -rn "audience: '" packages backend/test admin/test --include=*.ts --include=*.tsx | grep -v /dist/` lists every hand-built `CustomFieldDefinitionRecord` / `CustomFieldDefinitionDto` / entity-type fake (they had to gain `audience` the same way); add `listFilter: false` where the type now requires it; typecheck each package the grep touched — **As built**: the grep found two record fakes (`backend/test/unit/catalog/attribute-definition-read-port.test.ts`, `catalog-attribute-read.service.test.ts`, the latter keeps its import of `CachedDefinition` from `custom_fields`' source — dropping it makes `check:test-ownership` read the file as `catalog`'s alone and misplaced — and passes its stub as `definitions as unknown as CustomFieldDefinitionReadPort`, the stub answering the cache's entity shape where the port publishes records); the production producers also needed the member before T014 stores it, so `toCustomFieldDefinitionRecord`, `serialize`, the `entity-types` answer and `FALLBACK_ENTITY_TYPES` answer `listFilter: false` until T014 replaces them; `backend/test/integration/custom_fields/entity-owner-presence.test.ts`'s exact `entity-types` row gains `listFilter: false` (T011 turns it to `true`), and `custom_fields`' co-located `definition-read-by-id.test.ts` expects the member on the mapped record
- [x] T009 Changeset `.changeset/157-contracts-custom-field-filters.md` — `'@endora-commerce/contracts': minor`: the shared custom-field filter schemas and query parameter, `listFilter` on definitions and entity types, the list-filter field DTO, `CustomFieldListFilterPort` and its failure guard, `OpportunityFieldFilterSchema` now the shared schema (same shape), the `customFieldFilters` member of `adminOrdersListQuerySchema`, and `CUSTOM_FIELD_FILTER_UNAVAILABLE` (`specs/conventions/release-intent.md`)

**Verification**:
```bash
pnpm --filter @endora-commerce/contracts exec vitest run src/custom-fields.test.ts src/crm.test.ts src/orders.test.ts
pnpm --filter @endora-commerce/contracts run typecheck
pnpm --filter @endora-commerce/contracts run lint
pnpm --filter @endora-commerce/contracts run build
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-catalog run typecheck
pnpm --filter backend run typecheck
pnpm --filter backend run check:error-translations
pnpm --filter backend run check:bundle-pairing
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/error-code-routing-equality.test.ts test/unit/_i18n/error-code-migration-progress.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/_i18n/error-code-ownership.test.ts)
```

(Phase 1 now holds ten tasks: T000 – T009. The whole `test/unit/_i18n` directory it used to run is
replaced by the two files a minted code feeds; the directory runs in the fork's
`test:backend:unit` job.)

---

## Phase 2: `custom_fields` — the `listFilter` attribute and the `quote_request` owner **[backend]**

**Goal**: FR-001 – FR-004, FR-005a and the server half of FR-003a/FR-006 (research R-1 – R-3;
data-model §1–§2).

- [x] T010 [P] **RED** Co-located `packages/modules/custom_fields/src/backend/services/custom-field-registry.test.ts`: exactly `order`, `quote_request`, `opportunity` carry `listFilter: true`; `quote_request.ownerModuleId === 'quote_requests'`, `opportunity.ownerModuleId === 'crm'`, no other entry declares an owner; `product` keeps `managedBy`. Fails: no marker, no owner on `quote_request` — **Done**: RED (no marker, no `quote_request` owner), green after T014
- [x] T011 [P] [US2] **RED** Extend `backend/test/integration/custom_fields/entity-owner-presence.test.ts` (FR-005, FR-005a, SC-006): replace the single owned type with a table `[['opportunity', 'crm'], ['quote_request', 'quote_requests']]`; `UNOWNED` loses `quote_request`; the offered row of each owned type now carries `listFilter: true`; for **each owned type × each axis** (`deactivated`, `platform-unavailable`) with `withModuleOff`: the type is omitted from `GET …/entity-types` and every other type answers exactly as before; no definition of it is served by list, by type or by id; **every** write answers 409 `CUSTOM_FIELD_HOST_MANAGED` — definition `POST`, `PATCH` and `DELETE`, and option `POST`, `PATCH` and `DELETE` (threat model F-11: not `POST` alone) — and none of them changes a row; after the module returns, a definition created beforehand with `listFilter: true` and two options, and a value stored on one record of that type (a Quote Request for `quote_request`, an Opportunity for `opportunity`), read back **unchanged** (US2-6, US2-7). Fails: `quote_request` is still offered while `quote_requests` is off — **Done**: per-run `cf157_` keys; value written straight to the host row (as `custom-field-audience.ts` does), records from `createCrmOpportunity` / `submitCrmQuoteRequest`; RED 9 of 23, green 23/23
- [x] T012 [P] [US3] **RED** New `backend/test/integration/custom_fields/list-filter-option.test.ts` (own stub session for a `custom_fields:read`-only admin, standing rule 7): `POST` an Order definition of **each of the six value types** with `listFilter: true` → 201 and `listFilter: true` echoed (FR-001, FR-002); without the member → `false`; `PATCH { listFilter: true }` then `{ listFilter: false }` each write one `custom_fields.definition.updated` audit entry whose `before`/`after` differ in `listFilter` (FR-003); a label edit and a `required` change each write one `custom_fields.definition.updated` entry whose `before`/`after` differ in exactly that member; adding an option writes `custom_fields.option.created`, relabelling it and reordering it each write `custom_fields.option.updated`, removing it writes `custom_fields.option.deleted` (FR-003a — every editor action is one audited Command; analyze #2); an Order holding a value for the key keeps a byte-identical `custom_field_values` across the toggles, a label edit and `required: true` (FR-004, US3-1, US3-4, US3-7); `listFilter: true` on `category`, `customer`, `organization` → 422 `CUSTOM_FIELD_DEFINITION_INVALID` on `POST` and `PATCH`, `false` accepted (FR-001, US3-2); `entity-types` answers `listFilter: true` for exactly the three types; an option `PATCH` carrying `value` leaves the stored value unchanged (US3-5); deleting an option an Order holds → 409 whose message names the option value (US3-6); `PATCH { valueType }` while values exist → 409 (US3-8); the read-only admin's `PATCH` → 403 (US3-9). Fails: unknown member stripped, no refusal — **Done**: read-only admin via `seedCrmAdmin(…, ['custom_fields:read'])` (own stub session, undone in `afterAll`); Orders from `seedCrmOrder`; audit read through `h.auditLogService.query`; RED 11 of 16, green 16/16
- [x] T013 Scaffold `pnpm --filter backend run migration:new -- --module custom_fields --name definition_list_filter` and write `up`/`down` per data-model §1 (never pick a timestamp); `pnpm --filter backend run composer:generate`; commit the regenerated `backend/src/db/migrations-registry.generated.ts` — **Done**: `20261019T103522_custom_fields_definition_list_filter.ts`; also listed in the module's `src/migrations/index.ts` barrel (not regenerated)
- [x] T014 Implement the attribute (data-model §1–§2): `listFilter` on `CustomFieldDefinition` (+ `[OptionalProps]`); registry markers and `ownerModuleId: 'quote_requests'` in `custom-field-registry.ts`; `list_filter_unsupported` in `CustomFieldDefinitionError` and its check in `applyCreateDefinition` / `applyUpdateDefinition` and the service's `create` / `update`; `listFilter` in `snapshotDefinition` (`commands/definition-commands.ts`), `serialize` (`routes.admin.ts`), `toCustomFieldDefinitionRecord` (`custom-field-read-port.ts`) and the `entity-types` answer; move `isOwnerPresent` out of `routes.admin.ts` into the registry module as `isEntityTypeServed(entityType)` so the routes and the Phase 3 port share one statement of the rule; T010 – T012 green — **Done**: also replaced the four Phase 1 `listFilter: false` placeholders (read port, `serialize`, `entity-types`; the fallback list keeps `false` by design). `isEntityTypeServed` keeps the old rule for a type the registry does not hold (served), so no behaviour moves for legacy rows; `offersListFilter` beside it; `assertListFilterSupported` exported from the apply seam and called by the service and both apply functions. `definition-read-by-id.test.ts` fixture now carries `listFilter: true`
- [x] T015 Move `HOST_TABLE_BY_ENTITY` from `custom-field-value.service.ts` into `packages/modules/custom_fields/src/backend/services/host-storage-binding.ts` (exported `hostStorageBinding(entityType)`), value service importing it — no behaviour change; grep for the old name (standing rule 10); co-located `value-probe-binding.test.ts` green — **Done**: no other reference to the old name outside spec history
- [x] T015a [P] [US2] **RED** `admin/test/modules/custom_fields/CustomFieldsPage.fallback-types.test.tsx` (StrictMode; the module client mocked as `CustomFieldsPage.audience.test.tsx` does, with `GET …/entity-types` left pending): before `entity-types` answers, the create form's entity select offers no *Quote request* option and still offers *Order*; once it answers with `quote_request`, the option appears (FR-005a; analyze #7). Fails: the fallback list offers it — **Done**: RED (fallback offered *Quote request*), green
- [x] T016 Remove `quote_request` from `FALLBACK_ENTITY_TYPES` in `packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx:17-23` (the page must not offer the type before `entity-types` answers — FR-005a); T015a green — **Done**
- [x] T017 Changeset `.changeset/157-custom-fields-list-filter-attribute.md` — `'@endora-commerce/mod-custom-fields': minor`, body opening with **"Behaviour change for API clients"**: Quote Request definitions are no longer listed, served or writable while `quote_requests` is switched off (they return unchanged with it); definitions carry `listFilter`, settable on Order, Quote Request and Opportunity definitions and refused (422) elsewhere; `entity-types` items carry `listFilter` — **Done**

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter @endora-commerce/mod-custom-fields exec vitest run src/backend/services/custom-field-registry.test.ts src/backend/services/value-probe-binding.test.ts src/backend/services/value-validation.test.ts src/backend/services/definition-read-by-id.test.ts src/backend/services/definition-rename-key.test.ts
pnpm --filter admin exec vitest run test/modules/custom_fields/CustomFieldsPage.fallback-types.test.tsx test/modules/custom_fields/CustomFieldsPage.audience.test.tsx
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/entity-owner-presence.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/list-filter-option.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/us4-capability-optin.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/custom_fields/host-managed.test.ts)
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/custom_fields/no-entity-capability-logic.test.ts test/unit/custom_fields/definition-apply-seam.test.ts test/unit/db/migrations-registry.test.ts test/unit/db/migration-order.test.ts test/unit/db/migration-ownership.test.ts
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-custom-fields run lint
pnpm --filter backend run check:command-coverage -- --strict
pnpm --filter backend run check:transaction-context
pnpm --filter backend run overlay:check
```

---

## Phase 3: `custom_fields` — the list-filter port **[backend]**

**Goal**: `customFieldListFilterPort` (research R-4 – R-6; contract §1.4).

- [x] T018 [P] **RED** Co-located `packages/modules/custom_fields/src/backend/services/custom-field-list-filter.service.test.ts` over a stub definition source and a stub presence check. **Shape** (threat model F-1): `condition(type, undefined)` and `(type, {})` → `null`; ten keys of every value type, with ranges on both ends → **one** condition whose SQL names the host table exactly once (`from "<table>"` occurs once; a multiselect's `jsonb_array_elements_text` sub-select is not a table scan), every predicate ANDed in one `where` and `min`+`max` on one key inside the same scan; keys whose operators do not apply to their type (`contains` on a number) → `null`. **Caps**: 11 keys, and 101 `in` values spread over three keys, each throw a `ZodError` before the definition source is read. **Refusal**: an unknown key, a key defined only on another type, a key whose definition has `listFilter: false`, and the keys `constructor` and `toString` (threat model F-4 — no prototype member is taken for a definition) are refused **together** in one `CustomFieldFilterUnavailableError` whose `keys` are in request order, and nothing is built; a type whose owner is absent → `listFilterable` answers `[]` and every key is refused (FR-005). **Predicates**: `in` builds one predicate (OR inside). **Injection** (threat model F-9): with `contains` and `in` values `it's`, `a"b`, `what?`, `100%`, `x;--`, `$1`, `a\b` and `?|` — every one of them, and every definition key, appears only in `params`, never in `sql`; the count of `?` in `sql` equals `params.length`; the SQL contains no `::date`, and no jsonb `?`, `?|` or `?&` operator; `::numeric` appears only inside a `jsonb_typeof(…) = 'number'` guard; it names the bound table (`orders`, `quote_requests`, `crm_opportunities`) through `hostStorageBinding`; a text pattern escapes `%`, `_` and `\`. **Offered fields**: `listFilterable` orders by `sortOrder` then `key`, options by `sortOrder`, and each item has exactly the members `key`, `valueType`, `label`, `labelDefault`, `options` — no `audience`, `required`, `config` or `listFilter` (threat model F-7) — `internal` fields included (FR-017). Fails: service does not exist — **Done**: RED (no service), 14/14 green. Deviations: the cap breach is matched by `name: 'ZodError'` (the module has no `zod` dependency); `toString` is refused by the key grammar (ZodError), so the prototype-member case uses `constructor`, `valueof`, `tostring`; `::numeric` on the bound is inside the same number guard
- [x] T019 [P] [US1] **RED** New `backend/test/integration/custom_fields/list-filter-conditions.test.ts` (real Postgres). **Composes the server through `setupBackendServer` (`backend/test/helpers/test-server.ts`) and reads `customFieldListFilterPort` off the composed container; it imports nothing from `packages/modules/` — types from `@endora-commerce/contracts` only** — so `check:test-ownership` classifies it as the repository's (analyze #4). Create one Order definition per value type (`listFilter: true`, per-run keys) through the admin route; seed Orders through the fixture helper the orders contract tests already use (`grep -rln "orders" backend/test/helpers`), then set their `custom_field_values` directly; run the port's one condition as `select id from orders where id = any(?) and id in (<the condition>)` over the seeded ids. Asserts FR-008 per type: `text` contains, any case, `%` and `_` literal; `number` inclusive `min`/`max`, either alone, a string-stored value neither matches nor fails the read; `boolean` `is: true` / `is: false` match stored `true` / `false` only, a record without the key matches neither; `date` inclusive `from`/`to`, either alone; `select` any of `in` (OR); `multiselect` any element in `in`, a non-array stored value neither matches nor fails; a record without the key matches no filter; two keys AND (FR-010); stored text values `it's`, `what?` and `100%` are found by `contains` on exactly those strings and `100%` does not match `1000` (threat model F-9 — bound, not spliced). Fails: port not registered — **Done**: 9/9 green. Not observed red: written after T020's service and registration
- [x] T020 Implement `packages/modules/custom_fields/src/backend/services/custom-field-list-filter.service.ts` per contract §1.4 — `condition()` parses its input with `customFieldFiltersSchema` (caps), looks keys up in a `Map` of served, `listFilter`-on definitions, and builds **one** `{ sql, params }` with every predicate ANDed in one `where` (predicates adapted from `packages/modules/crm/src/backend/domain/board-card-fields.ts:206-252` with the boolean rule of research R-5, but not its one-semi-join-per-predicate shape; definitions through the definition service's per-entity cache; `isEntityTypeServed` for the owner rule) and register it in `packages/modules/custom_fields/src/backend/index.ts` with `ctx.di.providePort<CustomFieldListFilterPort>('customFieldListFilterPort', …)`; rebuild; T018 and T019 green — **Done**: `CustomFieldFilterUnavailableError` lives in the service file; the `Container name:` marker restored on the contract (held back in Phase 1)
- [x] T021 Run the composition checks and fix what they report in the files above: `check:port-shape`, `check:port-dependencies`, `check:port-catches`, `check:module-boundary`, `check:platform-surface`, `check:singleton-identity` — **Done**: all six plus `check:test-ownership`, `check:command-coverage`, `check:transaction-context`, `manifests:check`, `composer:check` clean, nothing to fix
- [x] T022 Changeset `.changeset/157-custom-fields-list-filter-port.md` — `'@endora-commerce/mod-custom-fields': minor`: publishes `customFieldListFilterPort` (offered fields and server-side conditions; refusal of unavailable filters) — **Done**

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter @endora-commerce/mod-custom-fields exec vitest run src/backend/services/custom-field-list-filter.service.test.ts
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/list-filter-conditions.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/custom_fields/host-wiring.test.ts)
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-custom-fields run lint
pnpm --filter backend run check:port-shape
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
pnpm --filter backend run check:module-boundary
pnpm --filter backend run check:platform-surface
pnpm --filter backend run check:singleton-identity
pnpm --filter backend run check:test-ownership
```

---

## Phase 4: Orders backend — list, export, offered fields **[backend]**

**Goal**: US1 on the server (FR-007, FR-009 – FR-012, FR-015, FR-017; contract §4).

- [x] T023 [US1] **RED** New `backend/test/contract/orders/custom-field-filters.test.ts` (own stub sessions: an `orders:read`-only role, a `sales_representative` with `orders:read` assigned to Organization A, an admin without `orders:read`). Per-run definitions: Order `select` S (option on, options `a`/`b`/`c`), Order `text` T (on, `internal` audience), and one more option-on Order definition of each remaining value type (`number`, `boolean`, `date`, `multiselect`), Order `select` OFF (option off), Quote Request `select` with S's key. Seed 30 Orders in A (23 `a`, 5 `b`, 2 none) and 2 in Organization B (`a`). Cases: `GET /api/v1/admin/orders/custom-field-filters` → S and T only, not OFF; 403 without `orders:read`; the envelope, not an order 404 (route precedence); `?customFieldFilters={S:{in:[a]}}&pageSize=10` → `total` 25 and pages 1–3 together hold exactly those 25 ids, each once (FR-009, SC-002); `in:[a,b]` → 30 (OR); plus a `status` filter → the intersection (AND); S and T together → AND (FR-010); **the four statements agree under a filter** (threat model F-2 — each wraps its own `raw()`): with S `in:[a]` and with S and T together, the values of `counts` sum to `total`, the values of `paymentStatusCounts` sum to `total`, `pagination.total` equals the number of distinct ids over every page, and `/orders/export`'s `x-export-row-count` header and its CSV data-row count both equal `total`; an unknown key, the Quote Request key, OFF and `constructor` each → 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` with `details.key` (FR-011; threat model F-4), and the same on `/orders/export`; 11 keys → 400 `VALIDATION_FAILED` (threat model F-1); `customFieldFilters` given **twice** → 400 `VALIDATION_FAILED` on the list and the export (threat model F-3); `min: 'ten'` → 400 `VALIDATION_FAILED`; the export's `businessId` column equals the filtered list's (FR-015); the sales representative gets only A's matches, and the refusal for a key is identical for them (FR-012); T (internal) filters (FR-017); an `it.each` over the six value types filters a small seeded set through `/api/v1/admin/orders` with one matching and one non-matching Order per type (SC-003); the 400's `error.message` is the `custom_fields` bundle's English sentence, and the Polish one for an admin whose preferred language is `pl`. Fails: parameter ignored, route absent — **Done**: RED 19 of 26 (parameter ignored, route absent), green 26/26. Deviations: own sessions via `seedCrmAdmin` / `seedCrmSalesRep`, Organizations A and B created per run; one matching and one non-matching Order per value type are seeded in B, so the OR case is asserted inside A (28 = 23 + 5)
- [x] T024 [P] **RED** New `backend/test/unit/custom_fields/list-filter-admin-only.test.ts` (FR-017): a source scan of every module directory (resolved through `scripts/lib/module-roots.ts`, as `no-entity-capability-logic.test.ts` does). **It imports nothing from `packages/modules/` and no module package** — it reads files as text, by path — so `check:test-ownership` finds no owner and leaves it with the repository (analyze #4); asserting that every file naming the literal `customFieldListFilterPort` or the identifier `customFieldFiltersQueryParamSchema` is in an allowlist (`custom_fields`' own sources; `orders`' `backend/index.ts`, `routes.ts`, `services/order-list-service.ts`; the matching `quote_requests` and `crm` files, added to the allowlist by T031 and T036), that no file under a storefront or external/API-key route directory names either, and that `orders`' list service does name the port. Fails on the last assertion until T025 — **Done**: RED on the last assertion, green after T025
- [x] T025 [US1] Implement: `OrderListQuery.customFieldFilters` and its use in `OrderListService.list` (`packages/modules/orders/src/backend/services/order-list-service.ts`): the port's **one** condition is awaited once per request and kept as `{ sql, params }`; a small local function returns a **fresh** `{ id: { $in: raw(…) } }` each time it is called, and it is called once for each of the three statements — the two `countsBy` calls and `findAndCount` (`order-list-service.ts:173-182`) — so the page, `total` and both count maps narrow and no fragment is reused (threat model F-2; the export's `list()` call is one more request through the same path); the port resolved with `lazyPort<CustomFieldListFilterPort>(ctx, 'customFieldListFilterPort')` in `packages/modules/orders/src/backend/index.ts`; in `routes.ts` the list and export handlers narrow by `isCustomFieldFilterUnavailableFailure` (and rethrow everything else, so `check:port-catches` has nothing to report) to map it to `HttpError(400, ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE, …, { key, keys })`; the new `GET /api/v1/admin/orders/custom-field-filters` (`orders:read`); rebuild; T023 and T024 green — **Done**: the port is an optional fifth `OrderListService` argument (the prompt-tools list never filters on custom fields); a request with filters and no port is refused, not answered unfiltered; `plugin.ts` carries the option to the service and the routes
- [x] T026 Run `pnpm --filter backend run check:port-dependencies`. `orders` resolves `customFieldValueService` today without `custom_fields` in its manifest `dependencies`; if the check reports the new edge, add `custom_fields` to `dependencies` and say why in the commit; if it does not, change nothing — **Done**: the check reports nothing; manifest unchanged
- [x] T027 Re-record the OpenAPI baseline: `(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" UPDATE_OPENAPI_BASELINE=1 pnpm exec vitest run test/contract/kernel/openapi-baseline.test.ts)`; accept the diff only if it adds `GET /api/v1/admin/orders/custom-field-filters` and nothing else — **Done**: the diff adds only `GET /api/v1/admin/orders/custom-field-filters`
- [x] T028 Changeset `.changeset/157-orders-custom-field-filters.md` — `'@endora-commerce/mod-orders': minor`: the admin Orders list and CSV export accept `customFieldFilters` (refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` when a key is not offered) and `GET /api/v1/admin/orders/custom-field-filters` lists the offered fields — **Done**

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-orders run build
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/orders/custom-field-filters.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/orders/list-and-views.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/kernel/openapi-baseline.test.ts)
pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/custom_fields/list-filter-admin-only.test.ts
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-orders run lint
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
pnpm --filter backend run check:test-ownership
pnpm --filter backend run check:error-translations
```

---

## Phase 5: Quote Requests backend and off state **[backend]**

**Goal**: US2 on the Quote Request list, inside today's whole-set read (research R-9; contract §5.1).

- [x] T029 [US2] **RED** New `backend/test/contract/quote_requests/custom-field-filters.test.ts` (own stub sessions: an `rfqs:handle` sales representative assigned to Organization A; an admin without `rfqs:handle`). Per-run Quote Request `multiselect` M (option on), `boolean` Y (on) and one option-on definition of each remaining value type, an Order definition with M's key, a Quote Request definition OFF (option off). Seed 30 Quote Requests in A (more than the list's 25-row page) and 3 in Organization B, values varied. Cases: `GET /api/v1/admin/quote-requests/custom-field-filters` → M and Y; 403 without `rfqs:handle`; not shadowed by `/:id`; `?customFieldFilters={M:{in:[x]}}` → exactly the matching ids, each once (FR-009, SC-002, US2-2); OR within M; M and Y AND; `is: false` excludes requests without Y (spec edge case); with `assignmentScope=mine` and with `organizationId=<A>` the result never contains B's requests for the sales representative (FR-012, US2-1); unknown key, the Order key, OFF and `constructor` → 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming the key (FR-011; threat model F-4); `customFieldFilters=x` → 400 `VALIDATION_FAILED`; `customFieldFilters` given **twice** (both well-formed) → 400 `VALIDATION_FAILED`, not the first or the last silently applied (threat model F-3); 11 keys → 400 `VALIDATION_FAILED` (threat model F-1); a filter combined with `organizationId=<A>` returns only A's matching requests (the condition is ANDed through `$and`, not overwriting the organization or status condition); without the parameter the response equals today's (regression); an `it.each` over the six value types, one matching and one non-matching request each (SC-003). Fails: parameter ignored, route absent — **Done**: RED 19 of 22, green 22/22. Requests are submitted by the stub customer then moved into per-run Organizations A/B by SQL; the per-type pairs live in B
- [x] T030 [US2] **RED** Extend `backend/test/integration/quote_requests/off-state.test.ts`: for each axis the `GET …/quote-requests/custom-field-filters` route answers exactly as the file asserts for the module's other admin routes while off, and answers again after; the check `check:off-state-coverage` lists it as covered. Fails: route absent — **Done**: the route added to the `expectModuleAbsent` list; green 6/6, not observed red (run after T031)
- [x] T031 [US2] Implement: `AdminListFilter.customFieldFilters` and its use in `RfqAdminService.listAll` (`packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts:145-153`: the port's one condition pushed into the `em.find` `where` as a `$and` member — never assigned to `where.id` — wrapped in a fresh `raw()`, **before** the visibility and scope passes); the handler in `routes.admin.ts:48-69` first answers 400 `VALIDATION_FAILED` when `request.query.customFieldFilters` is present and not a string (a repeated parameter arrives as an array; threat model F-3), then parses it with `customFieldFiltersQueryParamSchema` (no route-level querystring schema — research R-9) and maps the failure (narrowed by its guard, everything else rethrown) to 400; the new offered-fields route inside the same route function (gated with the module); the port through `lazyPort` in `packages/modules/quote_requests/src/backend/index.ts`; the three files added to T024's allowlist; rebuild; T029, T030 and T024 green — **Done**: the offered fields go through `RfqAdminService.customFieldFilterFields()`; a list asked to filter with no port refuses rather than answering unfiltered
- [x] T032 Re-record the OpenAPI baseline as T027 (accept only `GET /api/v1/admin/quote-requests/custom-field-filters`); changeset `.changeset/157-quote-requests-custom-field-filters.md` — `'@endora-commerce/mod-quote-requests': minor`: `customFieldFilters` on the admin list, the offered-fields route, and that the module's Quote Request custom-field definitions now follow its activation — **Done**: the diff adds only `GET /api/v1/admin/quote-requests/custom-field-filters`

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-quote-requests run build
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/quote_requests/custom-field-filters.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/off-state.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/quote_requests/list-totals-parity.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/quote_requests/list-views.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/kernel/openapi-baseline.test.ts)
pnpm --filter @endora-commerce/mod-quote-requests run typecheck
pnpm --filter @endora-commerce/mod-quote-requests run lint
pnpm --filter backend run check:off-state-coverage
pnpm --filter backend run check:port-dependencies
pnpm --filter backend run check:port-catches
```

---

## Phase 6: CRM backend — FR-011a, the board mode, offered fields, off state **[backend]**

**Goal**: US2 on the Opportunities list; the board unchanged (research R-8; contract §5.2 – §5.3).

- [x] T033 [US2] **RED** New `backend/test/integration/crm/list-custom-field-filters.test.ts` (standing rule 7: read the stored card choice first, restore it in `afterAll`; a `crm:read` sales representative with its own stub session). Per-run Opportunity definitions: A (option on, not on the card), B (on the card, option off), C (on the card, option on), plus one option-on, off-card definition of each value type A and C do not already cover; a builtin `builtin:value` on the card. Cases on `GET /api/v1/admin/crm/opportunities`: `fieldFilters={"custom:A":…}` filters (US2-3); `custom:B` → 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming B (US2-4, FR-011a); `custom:C` filters; **with `cardValues=true`** `custom:B` filters by the card rule and `custom:A` is ignored — today's behaviour (FR-016); with `cardValues=true` a definition D that is neither on the card nor list-filter-enabled answers **200** with the filter ignored, never 400, and the sales representative's result is the same set the request without D returns (threat model F-8 — the mode switch neither refuses nor widens); without `cardValues`, `custom:A` and `custom:C` together AND; 11 `custom:` references → 400 `VALIDATION_FAILED` (the port's caps; threat model F-1); `fieldFilters` given **twice** → 400 `VALIDATION_FAILED` (threat model F-3); `builtin:value` without `cardValues` keeps the card rule; `GET …/crm/board` with `custom:B` filters exactly as before; `GET …/crm/opportunities/custom-field-filters` → A and C (`crm:read`; 403 without; not shadowed by `/opportunities/:id`); more matches than one page — following `cursor` returns each matching id once (FR-009); the sales representative never receives another Organization's Opportunity (FR-012); an `it.each` over the six value types on option-on definitions, one matching and one non-matching Opportunity each (SC-003). Fails: list ignores A, accepts B — **Done**: RED 11 of 20, green 20/20. The stored card choice is read first and restored in `afterAll`; Opportunities are scoped by a per-run title mark (`q`); the per-type pairs reuse A and C for select and text
- [x] T034 [US2] **RED** Extend `backend/test/integration/crm/off-state.test.ts`: for each axis the offered-fields route answers as the module's other routes do while off, and again after (FR-005, US2-5) — **Done**: the route added to `REGISTERED`; RED (route absent), green 29/29
- [x] T035 Deliberate update of existing list `fieldFilters` tests (FR-011a, SC-005): `grep -rn "fieldFilters" backend/test admin/test` and list every request to `…/crm/opportunities` that carries a `custom:` reference **without** `cardValues=true`. Measured on `fda284a45` and re-measured on `3d9ca98cd`: none (`backend/test/integration/crm/quote-requests-off.test.ts:225` sends `cardValues=true` with a built-in reference; the board tests use `…/crm/board`). Re-run the grep; for each hit, change it to assert the FR-011a answer or to set the option, and name it in the commit message — **Done**: the plan's grep missed one: `backend/test/integration/crm/board-card-fields.test.ts` builds its list URL through `tail()`, and its `listed()` asserts the list equals the board for on-card `custom:` fields without the option. Its list request now sends `cardValues=true` (a board lane continued in the list, which is what it asserts); 24/24 green. `board-card-fields.contract.test.ts` needs no change (its list requests carry no `custom:` filter or are refused by shape)
- [x] T036 [US2] Implement in `packages/modules/crm/src/backend/services/opportunity-service.ts` `list(query, card?)`: `card` given or `query.cardValues` → today's path unchanged; otherwise `builtin:` references through `boardFieldFilterConditions` over the card's built-in fields and the `custom:` references through the port as **one** record (keys without the prefix, collected into an `Object.create(null)` record), its one condition wrapped in a fresh `raw()` for the list's statement; a comment at the `cardValues` branch says it is a mode switch and never a security boundary (threat model F-8); the port through `lazyPort` in `packages/modules/crm/src/backend/index.ts`; `routes.opportunities.ts` maps the failure (narrowed by its guard, everything else rethrown) to 400 and adds `GET /api/v1/admin/crm/opportunities/custom-field-filters` (`crm:read`); `board-card-fields.ts` and `board-service.ts` untouched; the CRM files added to T024's allowlist; rebuild; T033, T034 and T024 green — **Done**: the offered fields go through `OpportunityService.customFieldFilterFields()`; `board-card-fields.ts`, `board-service.ts` untouched
- [x] T037 Re-record the OpenAPI baseline as T027 (accept only the CRM offered-fields route); changeset `.changeset/157-crm-list-custom-field-filters.md` — `'@endora-commerce/mod-crm': minor`, body opening with **"Behaviour change for API clients"**: on `GET /api/v1/admin/crm/opportunities` without `cardValues=true`, a `custom:` field filter is governed by the definition's list-filter option instead of the board card (refused with 400 when off); with `cardValues=true` and on the board nothing changes; the offered-fields route — **Done**: the diff adds only `GET /api/v1/admin/crm/opportunities/custom-field-filters`

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-crm run build
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/list-custom-field-filters.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/off-state.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/board-card-fields.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/crm/board-card-fields.contract.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/quote-requests-off.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/integration/crm/custom-fields.test.ts)
(cd backend && eval "$(grep -E '^(POSTGRES_PORT|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_DB|REDIS_PORT|MEILISEARCH_PORT|MEILI_MASTER_KEY)=' ../.env)" && env TEST_DATABASE_URL="postgresql://${POSTGRES_USER:-b2b}:${POSTGRES_PASSWORD:-b2b}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-b2b}_test" REDIS_URL="redis://localhost:${REDIS_PORT:-6379}" MEILISEARCH_URL="http://localhost:${MEILISEARCH_PORT:-7700}" MEILISEARCH_API_KEY="${MEILI_MASTER_KEY:-devMasterKeyChangeMe}" pnpm exec vitest run test/contract/kernel/openapi-baseline.test.ts)
pnpm --filter @endora-commerce/mod-crm exec vitest run src/backend/domain/board-card-fields.test.ts
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-crm run lint
pnpm --filter backend run check:off-state-coverage
pnpm --filter backend run check:port-catches
```

---

**Review and QA round on Phases 2–6 (2026-10-19)** — done:
- `isCalendarDate` / `calendarDateSchema` moved to `contracts/src/common.ts`, used by `crm.ts` and `custom-fields.ts`.
- Date bounds compare only a stored `YYYY-MM-DD` string (`jsonb_typeof` = `'string'` and a shape check); T018 and T019 cover a drifted number and a non-date string.
- An operator that does not apply to the field's type is **refused with 400 `VALIDATION_FAILED`** (not `CUSTOM_FIELD_FILTER_UNAVAILABLE`: the key is available) through `assertCustomFieldFilterOperators`; contract §1.4, research R-6 and the architecture page (en + pl, cache re-pinned) amended. The board keeps ignoring it (FR-016).
- `customFieldFilterUnavailable(keys)` in contracts replaces the hosts' hand-built failures; no-port refusal unit tests for Orders (`order-list-service.custom-field-filters.test.ts`) and Quote Requests (`rfq-admin-list-custom-field-filters.test.ts`); CRM's port stays required, with a comment saying why.
- `rfq-admin-service.ts` pushes into `$and`; the Quote Request list locates a malformed filter at `customFieldFilters.<key>.<op>`; T024's doc names what a path scan cannot tell.
- QA cases adopted: Orders "No" over HTTP, hostile keys and caps over HTTP, option switched off mid-session (list and export 400, then 200 again), the buyer's Orders list ignores the parameter, mismatched operator (Orders 34/34); Quote Requests scope + status + organization + filter (25/25); CRM `is:false` on the list vs the card rule with `cardValues=true`, mismatched operator (22/22); T019 10/10.

## Phase 7: Kit composite, helpers and `core` keys **[admin UI]**

**Goal**: [contracts/admin-surfaces.md](./contracts/admin-surfaces.md) §1 (research R-13, R-14).

- [x] T038 [P] **RED** `admin/test/components/custom-field-filters.helpers.test.ts`: `readCustomFieldFilterParams` ↔ `writeCustomFieldFilterParams` round-trip for every operator, `in` repeated; a malformed operator value (`cf.k.min=ten`, `cf.k.from=2026-02-30`) is dropped, an **unknown key with a well-formed operator is kept** (US1-9), other parameters survive a write, at most 10 keys and 100 `in` values; a key failing `^[a-z][a-z0-9_]{0,63}$` (`cf.Bad-Key.in=x`, `cf.__proto__.in=x`, a 65-character key) is dropped by `read` (threat model F-4); `cf.constructor.in=x` and `cf.toString.in=x` read as ordinary unknown keys — present in the result as own properties, the result's prototype is `null`, `Object.prototype` is untouched — and are written back by `write`; `sanitizeCustomFieldFilters` and `pruneRemovedOptions` treat a `constructor` key as unknown (not offered), never as a field; `sanitizeCustomFieldFilters` keeps offered keys with a parsable filter and reports the rest in `dropped` in input order, prunes `in` values no longer among the field's options (dropping the key when none is left), and drops everything for a non-object input (FR-014; spec edge case "option relabelled or removed"); `pruneRemovedOptions` removes such `in` values for a known field and never removes an unknown key (US1-9); `customFieldFilterChips` builds `"<label>: <summary>"` per type — option labels joined, `≥ 1`, `≤ 9`, `1 – 9`, *Yes*/*No*, *contains “x”* — in the given language with `labelDefault` fallback, and each chip's `remove` returns the filters without that key; `customFieldFilterRefusal` returns `details.key` for an `ApiError` coded `CUSTOM_FIELD_FILTER_UNAVAILABLE` and `null` otherwise; `toCustomFieldFiltersParam` sorts keys and answers `null` for `{}`. Fails: module does not exist
- [x] T039 [P] **RED** `admin/test/components/CustomFieldListFilters.test.tsx` (StrictMode): one control per field by value type, labelled by `label[language]` → base language → `labelDefault`, options likewise; `text` commits once after the 300 ms pause (fake timers); `number` accepts a decimal comma; `date` from/to; `boolean` *Any*/*Yes*/*No* → `null` / `{ is: true }` / `{ is: false }`; `select` and `multiselect` send `{ in }` in the options' order; clearing every operator sends `null`; `expectNoAxeViolations` (`admin/test/helpers/axe.ts`). Fails: component does not exist
- [x] T040 [P] **RED** `admin/test/components/useCustomFieldListFilterFields.test.tsx` (StrictMode, `apiClient` mocked through `@endora-commerce/admin-kit/lib`): reaches `ready` with the fields, `error` on a failed read, never stays `loading` after the double mount. Fails: hook does not exist
- [x] T041 [P] Add the `customFieldFilters.*` keys of contract §1.4 to `packages/modules/_i18n/i18n/en.json` and `pl.json` (Polish differs from English for every key)
- [x] T042 Implement `packages/admin-kit/src/components/custom-field-filters/` (`CustomFieldListFilters.tsx`, `custom-field-filter-params.ts`, `custom-field-filter-chips.ts`, `useCustomFieldListFilterFields.ts`), reading only `useTranslation('core')`; export each binding and its types explicitly from `packages/admin-kit/src/components/index.ts`; rebuild `admin-kit` and `mod-i18n`; T038 – T040 green
- [x] T043 Add the new exports to the `./components` row of `packages/admin-kit/README.md`; changeset `.changeset/157-admin-kit-custom-field-filters.md` — `'@endora-commerce/admin-kit': minor` (the composite, helpers and hook, with their props), `'@endora-commerce/mod-i18n': minor` (the `customFieldFilters.*` keys)

**Phase 7 notes** (stream B):
- Deviation (T038): `cf.toString.in=x` is **dropped**, not kept — the key grammar `^[a-z][a-z0-9_]{0,63}$` refuses the capital `S`, so the contract's "`toString` passes the key regex" does not hold. `constructor` is the one lowercase prototype name and is tested as the ordinary unknown key.
- Deviation (T040): `renderHook` under a StrictMode wrapper issued one `GET`, not two, so "the first mount's answer settling last" could not be staged; the alive flag is proved by changing the endpoint while the first request is in flight and settling it last.
- `number` inputs are `type="text" inputMode="decimal"` (a comma reaches the handler); a bound that is not a number marks the input `aria-invalid` and is not sent.
- Results: T038–T040 31/31 green; `admin-kit` and `admin` typecheck and lint, `check:admin-surface`, `check:bundle-pairing`, `i18n:hardcoded` all rc=0.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-i18n run build
pnpm --filter @endora-commerce/admin-kit run build
pnpm --filter admin exec vitest run test/components/custom-field-filters.helpers.test.ts test/components/CustomFieldListFilters.test.tsx test/components/useCustomFieldListFilterFields.test.tsx
pnpm --filter @endora-commerce/admin-kit run typecheck
pnpm --filter @endora-commerce/admin-kit run lint
pnpm --filter backend run check:admin-surface
pnpm --filter backend run check:bundle-pairing
pnpm --filter backend run i18n:hardcoded
```

---

## Phase 8: Orders and Quote Requests lists **[admin UI]**

**Goal**: US1 and the Quote Request half of US2 in the admin (FR-007, FR-010, FR-011, FR-013 –
FR-015; contract `admin-surfaces.md` §2).

- [x] T044 [US1] **RED** `admin/test/modules/orders/OrdersList.custom-field-filters.test.tsx` (StrictMode; `apiClient` mocked as `admin/test/modules/orders/OrdersList.test.tsx` does; the offered-fields endpoint answering one `select` field): the filter appears among the advanced filters, labelled in the operator's language (US1-1); with no offered field none appears (US1-2); choosing two options sends `customFieldFilters` with `in` of both and `page=1` (US1-3, FR-013); with a status filter both parameters are sent (US1-4); the address gains `cf.<key>.in` entries and other parameters survive; opening `/orders?cf.<key>.in=a` applies the filter on the first request (US1-5); a chip appears and removing it clears the filter; a saved view captures `filters.customFields` and loading it restores the filter (US1-6); loading a view whose saved key is not offered shows the dropped-filter notice and **no** request ever carries that key (US1-7, FR-014); a 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` shows an error naming the field and *Remove this filter* sends the request without it (US1-9, FR-011); a 400 whose `details.key` is `<img src=x onerror="window.__xss=1">` followed by 80 more characters renders that string **as text** — no `img` element in the document, `window.__xss` undefined — truncated to 64 characters with an ellipsis, in the Alert and in any chip (threat model F-5); the filter's label in Polish equals the label the Order detail screen's custom-field panel shows for the same definition and language (one assertion, the shared label rule — analyze #10); the CSV export link carries the same `customFieldFilters` (US1-8, FR-015) and is not offered while that error stands. Fails: no filter offered — **Done**: RED 11/11 (the offered-fields endpoint never requested), green 11/11. The Polish-label case renders the detail panel with `language="pl"` (the Order detail screen passes none today, so it shows `en`)
- [x] T045 [US1] Implement in `packages/modules/orders/src/admin/pages/OrdersList.tsx`: the hook against `/api/v1/admin/orders/custom-field-filters`, `CustomFieldListFilters` in the advanced-filters panel, state seeded from the address, `customFieldFilters` added to the `queryString` memo (so the export link at `:568` follows), the page reset, chips, `filters.customFields` in `toSavedViewState`/`applyView` through `sanitizeCustomFieldFilters` with the notice, the refusal Alert with its remover; rebuild `mod-orders`; T044 green — **Done**: the language comes from `useTranslationContext()`; the refused key or a dropped key is shown by its label when offered, else the key cut to 64 characters; the address is written with `replace`
- [x] T046 [US1] Run every existing `admin/test/modules/orders/OrdersList*.test.tsx`; where a mock's `get` does not answer `/api/v1/admin/orders/custom-field-filters`, answer `{ data: [] }`; no assertion is weakened — **Done**: `OrdersList.test`, `.payment-status`, `.mobile`, `.saved-views` mocks answer the offered-fields endpoint with `{ data: [] }` (the payment-status mock answered it with list rows and failed); no assertion changed; 28/28
- [x] T047 [US2] **RED** `admin/test/modules/quote_requests/RfqList.custom-field-filters.test.tsx` (StrictMode): the same cases as T044 except export and the detail-label assertion (the text-only, truncated refusal rendering included), on `/api/v1/admin/quote-requests/custom-field-filters`; the server fetch carries `customFieldFilters` and is repeated when it changes (it is a server-side filter now, not a client-side one); the footer's total is the length of the narrowed response and page 2 shows its next rows (FR-009); scope and organization keep working beside it. Fails: no filter offered — **Done**: RED 9/9, green 9/9. Rows arrive newest first, so the paging case reads RFQ-23 on page 1 and RFQ-1 on page 2
- [x] T048 [US2] Implement in `packages/modules/quote_requests/src/admin/pages/RfqList.tsx`: the same integration, `customFieldFilters` in `refresh`'s `URLSearchParams` (and in its dependency list), the page reset effect, chips, saved-view capture/restore with sanitising and notice, the refusal Alert; client-side status/search/sort/paging untouched (#317); update the file's header comment to say the custom-field filter is applied server-side; rebuild `mod-quote-requests`; T047 green — **Done**: a refusal also empties the rows
- [x] T049 [US2] Run every existing `admin/test/modules/quote_requests/RfqList*.test.tsx`; answer the offered-fields endpoint with `{ data: [] }` where a mock does not; no assertion is weakened — **Done**: the mobile mock answers the endpoint with `{ data: [] }`; saved-views needed nothing; 18/18
- [x] T050 Changeset `.changeset/157-orders-quote-requests-list-filters-ui.md` — `'@endora-commerce/mod-orders': minor`, `'@endora-commerce/mod-quote-requests': minor`: custom-field filters on the two admin lists — deep-linkable, shown as chips, kept in saved views, a saved filter that is no longer available dropped with a notice, an unavailable filter in the address reported with a way to remove it; the Orders CSV export follows them — **Done**

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-orders run build
pnpm --filter @endora-commerce/mod-quote-requests run build
pnpm --filter admin exec vitest run test/modules/orders/OrdersList
pnpm --filter admin exec vitest run test/modules/quote_requests/RfqList
pnpm --filter @endora-commerce/mod-orders run typecheck
pnpm --filter @endora-commerce/mod-orders run lint
pnpm --filter @endora-commerce/mod-quote-requests run typecheck
pnpm --filter @endora-commerce/mod-quote-requests run lint
pnpm --filter admin run typecheck
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:admin-surface
pnpm --filter backend run check:bundle-pairing
```

---

**Final review round, stream A (2026-10-19)** — done:
- B2: minted `CUSTOM_FIELD_OPTION_IN_USE` (`details.value`, `details.label`) and, rather than a generic `CUSTOM_FIELD_DEFINITION_INVALID` sentence, own codes `CUSTOM_FIELD_VALUE_TYPE_LOCKED` and `CUSTOM_FIELD_STORED_VALUES_EXIST` (`details.key`), each with en + pl sentences; `list-filter-option` 16/16, `recreate-over-orphaned-values` 3/3. An inverted number or date range is refused 400 `VALIDATION_FAILED` (`assertCustomFieldFilterRanges`; contract §1.4).
- Kit: `resolveCustomFieldLabel`, `customFieldDisplayName`, `emptyCustomFieldFilters`, `withCustomFieldFilter`, `withoutCustomFieldFilter` exported, page copies deleted; ranges stack below `sm` with visible bound labels; a non-number bound and an inverted range are explained at the input and not sent; `aria-invalid` border on `Input`; pending commit dropped on an outside change; loading placeholder and failure sentence with *Try again* (`reload()`); chip remove names; Polish copy. Kit tests 49/49.
- Pages (Orders, Quote Requests, Opportunities): saved views sanitised only against loaded fields; a refusal replaces the results; focus moves to the results after *Remove this filter*, the reload is announced; the dropped notice is `warning` and cleared on any custom-filter change and *Clear all*; Orders resets the page in the same update and ignores a stale answer (D4); Opportunities clears a refusal on each load (D5) and prunes through the address; Quote Requests and Opportunities send an unchanged request once (StrictMode). Not observed red: the page behaviour was written before these tests. Orders 23/23, Quote Requests 16/16, Opportunities 27/27.
- B's editor round picked (`custom_fields` bundles merged by hand), `DefinitionOptionsEditor` reads `ERROR_CODES.CUSTOM_FIELD_OPTION_IN_USE` only, `localized-label.ts`'s `resolveLabel` replaced by the kit's.
- Not built: Opportunities "More filters (n)" (awaiting the owner).

**Owner ruling U1 A (2026-10-19), stream B** — done: the Opportunities list shows the first **3** custom-field filters (with the built-in filters' 10 spans on the 4-column grid, three cells and the disclosure finish a row) and the rest behind *More filters (n)* / *Więcej filtrów (n)*, a `<button type="button">` with `aria-expanded`, `aria-controls` (the filter grid) and `min-h-11`. A later field with an active filter is shown collapsed; a shown field stays while its filter is cleared, until the next toggle or *Clear*; expanding appends and moves nothing already visible, and a filter turning active while expanded does not reorder the grid. Open state is not remembered (every visit starts collapsed). Kept local to `OpportunitiesList.tsx` rather than a kit `visibleCount` prop, because the kit belongs to stream A. Red first: `admin/test/modules/crm/OpportunitiesList.more-filters.test.tsx` 7 of 9 red, then 10/10. crm docs (en + pl) carry one sentence, Polish cache re-pinned.

## Phase 9: Opportunities list **[admin UI]**

**Goal**: the Opportunity half of US2 (FR-007, FR-011a, FR-013, FR-016).

- [x] T051 [US2] **RED** `admin/test/modules/crm/OpportunitiesList.custom-field-filters.test.tsx` (StrictMode; `crmApi`'s HTTP mocked as `admin/test/modules/crm/*` already do): the offered fields come from `/api/v1/admin/crm/opportunities/custom-field-filters` whatever the board card shows (US2-3); choosing a value sends `fieldFilters` with a `custom:<key>` reference and **never** `cardValues`; a change empties the cursor trail (first page); the address carries `cf.*` and an address with them applies them; a 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` shows the error naming the field with *Remove this filter* (FR-011a), a markup-bearing `details.key` rendered as truncated text as in T044 (threat model F-5). Fails: no filter offered
- [x] T052 [US2] Implement in `packages/modules/crm/src/admin/pages/OpportunitiesList.tsx` (and an `offeredCustomFieldFilters()` call in `packages/modules/crm/src/admin/api.ts` if the hook's endpoint form is not used directly): the hook, `CustomFieldListFilters` beside `OpportunityFilterFields`, address read/write of `cf.*`, `fieldFilters` mapped to `custom:` references in the `params` memo, the refusal Alert; `OpportunityBoardPage.tsx`, `BoardFieldFilters.tsx` and `lib/board-fields.ts` untouched; rebuild `mod-crm`; T051 green
- [x] T053 SC-005 regression, unchanged assertions: run locally every `admin/test/modules/crm/OpportunitiesList*` file (answer the offered-fields endpoint where a mock needs it, no assertion changed) plus `board.test.tsx` and `board-card-fields.test.tsx`, which pin the board's behaviour; the rest of `admin/test/modules/crm` runs unchanged in the fork CI's `test:frontend` job (Phase 13)
- [x] T054 Changeset `.changeset/157-crm-opportunities-list-filters-ui.md` — `'@endora-commerce/mod-crm': minor`: custom-field filters on the Opportunities list, governed by the list-filter option; the board keeps its card-field filters

**Phase 9 notes** (stream B):
- The hook's endpoint form is used directly; `crm`'s `api.ts` is unchanged. The page's strings are the kit's `core` keys, so the `crm` bundles are unchanged too.
- A failed offered-fields read shows `customFieldFilters.loadFailed` in the filter grid; the list itself keeps working.
- No existing mock needed the offered-fields endpoint answered: an unanswered read only hides the filters.
- Results: T051 8/8; T053 `OpportunitiesList.test.tsx`, `board.test.tsx` and `board-card-fields.test.tsx` 64/64, plus `tags`, `lookups` and `assignment`, which also render the list, 29/29, with no assertion changed; `OpportunityBoardPage.tsx`, `BoardFieldFilters.tsx` and `lib/board-fields.ts` are untouched; `mod-crm` typecheck, lint and build, `admin` typecheck and lint, `i18n:hardcoded`, `check:bundle-pairing` and `check:admin-surface` all rc=0.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-crm run build
pnpm --filter admin exec vitest run test/modules/crm/OpportunitiesList test/modules/crm/board.test.tsx test/modules/crm/board-card-fields.test.tsx
pnpm --filter @endora-commerce/mod-crm run typecheck
pnpm --filter @endora-commerce/mod-crm run lint
pnpm --filter admin run typecheck
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:bundle-pairing
```

---

## Phase 10: `/custom-fields` — the definition editor **[admin UI]**

**Goal**: US3 in the admin (FR-003, FR-003a, FR-003b, FR-006, FR-018; research R-12; contract
`admin-surfaces.md` §3).

- [x] T055 [P] [US3] **RED** `admin/test/modules/custom_fields/CustomFieldsPage.editor.test.tsx` (StrictMode; inside `AuthProvider` with an `initial` session holding `custom_fields:read` and `custom_fields:write`; the module client mocked as `CustomFieldsPage.audience.test.tsx` does, extended with the option calls): each row has an *Edit {key}* action; the dialog shows key, entity type and value type as read-only text and offers no value-type control (US3-8); changing the Polish label and saving sends **one** `PATCH` whose body has exactly the member `label` — no `config`, `options`, `valueType`, `key`, `labelDefault`, `required` or `listFilter` (threat model F-6, US3-4); *Save* with nothing changed sends no request; relabelling an option sends a body without `value`; toggling *Use as list filter* sends `{ listFilter: true }` (US3-1); switching *Required* on shows the FR-003b notice before saving and sends `{ required: true }` (US3-7); for a `customer` definition (entity type `listFilter: false`) the toggle is absent (US3-2); `DefinitionBehaviourFields` receives the edited definition's `key`, `valueType`, `options` and `audience` as well as its entity type's entry (asserted by a `vi.mock` of the block's module that records its props and renders the real block — analyze #6, the seam value-carry extends); options: *Add option* posts value and labels, relabelling patches labels without `value`, the stored value is read-only text, *Move up* patches the `sortOrder` of the two options that swapped and the move is announced, removing an unused option asks in-dialog and sends `DELETE`, removing an option in use shows the server's sentence at that option (US3-5, US3-6); a refused save keeps the dialog open with the server sentence; while saving, Escape does nothing; no native `confirm`/`prompt`/`alert` is called; `expectNoAxeViolations` on the open dialog. Fails: no edit action
- [x] T056 [P] [US3] **RED** `admin/test/modules/custom_fields/CustomFieldsPage.list-filter.test.tsx` (StrictMode): the table's *List filter* column shows *Yes* / — in English and the Polish bundle's value for the same key (US3-3, FR-006); the create form offers *Use as list filter* only for a type whose `entity-types` entry says `listFilter: true` and sends it (FR-003); an admin with `custom_fields:read` only sees no *Edit*, *Delete*, audience select or create form (US3-9); (the fallback list is T015a's); every key the page and its three components read exists in both `custom_fields` bundles and every Polish value differs from the English one (FR-018). Fails: no column, controls offered to a reader
- [x] T057 Wrap the existing `admin/test/modules/custom_fields/CustomFieldsPage.audience.test.tsx` and T015a's `CustomFieldsPage.fallback-types.test.tsx` renders in `AuthProvider` with `custom_fields:read` + `custom_fields:write` (the page now reads `useAuth`, which throws outside a provider); no assertion changes; it stays green after T059
- [x] T058 [P] Add the `customFields.*` keys of contract §3.2 to `packages/modules/custom_fields/i18n/en.json` and `pl.json` (the moved English strings keep their current English wording, so the audience test's `Add field` still matches)
- [x] T059 [US3] Implement `packages/modules/custom_fields/src/admin/components/DefinitionEditorDialog.tsx`, `DefinitionOptionsEditor.tsx`, `DefinitionBehaviourFields.tsx` (props as contract `admin-surfaces.md` §3 — the definition being created or edited, the entity type's entry, value, `onChange`; on the kit `ModalDialog`, `TouchReorderButtons`, `ReorderAnnouncer`, `Checkbox`, `Input`), the option calls in `src/admin/api/custom-fields-client.ts`, and in `CustomFieldsPage.tsx` the *List filter* column, the *Edit* action, permission gating of every write control through `useAuth().hasPermission('custom_fields:write')`, `DefinitionBehaviourFields` in the create form, and every literal moved to `t(...)`; rebuild `mod-custom-fields`; T055 – T057 green
- [x] T060 Drain `'packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx': 4` from `HARDCODED_STRINGS_BASELINE` (`backend/scripts/i18n-hardcoded-strings.ts:499`) in the same commit as T059 — the two-way ratchet fails on a number left standing; the three new component files add no finding
- [x] T061 Changeset `.changeset/157-custom-fields-definition-editor.md` — `'@endora-commerce/mod-custom-fields': minor`: an existing definition is editable on `/custom-fields` (labels, required, options, list filter); the table shows list filters; the page is translated; write controls are offered only with `custom_fields:write`

**Phase 10 notes** (stream B):
- Option labels commit on blur (no separate *Apply*); a move patches every option whose `sortOrder` differs from its new index; with a dense stored order that is the two that swapped (the only case T055 exercises), with a gappy one it can be more.
- *Save* with nothing changed closes the dialog without a request. Closing the dialog, saved or not, re-reads the table, because option actions apply at once.
- Added keys beyond §3.2: `customFields.form.keyPlaceholder`, `.form.optionsPlaceholder`, `.table.actions` (an sr-only header), `.table.delete` (the icon button's name), `.error.load`, `.error.action`, `.editor.key/entityType/valueType/labelDefault/labelEn/labelPl/labelDefaultRequired/saveFailed`, `.editor.option.addRequired/keep/failed`. The Edit button's name reuses `customFields.editor.title` (`Edit {key}`).
- The definition label helpers are shared by the dialog and the options editor in `src/admin/components/localized-label.ts`.
- T060 also removed the entry's comment block from `backend/scripts/i18n-hardcoded-strings.ts`.
- Results: the four `custom_fields` page tests, 27/27; `kit-custom-field-values` and `batch-nine-surfaces.module-owned-surface` stay green; `mod-custom-fields` typecheck, lint and build, `admin` typecheck and lint, `i18n:hardcoded`, `check:bundle-pairing`, `check:admin-surface` and `manifests:check` all rc=0.

**Verification**:
```bash
pnpm --filter @endora-commerce/mod-custom-fields run build
pnpm --filter admin exec vitest run test/modules/custom_fields/CustomFieldsPage.editor.test.tsx test/modules/custom_fields/CustomFieldsPage.list-filter.test.tsx test/modules/custom_fields/CustomFieldsPage.audience.test.tsx test/modules/custom_fields/CustomFieldsPage.fallback-types.test.tsx
pnpm --filter admin exec vitest run test/kit/kit-custom-field-values.test.tsx
pnpm --filter @endora-commerce/mod-custom-fields run typecheck
pnpm --filter @endora-commerce/mod-custom-fields run lint
pnpm --filter admin run typecheck
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:bundle-pairing
pnpm --filter backend run manifests:check
```

---

## Phase 11: Documentation, en + pl **[docs]**

**Goal**: FR-020 (`specs/conventions/module-documentation.md`; the Polish workflow in
`docs/docs/contributing/documentation-i18n.md`).

- [x] T062 [P] Write `packages/modules/custom_fields/docs/custom_fields.md` (front matter `title`, one-sentence `description`): the entity types and who owns them (Quote Request definitions hidden while `quote_requests` is off, Opportunity while `crm` is off); creating a definition; **editing an existing one and its limits** (key, entity type and value type fixed; an option's stored value fixed; an option in use cannot be removed; making a field required bites at each record's next custom-field edit); audience; the *Use as list filter* option and where it is offered; the three lists; the operators per value type; that a record without a value never matches; refusal of an unavailable filter and how the list reports it; saved views dropping an unavailable filter; the board's card filters versus the list option, including the Opportunities list change (FR-011a); no storefront filter. No relative link to a sibling module or the site tree (rules 1a, 1b)
- [x] T063 Declare `docs: { dir: 'docs' }` in `packages/modules/custom_fields/src/manifest.ts`; run `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only` and `pnpm --filter backend run composer:generate`; commit the package manifest (`files` gains `docs`), the lockfile if moved, `docs/sidebars.modules.generated.js` and `docs/docs/modules/module-map.generated.md`; if `check:module-docs` held a ledger entry for `custom_fields`, remove it in this commit
- [x] T064 [P] Update `packages/modules/orders/docs/orders.md` (custom-field filters on the list, the CSV export and saved views), `packages/modules/quote_requests/docs/quote_requests.md` (the filters; definitions follow the module's activation) and `packages/modules/crm/docs/crm.md` (list filter versus board card filter; the list change; the board and its *Show more* unchanged)
- [x] T065 [P] Update `docs/docs/architecture/custom-fields.md`: § *Supported host entities* (the `quote_request` owner), a new § on `listFilter` as a core-interpreted attribute beside § *Host-capability flags*, the list-filter port and its reuse of the storage binding, and why the CRM board keeps its own predicates
- [x] T066 Polish: create/update `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/{custom_fields,orders,quote_requests,crm}.md` and `…/current/architecture/custom-fields.md`, with their `docs/translation-cache/pl/*.json` entries, per `docs/docs/contributing/documentation-i18n.md`
- [x] T067 Run `check:module-docs`, `check:docs-translations`, `check:doc-snippets` locally and fix what they report; the docs build and `verify:docs-build` run in the fork CI's `build:docs` job (Phase 13)
- [x] T068 Changeset `.changeset/157-custom-fields-docs.md` — `'@endora-commerce/mod-custom-fields': patch` (ships a documentation page); `'@endora-commerce/mod-orders'`, `'@endora-commerce/mod-quote-requests'`, `'@endora-commerce/mod-crm'`: patch (documentation)

**Verification**:
```bash
pnpm --filter backend run check:module-docs
pnpm --filter backend run check:docs-translations
pnpm --filter backend run check:doc-snippets
pnpm --filter backend run overlay:check
pnpm --filter backend run manifests:check
pnpm install --frozen-lockfile
```

(The docs build and `verify:docs-build` run in the fork CI's `build:docs` job, Phase 13 — standing rule 12.)

**Phase 10 review round** (stream B, the final review pack's B1, B2, M6–M8, minors and UI QA G1, G2, G7, G9):
- B1: option rows are keyed by the option; each label input adopts a re-read value only when it is not focused and no different save of it is in flight; inputs stay enabled while a row saves (`aria-busy`); a reorder re-reads in `finally` and returns focus to the moved row's button (its other button when the move disabled the first).
- B2: removing an option in use renders `customFields.editor.option.inUse` with the option's label, never the server's message or code. It is detected as `CUSTOM_FIELD_OPTION_IN_USE` (one constant in `DefinitionOptionsEditor.tsx`, swapped for the final name when A mints it), or as a `409` `CUSTOM_FIELD_DEFINITION_INVALID`, which is what the option `DELETE` route answers today; that branch goes once the new code ships. A `5xx` option failure now shows the generic sentence.
- M6–M8 and the minors as briefed. The table label and the in-use label use a local `resolveLabel` (language, then base language, then default) in `localized-label.ts`, to be replaced by the kit's once exported. The table is `ResponsiveTable`, so its sr-only actions header key went. `DefinitionBehaviourFields` gained an additive `layout: 'stacked' | 'row'` prop for the create form.
- Copy: *Record type* / *Typ rekordu*, *Pojedynczy wybór*, *Definition* / *Definicja*, the new required notice, *No* / *Nie*. Three tests changed the label they look up (`Entity` → `Record type`) and the notice regex; no assertion was weakened. The `custom_fields` docs page follows the new labels, and its cache entry is re-pinned.
- G1 passed before the change, so it guards against regressions rather than proving a fix. G9 checks the wrapping classes (`break-words`, `min-w-0`); jsdom does no layout.
- Results: the four `custom_fields` page tests, 41/41; with `kit-custom-field-values` and `batch-nine-surfaces`, 90/90. `mod-custom-fields` typecheck, lint and build, `admin` typecheck and lint, `i18n:hardcoded`, `check:bundle-pairing`, `check:admin-surface`, `check:docs-translations`, `check:module-docs` and `check:doc-snippets` all rc=0.

**Phase 11 PO round** (stream B, G1–G3, G5, G6):
- The custom_fields page (en, pl) says an option in use is named by its label in the editor's own sentence, and lists `CUSTOM_FIELD_OPTION_IN_USE` (409, `details.value` and `details.label`), `CUSTOM_FIELD_VALUE_TYPE_LOCKED` and `CUSTOM_FIELD_STORED_VALUES_EXIST` (409, `details.key`), and 422 `CUSTOM_FIELD_DEFINITION_INVALID` for `list_filter_unsupported`. The custom_fields, orders, quote_requests and crm pages (en, pl) say an inverted range or a mismatched operator answers 400 `VALIDATION_FAILED`. `customFields.editor.keyReadOnly` now says record type. Four cache entries were re-pinned.
- G5: an editor test that *Default* sends `{ isDefault: true }`, and an `isDefault` case in `backend/test/integration/custom_fields/list-filter-option.test.ts`, which asserts a third audited `custom_fields.option.updated`. The integration test was not run locally: it needs Postgres. The option audit snapshot records `id`, `value` and `labelDefault` only, so an `isDefault`, `sortOrder` or `label` change is audited with no visible before/after; that is a backend finding, left as it stands.
- Results: the custom_fields page tests 41/41; `check:docs-translations`, `check:module-docs`, `check:doc-snippets`, `check:bundle-pairing`, `i18n:hardcoded`, and `admin` and `backend` typecheck and lint all rc=0.

**Phase 11 notes** (stream B):
- Phase 8 (the Orders and Quote Requests lists) was still being built while this was written; those pages describe it from the spec and `contracts/admin-surfaces.md` §2 (chips, saved views with the dropped-filter notice, the refusal Alert, the CSV export withheld while a refusal stands).
- T063: `docs: { dir: 'docs' }` in the `custom_fields` manifest; `manifests:generate` added `docs` to the package's `files` and README; the lockfile did not move; `composer:generate` turned `custom_fields` into a sidebar category, linked the module map and the module reference; the `custom_fields` entry left `MODULES_WITHOUT_DOCUMENTATION` in `backend/scripts/check-module-docs.ts`.
- T066: also mirrored in Polish — the module map row, the module reference's page link and `sidebar.main.category.custom_fields` in `current.json`; seven cache entries were re-pinned from the materialised files with `hashSourceBody`.
- Results: `check:docs-translations` (0 findings), `check:module-docs` (0 findings), `check:doc-snippets`, `manifests:check` and `overlay:check` all rc=0. `check:naming` and `check:language` were left to CI, because on macOS they need the Docker Ubuntu image. The docs build runs in CI's `build:docs` job.

---

## Phase 12: CI gate, part 1 — rebase, generated artefacts, local cheap checks **[gate]**

**Goal**: a tip that is current with `origin/master` and whose generated artefacts are committed,
checked locally only with what is cheap and host-independent (standing rule 12). Record each result
(tip, base, duration, host) under its task.

- [x] T069 Final rebase onto `origin/master` (backup branch first); re-run T000's `git log` and
  `git grep` lines against the new base; if `feat/155-catalog-order-constraints` has merged,
  resolve the shared files as plan.md § *Overlap with feat/155* says (regenerate, never hand-merge,
  the migrations registry). Then confirm no generated artefact moves:
  ```bash
  pnpm install --frozen-lockfile
  pnpm run build:packages
  pnpm --filter backend run composer:generate
  pnpm --filter backend run manifests:generate
  pnpm install --lockfile-only
  git status --porcelain
  ```
  (`git status` must print nothing.)
  **Done 2026-10-20** on base `origin/master` `4aa101a51` (release 0.107.0), backup `backup/157-pre-rebase-1`, rerere on. Stream B's U1 A (`e516e561b`, `c09d9f618`) cherry-picked first, cleanly. 39 commits before and after, none dropped; two conflicts: `reference-ledgers.ts` (156's seven `ASSET_*` codes and our `CUSTOM_FIELD_FILTER_UNAVAILABLE`, both kept) and the Polish module-map translation cache (re-pinned from the materialised page with `hashSourceBody`). No `custom_fields` migration landed on master, so no re-stamp; `UPDATE_OPENAPI_BASELINE=1` left the baseline unchanged. T000 re-run: the `git log` prints 154's basket attribution, three 156 commits and the 0.107.0 release; the `git grep` prints only `blog/.../routes.admin.ts` `listFiltersSchema`, a substring match, not a collision. The regeneration block left `git status` empty; the agent-context appendix commit normalises the tag and restores the 152/153 lines the script trims. Local [PG]: the 10 branch files plus `orders/list-and-views`, `openapi-baseline` and the error-code ledger tests, all green.
- [x] T070 `quality` part 1 (`pnpm -r run typecheck`, `pnpm -r run lint`): **covered by the fork's
  CI** — the `quality` job on the pushed tip (T074). Filtered typecheck and lint of every touched
  workspace ran in each phase.
  **Done 2026-10-20** on `fea9b0335`: the fork's `quality` job green, 20 min ([PR #3 checks](https://github.com/bfluks/endora-commerce/pull/3/checks)); locally on `1e3696369` typecheck of backend, admin and contracts and lint of the nine touched workspaces exit 0 (T073).
- [x] T071 `quality` part 2 — the `quality` job's check list in `.github/workflows/quality.yml`
  (lines 110–155 on `3d9ca98cd`, unchanged since `fda284a45`): **covered by the fork's CI** (T074).
  Locally run only the checks this feature's inputs feed, one per line:
  ```bash
  pnpm --filter backend run check:command-coverage -- --strict
  pnpm --filter backend run check:module-boundary
  pnpm --filter backend run check:port-dependencies
  pnpm --filter backend run check:port-catches
  pnpm --filter backend run check:port-shape
  pnpm --filter backend run check:off-state-coverage
  pnpm --filter backend run check:error-translations
  pnpm --filter backend run check:bundle-pairing
  pnpm --filter backend run check:module-docs
  pnpm --filter backend run check:docs-translations
  pnpm --filter backend run i18n:hardcoded
  pnpm --filter backend run overlay:check
  pnpm --filter backend run manifests:check
  ```
  **Done 2026-10-20**: the list above exits 0 locally on `1e3696369` (T073); the full check list ran green in the fork's `quality` job on `fea9b0335` ([PR #3 checks](https://github.com/bfluks/endora-commerce/pull/3/checks)).
- [x] T072 `quality:static` (`check-naming.sh`, `check-language.sh`): **covered by the fork's CI**
  (`quality:static` runs on Linux; on macOS the scripts need GNU awk, so no local Docker run is
  required).
  **Done 2026-10-20**: `quality:static` green on `fea9b0335` ([PR #3 checks](https://github.com/bfluks/endora-commerce/pull/3/checks)).
- [x] T073 Release intent and sign-off, locally:
  ```bash
  git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master
  pnpm --filter backend run check:release-intent -- --since origin/master
  node backend/scripts/dco-signoff.ts origin/master HEAD
  ```
  (`test:release-gate` runs in the fork CI's `release:changeset` job.)
  **Done 2026-10-20** on `1e3696369`: `check:release-intent` `changesets-added=12 violations=0`; `dco-signoff` `commits=40 findings=0`. Typecheck (backend, admin, contracts), lint of the nine touched workspaces and T071's local check list all exit 0.

**Verification**: T069's block and T071's and T073's commands on one tip, every command exits 0 and
`git status --porcelain` prints nothing.

---

## Phase 13: CI gate, part 2 — fork CI and the service-backed run **[gate]**

**Goal**: every pull-request job, plus the server-bound suites a merge-request pipeline does **not**
run (owner ruling 2026-09-03), on the fork's CI — the remote-CI rule replaces the local Linux container and the
local Postgres sweep this phase used to run.

- [x] T074 Push the branch to the fork and open the draft pull request; record the result of every
  job on the pushed tip: `quality` (T070, T071), `quality:static` (T072), `test:backend:unit`,
  `test:frontend` (the packages' co-located suites included — `admin-kit`, `mod-custom-fields`,
  `mod-crm`'s board tests), `release:changeset`, `pack-gate`, `boot-gate`, `build:docs` (the docs
  build and `verify:docs-build`), `dco`. A red on a known load-timing test in a file this branch
  does not touch is re-run and recorded as such; a red in a touched file is a defect, fixed on the
  branch with a new signed commit.
  **Done 2026-10-20** on `fea9b0335` (base `origin/master` `4aa101a51`), draft [PR #3](https://github.com/bfluks/endora-commerce/pull/3), 9/9 green with no re-run ([checks](https://github.com/bfluks/endora-commerce/pull/3/checks)): `quality` (20 min), `quality:static`, `test:backend:unit`, `test:frontend`, `release:changeset`, `pack-gate` (6 min), `boot-gate` (7 min), `build:docs` (5 min), `dco`. `fea9b0335` differs from `1e3696369` in this file only.
- [x] T075 Service-backed run: build the throwaway `ci-pg/<branch>` branch from the tip plus the
  fork-only workflow commit and a `ci-pg-files.txt` (paths relative to `backend/`) listing every
  server-bound file this feature adds or changes and every one that names custom fields:
  ```text
  test/integration/custom_fields/entity-owner-presence.test.ts
  test/integration/custom_fields/list-filter-option.test.ts
  test/integration/custom_fields/list-filter-conditions.test.ts
  test/integration/custom_fields/us4-capability-optin.test.ts
  test/integration/custom_fields/value-matrix.test.ts
  test/integration/custom_fields/host-wiring.test.ts
  test/integration/custom_fields/one-definitions-cache.test.ts
  test/integration/custom_fields/cross-tenant.test.ts
  test/integration/custom_fields/definition-audience-migration.test.ts
  test/integration/custom_fields/recreate-over-orphaned-values.test.ts
  test/integration/custom_fields/us1-organization-fields.test.ts
  test/contract/custom_fields/host-managed.test.ts
  test/contract/orders/custom-field-filters.test.ts
  test/contract/orders/list-and-views.test.ts
  test/contract/quote_requests/custom-field-filters.test.ts
  test/contract/quote_requests/list-views.test.ts
  test/integration/quote_requests/off-state.test.ts
  test/integration/quote_requests/list-totals-parity.test.ts
  test/integration/crm/list-custom-field-filters.test.ts
  test/integration/crm/off-state.test.ts
  test/integration/crm/board-card-fields.test.ts
  test/integration/crm/quote-requests-off.test.ts
  test/integration/crm/custom-fields.test.ts
  test/contract/crm/board-card-fields.contract.test.ts
  test/integration/_i18n/error-code-ownership.test.ts
  test/contract/kernel/openapi-baseline.test.ts
  test/contract/kernel/harness-parity.test.ts
  ```
  then append every other contract/integration file that names custom fields (two steps, so an
  empty difference is not read as a failure and the list is never read while it is appended to):
  ```bash
  set -o pipefail; (cd backend && grep -rlE 'custom-fields|customFieldValues|custom_field' test/contract test/integration) | sort -u > /tmp/cf-candidates.txt
  set -o pipefail; sort -u ci-pg-files.txt | comm -13 - /tmp/cf-candidates.txt > /tmp/cf-extra.txt && cat /tmp/cf-extra.txt >> ci-pg-files.txt
  ```
  Push `ci-pg/<branch>`, record the per-file table, delete the branch. A red file is fixed on the
  feature branch (never on `ci-pg/…`) and the run repeated.
  **Run 2026-10-20 on `1e3696369`** ([run](https://github.com/bfluks/endora-commerce/actions/runs/39377077106), 51 files, 20 min): 50 green, one red — `test/integration/demo/demo-shop.test.ts` > *enters the system scope exactly once per run*: a second ledger entry, `worker` / `invoices: one-time document template access grant`. Not this branch's: it touches neither `invoices`, `document_templates` nor `demo`, and the same assertion fails the same way on a clean `origin/master` `4aa101a51` worktree. The `ci-pg` branch is deleted.
  **Done 2026-10-20**: accepted with the one red recorded as pre-existing on `origin/master` and not caused by this branch ([run](https://github.com/bfluks/endora-commerce/actions/runs/39377077106), ci-pg tip `a3e017d23` = `1e3696369` plus the fork-only workflow commit). The pull request names it under its risks.
- [x] T076 Record T069 – T075 on the tip (tip and base hashes, CI run links, durations, any
  known-flake re-run with its evidence) in this file as a `tasks.md`-only commit; the tip recorded
  is the one pushed; the pull request body says `Closes #286`
  **Done 2026-10-20**: T069 – T075 are recorded under their tasks (code tip `1e3696369`, CI on `fea9b0335`, base `4aa101a51`; this commit adds only this file on top); no known-flake re-run was needed. Sign-off: `dco-signoff` `commits=40 findings=0` locally (T073) and the fork's `dco` job green ([PR #3 checks](https://github.com/bfluks/endora-commerce/pull/3/checks)). The pull request body is drafted with `Closes #286`.
  **Upstream pull request**: _to be filled_.

**Verification**: T074's jobs all green on the recorded tip and T075's per-file table has no red
file.

(Task ids T077 – T080 are retired: the local container, the local `[PG]` sweep, `boot-gate` and
the docs build moved into T074 – T075. Phase 13 now holds three tasks.)

---

## Dependencies and order


```text
Phase 1 ─► Phase 2 ─┬─► Phase 3 ─┬─► Phase 4 ─┐
                    │            ├─► Phase 5 ─┼─► Phase 8 ─┐
                    │            └─► Phase 6 ─┴─► Phase 9 ─┤
                    └──────────────────────────► Phase 10 ─┤
Phase 1 ─► Phase 7 ─► Phases 8, 9                          │
                                     Phases 8, 9, 10 ─► Phase 11 ─► Phase 12 ─► Phase 13
```

- Within a phase, a **RED** task precedes the task that turns it green; `[P]` tasks may be written
  together.
- Phases 4, 5, 6 are independent once 3 has landed (each re-records the OpenAPI baseline for its
  own route — land them serially or rebase the fixture). Phase 7 needs only Phase 1.

## Parallel examples

- Phase 1: T001, T003, T005 are three files — write them together; T002, T004, T006 turn them green.
- Phase 2: T010, T011, T012, T015a together before T013 – T016.
- Phase 7: T038, T039, T040, T041 together before T042.
- Phase 10: T055, T056, T058 together before T059.

## Implementation strategy

- **MVP = Phases 1 – 4, 7, 8 (Orders half), 10**: #286's worked example — an Order field marked on
  `/custom-fields` filters `/orders`.
- **Increment 2 = Phases 5, 8 (Quote Requests half), 6, 9**: the other two lists.
- Phases 11 – 13 close the feature. One pull request for the branch.

## Requirement → test

| Requirement | Test task(s) |
| --- | --- |
| FR-001 option on Order / Quote Request / Opportunity only, default off | T010, T012, T055 (absent for `customer`), T056 |
| FR-002 every value type | T012 (six types), T019, T039 |
| FR-003 settable at create and edit, `custom_fields:write`, audited | T012 (audit entry), T055, T056 (create form) |
| FR-003a full editing, existing rules, Command per change | T012 (option value immutable, `option_in_use`, `valueType` lock; one audit entry per label, `required` and option action), T055 (changed members only) |
| FR-003b required notice | T055; T012 (no stored value changes) |
| FR-004 no stored value changes | T012 |
| FR-005 option follows `crm` / `quote_requests` presence | T011 (every write route), T018 (owner absent), T030, T034 |
| FR-005a Quote Request definitions hidden while off, kept | T010, T011, T015a (fallback list) |
| FR-006 table shows list filters | T056 |
| FR-007 one filter per offered definition, in the operator's language | T023, T029, T033 (offered-fields routes), T039, T044, T047, T051 |
| FR-008 operators per value type; no value never matches | T018, T019, T029 (`is: false`), T039 |
| FR-009 whole result set, totals, every page | T023 (pages 1–3; counts, payment counts, total and CSV rows agree), T029 (> one page), T033 (cursor), T047 |
| FR-010 OR within, AND across and with existing filters | T019, T023, T029, T044 |
| FR-011 refusal naming the key — Orders, export, Quote Requests, Opportunities; admin shows and removes | T018, T023, T029, T033, T038 (refusal helper), T044, T047, T051 |
| FR-011a Opportunities list rule replaces the card rule; board unchanged | T033 (both modes), T035, T051 |
| FR-012 never widens visibility | T023, T029, T033 (sales representative) |
| FR-013 address, chips, first page | T038, T044, T047, T051 |
| FR-014 saved views keep filters; stale dropped before the request | T038 (sanitise), T044, T047 |
| FR-015 Orders CSV export | T023, T044 |
| FR-016 board unchanged | T033 (`cardValues=true` incl. a non-card, non-flagged key → 200; board endpoint), T053, Phase 6 verification (board suites unchanged) |
| FR-017 internal fields filterable in admin; no storefront/API-key filter | T001 (DTO members), T018, T023 (internal field), T024 (source scan) |
| FR-018 en + pl, page translated | T041, T056 (bundle completeness), T058, T060 (`i18n:hardcoded`), T023 (Polish error sentence), T071 (`check:bundle-pairing`, `check:error-translations`) |
| FR-019 no new permission code | T023, T029, T033 (gates reuse list permissions); T074 (`check:action-route-permissions` in the fork CI's `quality` job); no manifest `permissions` change in any phase |
| FR-020 documentation en + pl | T062 – T067 (`check:module-docs`, `check:docs-translations`, docs build) |
| SC-001 edit → filter in under a minute | quickstart §1–§2 (owner's manual test), T055 + T044 (the flow automated) |
| SC-002 same answer at 20 or 2 000 matches | T023, T029, T033 (datasets larger than one page) |
| SC-003 every value type tested per list that offers it | T023, T029, T033 (an `it.each` over the six value types on each list), T019 (the port against Postgres) |
| SC-004 saved view restores; unavailable field still loads with notice | T044, T047 |
| SC-005 board tests unchanged; list tests deliberately updated | T035, T053, Phase 6 verification |
| SC-006 `quote_requests` off ⇒ no Quote Request definition reachable; all return | T011 |

Threat model (2026-10-16; research R-17):

| Finding | Test task(s) |
| --- | --- |
| F-1 one scan, caps | T001 (10/11 keys, 100/101 values), T018 (one table scan; caps before any read), T023, T029, T033 (11 keys → 400) |
| F-2 fresh fragment per statement | T023 (counts, payment counts, total and export rows agree), T029, T033 |
| F-3 repeated / non-string parameter | T001 (array refused), T023, T029, T033 (parameter given twice → 400); T023, T029, T033 (two keys) |
| F-4 prototype keys | T001 (`__proto__` refused), T018, T023, T029 (`constructor` refused as unavailable), T038 (`cf.constructor.in=x`) |
| F-5 text-only rendering | T044, T047, T051 (markup key rendered as truncated text) |
| F-6 changed members only | T055 |
| F-7 internal metadata | T001, T018 (DTO members) |
| F-8 `cardValues` | T033 |
| F-9 injection | T018 (bound values, no `::date`, no jsonb `?` operator), T019 (hostile values against Postgres) |
| F-11 off state beyond `POST` | T011 |
| F-13 board reference regex | confirmed on `fda284a45` and again on `3d9ca98cd` (`crm.ts:285-287`); no new test |
