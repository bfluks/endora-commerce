# Tasks: Admin user preferences — pinned sidebar items, and the admin's layout settings kept on the server (`specs/164-admin-user-preferences/`)

**Input**: [spec.md](./spec.md) (approved 2026-10-27, rulings (a)–(e)), [plan.md](./plan.md),
[research.md](./research.md) (R-1 – R-16; § *Readings — owner rulings (2026-10-27)*),
[data-model.md](./data-model.md),
[contracts/admin-preferences-api.md](./contracts/admin-preferences-api.md),
[contracts/admin-preferences-client.md](./contracts/admin-preferences-client.md),
[quickstart.md](./quickstart.md).

**Organisation**: seven phases — Setup, Foundational (contracts, migration, entity, service,
routes, the `/admin/me` extension, the client store), one phase per user story in priority
order (US1 pins incl. FR-027 palette pinning, US2 visibility, US3 server-held settings and the
carry-over, US4 reorder), then Polish with the final verification. Every phase ends with a
**Verification** line and is **independently committable** on `feat/sidebar-pinned-items`
(`git commit -s`, no AI trailer). Phases are marked **[backend]**, **[admin UI]**, **[docs]** or
**[gate]**; the admin UI phases (3–6) may be routed to `endora-commerce-designer` for copy, focus
order, the `Alt+Enter` chord and touch targets first.

**Owner rulings applied (2026-10-27)**: FR-004 — the pin button is one extra Tab stop per
sidebar entry, directly after its link; FR-027 — the palette pin binding is `Alt+Enter`
(`⌥↵`); the palette's missing `listbox`/`option` semantics are **out of scope** (a follow-up,
not a task here); the other readings stand as written (research.md, *Readings*).

## Format

`- [ ] T### [P?] [US?] Description — path(s)`

- **[P]** — may run in parallel with its neighbours: a different file and no dependency on an
  unfinished task.
- **[US1] … [US4]** — the story served; none = Setup, Foundational or Polish.
- **RED** — the deliverable is a failing test. Run it and see it fail **for the reason named**
  before starting the task that turns it green (Constitution III, NN).

## Standing rules for every task

1. **Work in the feature worktree only** (`wt-sidebar-pins`, branch `feat/sidebar-pinned-items`).
   The speckit scripts reject a `feat/` branch name: run them as
   `SPECIFY_FEATURE=164-admin-user-preferences .specify/scripts/bash/<script>.sh`; never create
   or switch a branch.
2. **Rebuild what you edit.** Tests read each package's `dist`; `tsc` reads sources. After
   editing anything under `packages/`, run `pnpm --filter <package> run build` before a test that
   imports it — here `@endora-commerce/contracts`, `@endora-commerce/mod-admin-users`,
   `@endora-commerce/admin-kit`, `@endora-commerce/admin-shell`, `@endora-commerce/mod-i18n`.
3. **Admin tests render inside `<StrictMode>`** (wrap the element given to
   `admin/test/helpers/render-with-i18n.tsx` / `render-with-session.tsx`, which do not add it),
   so the per-key queue and the carry-over are proved idempotent under double mount. Seed
   preferences through `AuthProvider`'s `initial.preferences`; stub the kit's `apiClient` for the
   `PATCH`/`POST`/`GET` a test triggers, as the saved-views tests do
   (`admin/test/modules/orders/OrdersList.test.tsx`).
4. **Test placement** (`specs/106-module-owned-tests/contracts/module-test-ownership.md`,
   `check:test-ownership`): a harness-free single-module test sits beside its subject in that
   package (`*.test.ts`); a server-composing test under `backend/test/{contract,integration}/`;
   admin tests under `admin/test/`. Never next to a module's `src/manifest.ts`.
5. **Paths in `pnpm --filter backend …` resolve from `backend/`** — a module source is
   `../packages/modules/admin_users/src/…`.
6. **Services for contract/integration tests** (`specs/conventions/backend-test-suite.md`):
   `pnpm run dev:infra` plus `pnpm run dev:infra:test`, then from `backend/` run
   `TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5441/b2b_test pnpm exec vitest run <file>` —
   written below as `$SVC vitest <file>`. A unit test without services:
   `pnpm --filter backend exec vitest run --config vitest.unit.config.ts <file>`.
7. **Extra admins in a contract test** get **their own** stub session ids in
   `backend/test/helpers/test-actors.ts` (`ADMIN_COOKIES`); their users and roles are created by
   the test file itself. Never reuse another file's ids. `TEST_ADMIN_ID` is shared across files:
   a case that asserts on its document first writes the state it asserts from.
8. **Preference writes are not Commands** (FR-020, research R-4): every writing method of
   `AdminPreferenceService` carries
   `// command-coverage-ignore: per-admin Admin UI preference — personal UI setting, not an audited domain-state mutation`.
9. **A regenerated artefact is committed with its input** — `composer:generate` (registries),
   `manifests:generate` + `pnpm install --lockfile-only` (package manifests, lockfile), the
   OpenAPI baseline fixture.
10. **Deleting or moving anything?** `grep -rn` its name across `backend/test`, `admin/test`,
    `docs/` and `backend/scripts/ledgers` before committing, and ask what is **derived** from its
    location, not only what names it (`AGENTS.md`, *traps*).

---

## Phase 1: Setup

**Purpose**: a built workspace and a green baseline, so that every later red is attributable to
this feature.

- [X] T001 Install and build in the worktree: `pnpm install --frozen-lockfile && pnpm run build:packages` (repo root); confirm `git branch --show-current` is `feat/sidebar-pinned-items` and `.specify/feature.json` names `specs/164-admin-user-preferences`
- [X] T002 [P] Read the routed documents this feature engages before writing code: `specs/conventions/module-migrations.md`, `module-admin-surfaces.md`, `module-activation.md` (item 5), `module-i18n.md`, `module-documentation.md`, `backend-test-suite.md`, `check-estate.md`, `release-intent.md`; and `.claude/skills/ux-laws/SKILL.md` for Phases 3–6
- [X] T003 Baseline the suites this feature changes, before any edit, and record the result in this task: `pnpm --filter admin exec vitest run test/components/AppShell. test/kit/session-cluster.test.tsx test/kit/kit-product-browser.test.tsx test/kit/admin-kit-identity.test.ts test/modules/orders/OrderCreatePage.product-browser.test.tsx test/modules/quote_requests/RfqCreatePage.product-browser.test.tsx`; `pnpm --filter @endora-commerce/contracts exec vitest run src/admin.test.ts`; and `$SVC vitest test/contract/admin_users/me.test.ts test/contract/admin_users/permissionless-admin-routes.runtime.test.ts test/integration/admin_users/off-state.test.ts test/contract/kernel/openapi-baseline.test.ts`. A red here is pre-existing — report it, do not fix it under this feature

**Verification**: T001 exit 0; T003's result recorded beneath it.

**T003 result (2026-10-27, `2b27fa2dd`, before any edit)** — all green **under Node 22.20**:
admin 18 files / 158 tests passed; `contracts` `src/admin.test.ts` 10 passed; backend
`me.test.ts`, `permissionless-admin-routes.runtime.test.ts`, `off-state.test.ts`,
`openapi-baseline.test.ts` 4 files / 14 tests passed. Under the machine's default Node 26 the
admin run reds 59 tests in 3 files (`window.localStorage` is `undefined`: Node ≥ 25 ships a
global `localStorage` that shadows jsdom's) — an environment fact, not a defect of the tree
(`.nvmrc` says 22); every run of this feature uses Node 22.

---

## Phase 2: Foundational — contracts, table, service, routes, `/admin/me`, client store **[backend]** **[admin UI]**

**Purpose**: everything every story needs (research R-1 – R-6; contracts API §1–§3, client §1).
No story phase starts before this phase's Verification is green.

### 2a. Contracts (Principle II — first)

- [X] T004 [P] **RED** `packages/contracts/src/admin-preferences.test.ts` (co-located unit): `ADMIN_PREFERENCE_KEYS` is exactly the four keys; **FR-012** — `adminPreferencesPatchSchema` refuses an unknown key (`{ theme: 'dark' }`), an empty object, a wrong shape per key (`sidebarRailMode: 'yes'`, `sidebarPins: '/orders'`, `listPageSizes: { orders: 7 }`); **FR-007** — duplicate destination refused; **FR-008** — 200 pins accepted, 201 refused; a destination without a leading slash, with a query string or of 256 chars refused (it is `AdminNavDeclarationSchema.shape.to`); group key: 32 accepted, 33 refused, `'Pinned'`/`'1x'` refused, `'pinned'` accepted; `listPageSizes`: `null` accepted in a `PATCH`, 129 entries refused, list id `'Orders'`/`'a--b'`/65 chars refused; `adminPreferencesLegacyImportSchema` refuses `{}`, `null` values, 129 entries, and any extra key (`.strict()`); **FR-014** — `ADMIN_LIST_PAGE_SIZE_OPTIONS` equals `[5, 10, 20, 50, 100, 500]` and the default is 20; **FR-015** — `adminPreferencesSchema` (read side) accepts `sidebarPins: ['/retired']`, `sidebarCollapsedGroups: ['oldGroup']`, `listPageSizes: { orders: 7 }`; `ADMIN_PREFERENCES_DEFAULTS` parses; `ADMIN_PINNED_GROUP_KEY` is **not** accepted by `AdminNavSectionNameSchema`. Fails: module does not exist
- [X] T005 Implement `packages/contracts/src/admin-preferences.ts` exactly as contract API §1 (browser-safe, no `Buffer`) and export it from `packages/contracts/src/index.ts`; rebuild `contracts`; T004 green
- [X] T006 [P] **RED** Extend `packages/contracts/src/admin.test.ts`: `adminMeResponseSchema` accepts `preferences` as a full `AdminPreferences` object and as `null`, and refuses a response without the key (the server always sends it, contract API §1.1). Fails: the key is unknown
- [X] T007 Add `preferences: adminPreferencesSchema.nullable()` to `adminMeResponseSchema` in `packages/contracts/src/admin.ts` (with the contract's doc comment); rebuild `contracts`; T006 green. `mod-admin-users` typecheck may red until T020 — that is why 2a–2b commit together
- [X] T008 [P] **RED** Extend `admin/test/kit/admin-kit-identity.test.ts`: the kit's `PAGE_SIZE_OPTIONS` is the **same array object** as `@endora-commerce/contracts`' `ADMIN_LIST_PAGE_SIZE_OPTIONS` (R-2). Fails: the kit declares its own array
- [X] T009 Replace the array in `packages/admin-kit/src/lib/page-size-options.ts` with `export { ADMIN_LIST_PAGE_SIZE_OPTIONS as PAGE_SIZE_OPTIONS, type AdminListPageSize as PageSizeOption } from '@endora-commerce/contracts'` (keep every exported name the nine callers use); rebuild `admin-kit`; T008 and the rest of `admin-kit-identity.test.ts` green

### 2b. `admin_users`: table, entity, service, routes, `/admin/me`

- [X] T010 [P] **RED** `packages/modules/admin_users/src/backend/services/admin-preference-document.test.ts` (co-located unit): assembling the document from rows fills every absent key with its default; a row whose `jsonb` has the wrong JSON type for its key is served as the default, logged once at `warn`, and **not** rewritten (FR-015); a row with retired inner tokens is returned as stored; an unknown `preference_key` row is ignored; per-list merge sets present entries, removes `null` entries, keeps the others; import merge is `{ ...imported, ...stored }` — stored wins (FR-022, US3 AS-5); the 128-list bound is checked **after** the merge for both. Fails: module does not exist
- [X] T011 Implement `packages/modules/admin_users/src/backend/services/admin-preference-document.ts` (pure: assemble, merge, import-merge, bound); T010 green (`pnpm --filter @endora-commerce/mod-admin-users exec vitest run src/backend/services/admin-preference-document.test.ts`)
- [X] T012 Scaffold the migration — `pnpm --filter backend run migration:new -- --module admin_users --name admin_user_preferences` (never hand-pick a timestamp or a number); write `up`/`down` per data-model (`admin_user_preferences_pkey` on `(admin_user_id, preference_key)`, `admin_user_preferences_admin_user_fk` → `admin_users(id)` `on delete cascade`, `value jsonb not null`, `updated_at timestamptz not null default now()`; `down` drops the table); add the class to `packages/modules/admin_users/src/migrations/index.ts` — the `migrations` array **and** the named export
- [X] T013 Entity `packages/modules/admin_users/src/backend/entities/admin-user-preference.entity.ts` (`AdminUserPreference`, `@GlobalEntity()` from `@endora-commerce/platform/tenancy`, `@Entity({ tableName: 'admin_user_preferences' })`, composite primary key, `value` jsonb, `updatedAt`); append it to the `entities` array in `packages/modules/admin_users/src/backend/index.ts`; run `pnpm --filter backend run composer:generate` and commit `backend/src/db/migrations-registry.generated.ts` and anything else it rewrites; `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/db/migrations-registry.test.ts` and `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts` green
- [X] T014 [P] **RED** `backend/test/contract/admin_users/me-preferences.test.ts` (own stub sessions per standing rule 7: admin **B** with a role, admin **C** with no role): `GET` → `{ data }` with every key; `PATCH { sidebarPins: ['/orders','/quote-requests'] }` → full document, then `PATCH` with a third pin keeps the order and appends (FR-007, FR-008 last sentence); `PATCH { sidebarRailMode: true }` leaves `sidebarPins` untouched (independent keys); `listPageSizes` `{ orders: 50 }` then `{ 'catalog-products': 100 }` → both present, then `{ orders: null }` → `orders` gone; `POST …/legacy-import { listPageSizes: { orders: 10, returns: 50 } }` after `orders: 100` stored → `orders` stays 100, `returns` 50 (stored wins); **401** without a session on all three routes, and on an invalid body too (guard before validation — never 400); **400 `VALIDATION_FAILED`** with `error.details` for every FR-012 case of T004 plus a 129th list after the merge, each leaving the `GET` document **byte-identical**; **FR-011** — B's `PATCH` never appears in A's (`TEST_ADMIN_ID`, the wildcard admin) `GET` and vice versa; a body carrying `adminUserId` is refused 400; `GET /api/v1/admin/admin-users/<B id>/preferences` answers route-not-found for the wildcard admin (no route names another admin); **role-less C** reads and writes its own document (edge case); **FR-020** — `audit_log_entries` row count unchanged across a `PATCH` and an import. Fails: routes do not exist
- [X] T015 [P] **RED** Extend `backend/test/contract/admin_users/me.test.ts`: `GET /api/v1/admin/me` parses with `adminMeResponseSchema`; for a fresh stub admin `preferences` equals `ADMIN_PREFERENCES_DEFAULTS`; after a `PATCH` it carries the stored values (FR-016). Fails: no `preferences` key
- [X] T016 [P] **RED** `backend/test/integration/admin_users/preferences-persistence.test.ts` (real DB via `setupBackendServer()`): last-write-wins per key; two concurrent `PATCH`es of two different lists both survive (row lock); two concurrent `legacy-import`s and a repeated import converge on one value per list and never overwrite a stored list (FR-023, SC-008); soft-deleting and deactivating the admin keep the rows, restore/reactivate serve them again; hard-deleting the admin row removes them (cascade — the demo-withdrawal path); **FR-018** — with `AdminPreferenceService.prototype.read` made to reject once (`vi.spyOn`, in-process harness; do not alter the shared schema), `GET /api/v1/admin/me` answers **200** with `preferences: null` and a `warn` is logged. Fails: table and service do not exist
- [X] T017 [P] **RED** Extend `backend/test/integration/admin_users/off-state.test.ts`: add `GET /api/v1/admin/me/preferences` (admin cookie) to the routes the existing platform-axis case asserts, so it answers exactly as the module's other routes do when `admin_users` is platform-unavailable (Principle XVII; contract API §2). Fails: the route answers 404 instead of the module's absent shape
- [X] T018 Implement `packages/modules/admin_users/src/backend/services/admin-preference-service.ts` per contract API §3 and §2.2: `read`, `update`, `importLegacy`; all keys of one request in one `em.transactional`, every statement on `tx.execute` (never `getKnex()`); sidebar keys `insert … on conflict (admin_user_id, preference_key) do update set value = excluded.value, updated_at = now()`; `listPageSizes` row lock (`insert … '{}'::jsonb on conflict do nothing`, then `select value … for update`) → merge from T011 → bound → update; `command-coverage-ignore` on each writing method (standing rule 8); construct it in `packages/modules/admin_users/src/backend/plugin.ts` with the module's EntityManager factory and logger — **not** published as a port
- [X] T019 Add the three entries of contract API §2.3 (`guard: 'session'`, reasons verbatim) to `PERMISSIONLESS_ADMIN_ROUTES` in `backend/test/helpers/permissionless-admin-routes.ts`
- [X] T020 Routes in `packages/modules/admin_users/src/backend/routes.admin.ts` (or a sibling `routes.preferences.ts` the same plugin registers under `ctx.routes`): `GET`/`PATCH /api/v1/admin/me/preferences`, `POST /api/v1/admin/me/preferences/legacy-import`, each `preHandler: requireAdmin()`, subject `resolveAdminContext(request).adminUserId`, body schemas declared on the route; extend the `GET /api/v1/admin/me` handler with the isolated read of contract API §2.1 (`try` → `null` + `warn`); rebuild `mod-admin-users`; T014, T015, T016, T017 green, plus `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/permissionless-admin-routes.test.ts` and `$SVC vitest test/contract/admin_users/permissionless-admin-routes.runtime.test.ts test/contract/admin_users/permission-inventory.test.ts`
- [X] T021 OpenAPI baseline (not named in plan.md; the contract tree that MR pipelines skip, D-198): `UPDATE_OPENAPI_BASELINE=1 $SVC vitest test/contract/kernel/openapi-baseline.test.ts`; review the diff of `backend/test/fixtures/openapi-baseline.json` — **additions only**: `/api/v1/admin/me/preferences` (`get`, `patch`) and `/api/v1/admin/me/preferences/legacy-import` (`post`); anything else, including a change to the existing `/api/v1/admin/me` entry, is a defect to fix, not to record; commit the fixture; re-run without the variable, green
- [X] T022 Run and fix what they report in the files above: `pnpm --filter backend run check:command-coverage -- --strict`, `check:transaction-context`, `check:module-boundary`, `check:action-route-permissions`, `check:off-state-coverage`, `check:test-ownership`, `check:port-catches`; `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts`; then `pnpm --filter backend run manifests:generate && pnpm install --lockfile-only && pnpm --filter backend run manifests:check` — expected **no diff**; commit any that appears
- [X] T023 [P] Changesets per research R-14: `.changeset/164-admin-preferences-contract.md` (`'@endora-commerce/contracts': minor`) and `.changeset/164-admin-preferences-server.md` (`'@endora-commerce/mod-admin-users': minor`) — the consumer-facing meaning of each, per `specs/conventions/release-intent.md`

### 2c. The client store in the kit

- [X] T024 [P] **RED** `admin/test/kit/admin-preferences-store.test.tsx` (StrictMode, `apiClient` stubbed; client contract §1): **FR-017** — `set` applies synchronously before any request; five rapid `set`s of `sidebarPins` produce at most two `PATCH`es, in order, the last carrying the fifth value, and the server-side stub ends holding it; a rejected `PATCH` keeps the local value, marks unsaved, raises `unsavedNotice` once per episode (a second failure does not raise it again; a success clears it); retry of the latest value on `window` `online`, on `visibilitychange` → `visible`, and on the next `set`; a write's response adopts only the key it wrote; **FR-019** — `visibilitychange` → `visible` issues one `GET /api/v1/admin/me/preferences` (never two concurrently), adopts remote values for idle keys and keeps in-flight / pending / unsaved ones; **FR-018** — a fetched session with `preferences: null` **or** without the field is `unavailable`: defaults shown, **no** request sent on `set`, deltas recorded (pin add-then-remove cancels), a successful `tryLoad` applies them onto the loaded values (pins appended, not substituted) and writes **only** the touched keys; a **seeded** `initial` without the field is `available` with defaults; **US1 AS-7** — remounting `AuthProvider` with another admin id shows that admin's values and nothing of the first; the hooks throw outside an `AuthProvider`. Fails: hooks do not exist
- [X] T025 Implement `packages/admin-kit/src/lib/admin-preferences/store.ts` (no React), `AdminPreferencesProvider.tsx` and `use-admin-preference.ts` (`useAdminPreference`, `useAdminPreferencesStatus`) per client contract §1–§1.3; in `packages/admin-kit/src/lib/auth.tsx` add `preferences?: AdminPreferences | null` to `AdminMe` and mount the provider while authenticated, `key={me.adminUser.id}`, distinguishing seeded from fetched sessions; export the two hooks (named exports, no `export *`) from `packages/admin-kit/src/lib/index.ts`; rebuild `admin-kit`; T024 green
- [X] T026 Run `pnpm --filter admin exec vitest run test/kit test/components` — nothing writes through the store yet, so the expectation is no change from T003's baseline; fix only a seeded-session helper (`admin/test/helpers/render-with-session.tsx`) if a type change requires it

**Verification**: `pnpm --filter @endora-commerce/contracts run build && pnpm --filter @endora-commerce/mod-admin-users run build && pnpm --filter @endora-commerce/admin-kit run build && pnpm --filter @endora-commerce/contracts exec vitest run src/admin-preferences.test.ts src/admin.test.ts && pnpm --filter @endora-commerce/mod-admin-users exec vitest run src/backend/services/admin-preference-document.test.ts && pnpm --filter admin exec vitest run test/kit/admin-preferences-store.test.tsx test/kit/admin-kit-identity.test.ts && (cd backend && $SVC vitest test/contract/admin_users test/integration/admin_users test/contract/kernel/openapi-baseline.test.ts) && pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/permissionless-admin-routes.test.ts test/unit/db/migrations-registry.test.ts && pnpm --filter @endora-commerce/contracts run typecheck && pnpm --filter @endora-commerce/mod-admin-users run typecheck && pnpm --filter @endora-commerce/mod-admin-users run lint && pnpm --filter @endora-commerce/admin-kit run typecheck && pnpm --filter @endora-commerce/admin-kit run lint && pnpm --filter backend run typecheck && pnpm --filter backend run check:command-coverage -- --strict && pnpm --filter backend run check:transaction-context && pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts && pnpm --filter backend run manifests:check && pnpm install --frozen-lockfile`

**Checkpoint**: the server holds, validates and isolates every admin's preferences, `/admin/me`
carries them, and the kit has a working store. No UI uses it yet.

---

## Phase 3: User Story 1 — Pin the sidebar entries I use most (P1) 🎯 MVP **[admin UI]**

**Goal**: pin and unpin from the sidebar (expanded, drawer, rail) and from ⌘K, server-held,
first-paint correct, announced, keyboard- and touch-operable (FR-001 – FR-005, FR-007, FR-008,
FR-010, FR-016, FR-017, FR-024, FR-025, FR-027; research R-7, R-15, R-16).

**Independent Test**: as one admin, pin three entries from three sections (one from the
palette), unpin one from the Pinned section and one from its original place, reload, sign in
from a second browser — same pins, same order; a second admin sees none (quickstart *Pins*
1–5, 7, 9).

- [X] T027 [P] [US1] **RED** `admin/test/unit/pinned-entries.test.ts`: `visibleDestinations` keeps the **first visible** entry per destination in section order and omits hidden entries (the one map both the Pinned section and the palette read — FR-006, FR-027); `resolvePinnedEntries` returns stored order, omits hidden and retired destinations, copies the original's `end` flag and source `sectionKey`; `pinDestination` appends and never duplicates (FR-007), never drops or reorders an existing pin (FR-008); `unpinDestination` removes only that destination; `reorderVisiblePins` is slot-preserving — hidden pins keep their indices, visible slots take the new order (FR-009, US2 AS-3, US4 AS-4). Fails: module does not exist
- [X] T028 [US1] Implement `packages/admin-shell/src/lib/pinned-entries.ts` per client contract §2.1 and §2.3; export `NavItem`/`NavSection` as types from `packages/admin-shell/src/components/AppShell.tsx` (or move them to `packages/admin-shell/src/components/sidebar/nav-types.ts`); T027 green
- [X] T029 [P] [US1] Add the US1 `core` keys of client contract §5 to `packages/modules/_i18n/i18n/en.json` and `pl.json`: `appShell.pinned.{heading,pin,unpin,fromSection,fromMain}`, `appShell.pinned.announce.{pinned,unpinned}`, `appShell.palette.pin.{hintPin,hintUnpin,instructions}`, `adminPreferences.{saveFailed,dismiss}` (12 keys; the 8 `appShell.pinned.reorder.*` keys land in T050); rebuild `mod-i18n`
- [X] T030 [P] [US1] **RED** `admin/test/components/AppShell.pinned.test.tsx` (StrictMode; pins seeded through `initial.preferences`; `apiClient` stubbed): **AS-1** no pins → no Pinned heading, every entry where it is; **AS-2 / FR-004** hovering or focusing an entry reveals a separate `button` (not inside the link) named "Pin Orders", `aria-pressed="false"`; **owner ruling** — Tab order is link → its pin button → next link, and activating the button never moves focus; **AS-3** activating pins: a Pinned section appears **first** in the sidebar's DOM order (also SC-001), the entry stays in its section, the live region says "Orders pinned", a `PATCH { sidebarPins: ['/orders'] }` is sent; **AS-4 / FR-007** a further pin is appended at the end; **AS-5** unpin from the Pinned section and from the original row both work and announce; removing the last pin removes the section; **AS-6 / FR-016** with seeded pins the very first `render` result already contains the Pinned section — asserted synchronously, before any `waitFor`; **AS-7** a different admin's seeded session shows none of the first admin's pins; **AS-8** on a pinned destination both the pinned row and the original carry the active state; **AS-9** in rail mode the first rail entry is the Pinned section with the `Pin` icon and its popover lists the pins each with an unpin button; **AS-10** in the mobile drawer the pin control is rendered without hover and carries the ≥ 44 × 44 px touch class; **AS-11 / FR-008** 12 seeded pins all render and a 13th pin is accepted (no limit, no count shown); **AS-12** rendered with the Polish bundle the heading and accessible names are Polish; two pinned entries sharing a label have distinct `aria-describedby` source-section descriptions (edge case); **FR-017** a rejected `PATCH` keeps the pin on screen and shows one non-modal kit `Alert` with `adminPreferences.saveFailed` and a dismiss button (no `role="dialog"`), and a second failure in the same episode does not add a second one; **FR-024** the palette's groups and their item counts are identical with and without pins. Fails: no Pinned section
- [X] T031 [P] [US1] **RED** `admin/test/components/AppShell.pinned.a11y.test.tsx`: `expectNoAxeViolations` (`admin/test/helpers/axe.ts`) over the sidebar with three pins expanded, over the rail with the Pinned popover open, and over the open palette with a pinnable result highlighted (SC-007). Fails: no Pinned section / no pin control to find
- [X] T032 [P] [US1] **RED** `admin/test/components/AppShell.palette-pinning.test.tsx` (StrictMode; `useAdminActions` stubbed with an `open-orders`-shaped server Action whose `targetRoute` is `/orders`; client contract §2.3; research R-16): a pin button on the *Orders* Navigate row **and** on the server Action, named "Pin Orders" (the **sidebar** entry's label), `aria-pressed`, `aria-keyshortcuts="Alt+Enter"`, `tabIndex=-1`; none on a record row, on a create action (`/crm/opportunities/new`), on the assistant row, on "see all", on a destination whose module is off, or whose permission is withdrawn (US1 AS-14); clicking it pins without navigating or closing, the input keeps focus, the control flips to "Unpin Orders", and the Pinned section shows *Orders* at the end at once (AS-13); `Alt+Enter` on the highlighted pinnable row toggles and never navigates; plain `Enter` still navigates (AS-15); `Alt+Enter` on a row without the control does nothing; the outcome is announced in a live region **inside** the dialog; the input's `aria-describedby` resolves to `appShell.palette.pin.instructions`; every palette group's item count is unchanged (FR-024). Fails: `CommandPalette` has no `pinTargets`
- [X] T033 [US1] Implement `packages/admin-shell/src/components/sidebar/use-pin-actions.ts` (`usePinActions()` over `useAdminPreference('sidebarPins')` with `pinDestination`/`unpinDestination`) and `packages/admin-shell/src/components/sidebar/PinToggleButton.tsx` (`<button type="button" aria-pressed>`, lucide `Pin`/`PinOff`, revealed on `:hover`/`:focus-within`, always shown and ≥ 44 × 44 px in the drawer and under `(pointer: coarse)`)
- [X] T034 [US1] Implement `packages/admin-shell/src/components/sidebar/PinnedSection.tsx` (expanded and drawer: reuses `.b2b-sidebar__group` / `.b2b-nav-item` / the collapse button with group key `ADMIN_PINNED_GROUP_KEY`, driven by `AppShell`'s collapsed-groups state as it stands — it moves onto the store in T046; rows with the original's icon, `navLabel`, `NavLink end`, `aria-describedby` → `fromSection`/`fromMain`; one polite live region mounted empty) and `packages/admin-shell/src/components/sidebar/PreferencesSaveNotice.tsx` (kit `Alert` from `@endora-commerce/admin-kit/ui`, dismiss, announced politely, from `useAdminPreferencesStatus()`)
- [X] T035 [US1] Wire `packages/admin-shell/src/components/AppShell.tsx`: memoise `visibleDestinations(composedNav, isVisible)` with the **same** `useSurfaceVisibility()` predicate the sections use; render `PinnedSection` before `composedNav.map(…)` in the expanded sidebar and the drawer; a `PinToggleButton` after the link in every original row; a `pinned` variant as the **first** `RailSection` in rail mode (popover rows with an unpin control); `PreferencesSaveNotice` below the top bar; rebuild `admin-shell`; T030 green
- [X] T036 [US1] Palette in `packages/admin-shell/src/components/AppShell.tsx` (`CommandPalette`, `renderRow`, the window `keydown` handler): new prop `pinTargets` passed from `AppShell`; a pin button on every row with `pinTargets.has(row.to)` (`onMouseDown` → `preventDefault`, `onClick` → `stopPropagation` + `toggle`); `Alt+Enter` branch with `preventDefault`; narrow the existing branch to `e.key === 'Enter' && !e.altKey`; the `⌥↵`/`Alt+↵` hint on the highlighted pinnable row; the input's `aria-describedby`; a second polite live region inside the dialog; rebuild `admin-shell`; T032 and T031 green
- [X] T037 [US1] Regression: `pnpm --filter admin exec vitest run test/components/AppShell.` — the existing `AppShell.palette.test.tsx`, `.palette-records.test.tsx`, `.palette-diacritics.test.tsx`, `.permission-gating.test.tsx`, `.module-presence.test.tsx`, `.mobile.test.tsx` and the nav suites stay green; where a query becomes ambiguous because rows now hold a second button, narrow the query (`within(link row)`), never weaken an assertion
- [X] T038 [US1] Changeset `.changeset/164-admin-preferences-client.md` — `'@endora-commerce/admin-kit': minor`, `'@endora-commerce/admin-shell': minor`, `'@endora-commerce/mod-i18n': minor`: `useAdminPreference` / `useAdminPreferencesStatus`; the Pinned sidebar section (expanded, drawer, rail) and the palette's pin control with `Alt+Enter`; the save-failure notice; the new `core` strings (completed in T049 and T053)

**Verification**: `pnpm --filter @endora-commerce/mod-i18n run build && pnpm --filter @endora-commerce/admin-kit run build && pnpm --filter @endora-commerce/admin-shell run build && pnpm --filter admin exec vitest run test/unit/pinned-entries.test.ts test/components/AppShell. test/kit/admin-preferences-store.test.tsx && pnpm --filter @endora-commerce/admin-shell run typecheck && pnpm --filter @endora-commerce/admin-shell run lint && pnpm --filter admin run typecheck && pnpm --filter backend run i18n:hardcoded && pnpm --filter backend run check:bundle-pairing && pnpm --filter backend run check:admin-surface`

**Implementation notes (US1)**: the palette's Navigate group holds only *Home* today (every
other screen arrives as a module's server Action, `open-orders` among them), so T032's Navigate
case pins *Home* and its server-Action case pins *Orders*. The rail form of the Pinned section is
not a `role="menu"` — a menu may hold only menu items, and each pinned row holds a link and an
unpin button. Until T047, the rail cases enter rail mode through the collapse button rather than
a seeded `sidebarRailMode`. The palette's negative cases (T032) were seen to fail under a
mutation that made every row pinnable and the predicate `() => true`, then restored.

**Checkpoint**: US1 works end to end against the Phase 2 server — the MVP.

---

## Phase 4: User Story 2 — Pinned entries never reveal a surface I can no longer reach (P1) **[admin UI]**

**Goal**: FR-006 and SC-006 proved for every combination and every sidebar form (research R-7,
R-12; `specs/conventions/module-activation.md` item 5).

**Independent Test**: pin an entry, withdraw its permission → gone everywhere, nothing names it;
restore → back at its old position; repeat with the module operator-off and
platform-unavailable (quickstart *Pins* 8, 10).

- [X] T039 [P] [US2] **RED** `admin/test/components/AppShell.pinned-visibility.test.tsx` (StrictMode; presence seeded as `admin/test/components/AppShell.module-presence.test.tsx` does, permissions through the seeded session): the full matrix **permission withdrawn × operator-off × platform-unavailable**, each in the **expanded sidebar, the rail popover and the mobile drawer** — the pin is absent, and `document.body.textContent` contains no count, placeholder, tooltip or text naming it (US2 AS-1, AS-2, SC-006); with every pin hidden there is no Pinned heading and no rail icon (AS-4); re-rendering with access restored shows the pin at its **previous index** among the pins (AS-3); a stored destination that no sidebar entry contributes renders nothing and logs no error (AS-5); the palette shows no pin control for any hidden destination (FR-027 last sentence). **Seen to fail**: if this is written after T035 it may pass by construction — then, before accepting it, replace the predicate passed to `visibleDestinations` with `() => true` locally, confirm every hidden case reds, and revert; a case that stays green under that mutation is not testing FR-006 and must be rewritten
- [X] T040 [US2] Fix whatever T039 finds **inside** `packages/admin-shell/src/lib/pinned-entries.ts` or `packages/admin-shell/src/components/sidebar/PinnedSection.tsx` — never by adding a second visibility predicate (research R-7, issue #230); rebuild `admin-shell`; T039 green; record in this task whether any fix was needed
- [X] T041 [US2] Confirm the server side of XVII holds unchanged: `$SVC vitest test/integration/admin_users/off-state.test.ts` (T017's case) and `pnpm --filter backend run check:off-state-coverage`; switching a module off deletes no pin — assert in T039 that the seeded `sidebarPins` value is never written while the module is off (no `PATCH` sent)

**Verification**: `pnpm --filter @endora-commerce/admin-shell run build && pnpm --filter admin exec vitest run test/components/AppShell.pinned-visibility.test.tsx test/components/AppShell.module-presence.test.tsx test/components/AppShell.permission-gating.test.tsx test/unit/pinned-entries.test.ts && pnpm --filter @endora-commerce/admin-shell run typecheck && pnpm --filter @endora-commerce/admin-shell run lint && pnpm --filter backend run check:off-state-coverage`

**Result (US2)**: T039 was written after T035 and passed at once, so it was checked by mutation:
with the predicate handed to `visibleDestinations` replaced by `() => true`, 18 of its 19 cases
red (every hidden case in all three sidebar forms, the palette and the restore case); the
19th — a stored destination no entry contributes (AS-5) — is not governed by the predicate and
stays green, as it should. Source restored. **T040: no fix was needed.** T041: the off-state
integration file is green with T017's case, `check:off-state-coverage` reports
`switchable=39 proven=39 findings=0`, and T039 asserts no `PATCH` is sent while a pin is hidden.

**Checkpoint**: US1 + US2 are the complete P1 slice.

---

## Phase 5: User Story 3 — My existing layout settings follow me between devices (P2) **[admin UI]**

**Goal**: collapsed groups, rail mode and every list page size server-held; the one-time
carry-over; no legacy browser storage left (FR-010, FR-013 – FR-015, FR-022, FR-023, SC-003 –
SC-005; research R-8 – R-10).

**Independent Test**: set rail mode, fold two groups, choose page sizes on two lists; a second
browser shows them; a browser holding legacy values imports this admin's page sizes, opens in
the default sidebar layout and no longer holds this admin's legacy keys (quickstart *Layout
settings and the carry-over*).

- [X] T042 [P] [US3] **RED** `admin/test/kit/no-legacy-layout-storage.test.ts` (static, precedent `admin/test/components/saved-views-no-native-dialogs.test.ts`): no file under `packages/admin-kit/src`, `packages/admin-shell/src`, `packages/modules/*/src/admin` or `admin/src` matches `b2b-admin\.nav\.` or `b2b-admin\.page-size` except `packages/admin-kit/src/lib/admin-preferences/legacy-carry-over.ts` (SC-004, FR-010). Fails: `AppShell.tsx` and `use-page-size-preference.ts` name them
- [X] T043 [P] [US3] **RED** Rewrite the page-size cases of `admin/test/kit/session-cluster.test.tsx` (`:160-200`): the size comes from `initial.preferences.listPageSizes[scope]`; an absent list → 20; a stored `7` → 20 and **no** write (FR-015, US3 AS-7); two hook instances on `catalog-products` (the Product list and the product browser dialog) share one value (FR-014); `setPageSize(100)` sends `PATCH { listPageSizes: { orders: 100 } }` — only that list — and writes no `localStorage` key (FR-010); a foreground refetch returning another size does not resize the mounted list, while a fresh mount reads the new value (edge case); a new admin with nothing stored gets 20 everywhere (US3 AS-8). Fails: the hook still reads `localStorage`
- [X] T044 [US3] Re-implement `packages/admin-kit/src/lib/use-page-size-preference.ts` over the store per client contract §3 (signature unchanged; value read once at mount into local state; `setPageSize` → `set('listPageSizes', …)` for that scope); `packages/admin-shell/src/lib/use-page-size-preference.ts` stays the re-export it is; rebuild `admin-kit`; T043 green
- [X] T045 [US3] Update the three tests that seed the legacy page-size key (not listed in plan.md, found by `grep -rn "b2b-admin" admin/test`): `admin/test/kit/kit-product-browser.test.tsx:151`, `admin/test/modules/orders/OrderCreatePage.product-browser.test.tsx:178`, `admin/test/modules/quote_requests/RfqCreatePage.product-browser.test.tsx:183` — seed `initial.preferences.listPageSizes['catalog-products']` instead of `localStorage`, stub the resulting `PATCH`; no assertion weakened; all three green
- [X] T046 [P] [US3] **RED** `admin/test/components/AppShell.layout-preferences.test.tsx` (StrictMode): with seeded `sidebarCollapsedGroups: ['content','newsletter','pinned']`, `sidebarRailMode: true` and pins, the **first render** is already folded, railed and pinned, and a `MutationObserver` over the sidebar records **no** structural change after effects settle (FR-016, SC-003, US1 AS-6); folding a group sends `PATCH { sidebarCollapsedGroups: [...] }` and touches no `localStorage` key (US3 AS-1, FR-010); the Pinned section folds under `pinned` and is written the same way (FR-013); toggling rail mode (button and ⌘B) sends `PATCH { sidebarRailMode }` (AS-2); on the mobile tier a stored `sidebarRailMode: true` has no effect and ⌘B does nothing (FR-013); a stored unknown group token is ignored at render and **kept** in the next written set (FR-015); with nothing stored every group is open and rail is off (AS-8). Fails: `AppShell` still reads `localStorage`
- [X] T047 [US3] In `packages/admin-shell/src/components/AppShell.tsx` replace the collapsed-groups and rail-mode state with `useAdminPreference('sidebarCollapsedGroups')` and `useAdminPreference('sidebarRailMode')` (client contract §2.4); **delete** `STORAGE_KEY`, `RAIL_STORAGE_KEY`, `loadCollapsed`, `persistCollapsed`, `loadRailMode`, `persistRailMode` (`:401-450` and their call sites); `PinnedSection`'s collapse now persists through the store; update `admin/test/components/AppShell.version-badge.test.tsx:199` to seed `initial.preferences.sidebarRailMode: true` instead of `localStorage.setItem('b2b-admin.nav.rail-mode', '1')`; rebuild `admin-shell`; T046 and `AppShell.version-badge.test.tsx` green
- [X] T048 [P] [US3] **RED** `admin/test/kit/admin-preferences-carry-over.test.tsx` (StrictMode; client contract §4; FR-022, FR-023, SC-005, US3 AS-4 – AS-6): this admin's `b2b-admin.page-size.<scope>.<own id>` values are sent in **one** `POST …/legacy-import` and removed only after it succeeds, and the response's `listPageSizes` is adopted except for lists with a local in-flight / pending / unsaved write; keys of another admin and of `anon` are neither read nor removed; a server value wins and the local key is still removed; `b2b-admin.nav.collapsed-groups` and `b2b-admin.nav.rail-mode` are removed and **never** sent, also in unavailable mode, and the sidebar opens in its default layout; an invalid value (`'abc'`, `'7'`, a scope `'Bad_Scope'`) is removed and not sent; with nothing valid no request is made; a failed import keeps the keys and the next mount retries; a double mount (StrictMode) and two providers at once send idempotent requests and leave one value per list; storage throwing on access is tolerated; in unavailable mode the import waits and runs once the store becomes available. Fails: module does not exist
- [X] T049 [US3] Implement `packages/admin-kit/src/lib/admin-preferences/legacy-carry-over.ts` (the **only** file naming the legacy keys) and run it from `AdminPreferencesProvider.tsx` once per mount (step 1 always; steps 3–6 on availability, including after recovery); rebuild `admin-kit`; T048 and T042 green. Complete `.changeset/164-admin-preferences-client.md` with the US3 meaning: `usePageSizePreference` server-backed with the same signature; folded groups and rail mode server-held; on first load the browser's page sizes for the signed-in admin are carried over and removed, and the two unkeyed sidebar values are removed without being imported (owner ruling (d))
- [X] T050 [US3] Run the whole admin suite, `pnpm --filter admin run test`; where a test now reaches a `PATCH` through an `apiClient` mock without `patch`, add the stub; no assertion weakened. Record any pre-existing flake against T003's baseline rather than fixing it here

**Verification**: `pnpm --filter @endora-commerce/admin-kit run build && pnpm --filter @endora-commerce/admin-shell run build && pnpm --filter admin exec vitest run test/kit/no-legacy-layout-storage.test.ts test/kit/session-cluster.test.tsx test/kit/admin-preferences-carry-over.test.tsx test/kit/admin-preferences-store.test.tsx test/kit/kit-product-browser.test.tsx test/components/AppShell. test/modules/orders/OrderCreatePage.product-browser.test.tsx test/modules/quote_requests/RfqCreatePage.product-browser.test.tsx && pnpm --filter @endora-commerce/admin-kit run typecheck && pnpm --filter @endora-commerce/admin-kit run lint && pnpm --filter @endora-commerce/admin-shell run typecheck && pnpm --filter @endora-commerce/admin-shell run lint && pnpm --filter admin run typecheck && pnpm --filter backend run check:admin-surface`

**Result (US3)**: T050 — the whole admin suite is green, 379 files / 3751 tests, with no stub to
add and no pre-existing flake to record against T003. Mechanical: the three tests T045 names
now stub the kit's own `apiClient.patch` (the preferences store writes through it, not through
the barrel mock those files install), and `AppShell.version-badge.test.tsx` seeds
`preferences.sidebarRailMode` through a small option on its own `renderShell`. Rail mode is now
`stored && !mobile` at the top of `AppShell`, so every rail check below it reads one value.

**Checkpoint**: no Admin UI preference lives in the browser; existing page sizes survive the
upgrade.

---

## Phase 6: User Story 4 — Reorder my pins (P3) **[admin UI]**

**Goal**: drag, keyboard grab-mode and touch up/down within the Pinned section, slot-preserving
for hidden pins, announced, focus kept (FR-005, FR-009; research R-7).

**Independent Test**: with four pins, move the last to the top by drag and the first down by
keyboard, reload, sign in elsewhere — same order (quickstart *Pins* 6).

- [X] T051 [P] [US4] Add the eight `appShell.pinned.reorder.*` keys of client contract §5 (`handle`, `grabbed`, `moving`, `dropped`, `cancelled`, `moved`, `atStart`, `atEnd`) to `packages/modules/_i18n/i18n/en.json` and `pl.json`; rebuild `mod-i18n`
- [X] T052 [P] [US4] **RED** `admin/test/components/AppShell.pinned-reorder.test.tsx` (StrictMode): pointer drag of the last of four pins to the top reorders and sends `PATCH { sidebarPins }` in the new order (US4 AS-1); keyboard — focus a pin's handle, Space, ArrowUp, Space — moves it one up, focus stays on the moved row, and the live region says "Orders, position 1 of 4" (AS-2, FR-005); Escape during grab cancels with the `cancelled` sentence; `atStart`/`atEnd` at the bounds; `TouchReorderButtons` up/down in the mobile drawer do the same (WCAG 2.2 SC 2.5.7); with two of six pins hidden, reordering the visible four leaves the hidden two at their stored indices (AS-4, FR-009); the rail popover offers no reorder control; Polish rendering uses the Polish sentences. Fails: no reorder affordance
- [X] T053 [US4] In `packages/admin-shell/src/components/sidebar/PinnedSection.tsx` apply the kit's `useReorderList` + `TouchReorderButtons` + `ReorderAnnouncer` (`@endora-commerce/admin-kit/components`) to the **visible** pins in the expanded sidebar and drawer, labels from the T051 keys, `onReorder(next)` → `reorderVisiblePins(stored, next.map(d))` → `set('sidebarPins', …)`; not in the rail popover; rebuild `admin-shell`; T052 green; re-run T031's a11y test with a reorder handle present (add the case to `AppShell.pinned.a11y.test.tsx`). Complete `.changeset/164-admin-preferences-client.md` with reordering

**Result (US4)**: re-running T031's a11y file with the reorder handles present (T053) found one
real defect — `aria-posinset`/`aria-setsize` from `useReorderList` on a row with no role
(`aria-allowed-attr`). The pinned rows are now a `list` of `listitem`s; axe is clean, including
the new grabbed-handle case. Mechanical: the drag cases dispatch `dragstart`, `dragover` and
`drop` as three tasks, as a browser does. `TouchReorderButtons` is on every pinned row and, by
the kit's own stylesheet, shown below 1024 px.

**Verification**: `pnpm --filter @endora-commerce/mod-i18n run build && pnpm --filter @endora-commerce/admin-shell run build && pnpm --filter admin exec vitest run test/components/AppShell.pinned-reorder.test.tsx test/components/AppShell.pinned.test.tsx test/components/AppShell.pinned.a11y.test.tsx test/unit/pinned-entries.test.ts && pnpm --filter @endora-commerce/admin-shell run typecheck && pnpm --filter @endora-commerce/admin-shell run lint && pnpm --filter backend run i18n:hardcoded && pnpm --filter backend run check:bundle-pairing`

---

## Phase 7: Polish, cross-cutting concerns and the final verification **[docs]** **[gate]**

**Purpose**: FR-025, FR-026; release intent; derived artefacts and ledgers re-derived; the CI
gate and the suites MR pipelines skip (D-198), run locally. **One command at a time**; paste each
failure with its output.

- [X] T054 [P] English documentation — `packages/modules/admin_users/docs/admin_users.md`, section *Admin UI preferences* (FR-026, research R-14): operators — pin and unpin from the sidebar (pointer, keyboard: the pin button is the Tab stop after each entry; touch) and from ⌘K (the button beside a result, `Alt+Enter` / `⌥↵` on the highlighted one; `Enter` still opens), reorder (drag, keyboard, touch), preferences follow you across browsers and the PWA, a hidden pin returns with access, the save-failure notice, the one-time carry-over and the default sidebar layout after upgrade; engineers — the closed key set and bounds, the three routes and `/admin/me`'s `preferences`, `usePageSizePreference(scope)` and how a new list gets a remembered size, why there is no audit entry. No link to a sibling module's page (`check:module-docs`)
- [X] T055 Polish documentation — `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/admin_users.md` and its cache entry `docs/translation-cache/pl/packages--modules--admin_users--docs--admin_users.md.json` (`sourceHash` from `hashSourceBody()` in `backend/scripts/lib/docs-translation-cache.ts`, `content` = the Polish markdown), per `docs/docs/contributing/documentation-i18n.md`; then `pnpm --filter backend run check:docs-translations`, `check:module-docs`, `check:doc-snippets`
  - Result: `check:docs-translations` `sources=167 findings=0`; `check:module-docs` `findings=0`; `check:doc-snippets` clean. The cache entry's `sourceHash` was computed with `hashSourceBody()` itself.
- [X] T056 [P] Add `useAdminPreference` and `useAdminPreferencesStatus` to the `./lib` row of `packages/admin-kit/README.md` (`:14`)
- [X] T057 Changesets: confirm exactly the three files of research R-14 exist with every package they name (`.changeset/164-admin-preferences-contract.md`, `-server.md`, `-client.md`), each `minor`, one meaning per file, bodies passing the disclosure gate (`specs/conventions/commercial-data.md`); `git fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master && pnpm --filter backend run check:release-intent -- --since origin/master`
  - Result: exactly the three files, each `minor`; `check:release-intent -- --since origin/master` `violations=0` (`changesets-added=3`). `origin/master` had moved to `0bf86450d` since the branch point.
- [X] T058 Regenerate and commit what changes: `pnpm --filter backend run composer:generate`, `pnpm --filter backend run manifests:generate`, `pnpm install --lockfile-only`; then `pnpm --filter backend run manifests:check`, `pnpm --filter backend run overlay:check` and `pnpm install --frozen-lockfile`; `git status --short` shows nothing unexpected (the migration registry change belongs to T013's commit)
  - Result: `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` changed nothing; `manifests:check`, `overlay:check` and `pnpm install --frozen-lockfile` clean.
- [X] T059 [P] i18n (FR-025, SC-009): `pnpm --filter backend run i18n:hardcoded`, `check:bundle-pairing`, `check:error-translations`; `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/_i18n/registered-bundles-shape.test.ts`; add to `admin/test/components/AppShell.pinned.test.tsx` a case that renders every new key (all 20 of client contract §5) in `en` and `pl` and asserts none resolves to its raw key
  - Result: `i18n:hardcoded` `regressions=0`; `check:bundle-pairing` `findings=0`; `check:error-translations` `violations=0`; `registered-bundles-shape.test.ts` 66 passed; the 20-key case in `AppShell.pinned.test.tsx` green in `en` and `pl`.
- [X] T060 Residue and the `AGENTS.md` traps: (1) `grep -rn "b2b-admin.nav\|b2b-admin.page-size\|loadCollapsed\|persistCollapsed\|loadRailMode\|persistRailMode\|RAIL_STORAGE_KEY" admin packages backend/test docs --include=*.ts --include=*.tsx --include=*.json --include=*.md | grep -v /dist/` answers only `legacy-carry-over.ts`, its test, the static test and the docs' upgrade note; (2) **grep `backend/test/**`** for every deleted identifier and for the kit's old `PAGE_SIZE_OPTIONS` declaration — a contract or integration test that imports or spawns it fails with `ERR_MODULE_NOT_FOUND` that `test:unit:fast` never sees; (3) **re-derive what is derived from a location**, not only what names it: `backend/test/unit/kernel/module-removal.test.ts` (no module moved — confirm green), the `backend/scripts/ledgers/test-ownership/` shards (`check:test-ownership`), `backend/scripts/ledgers/admin-surface.ts` (`check:admin-surface`), `PERMISSIONLESS_ADMIN_ROUTES`, `backend/test/fixtures/openapi-baseline.json` (T021), `backend/src/db/migrations-registry.generated.ts` (T013); record each result in this task
  - Result: (1) only `legacy-carry-over.ts` and its test name the legacy keys (the English and Polish docs describe the carry-over without naming them; the static test matches by pattern); (2) nothing under `backend/test` or `backend/scripts` names a deleted identifier or the kit's old array; (3) `module-removal.test.ts`, `migrations-registry.test.ts` and `permissionless-admin-routes.test.ts` green (276 tests); `check:test-ownership` `findings=0`; `check:admin-surface` `findings=0`; the OpenAPI baseline (T021) and the migration registry (T013) are committed with their inputs.
- [X] T061 Recorded read sizes (`specs/conventions/check-estate.md`, read it **first**): run the `check-*` estate; a recorded read size that drifts **inside** its band is left alone (the release pull request re-records drift). Re-record **only** an entry the band refuses, by re-measuring on a clean tree — never compute from a delta, never widen a band; record in this task which entries, if any, were re-recorded and why
  - Result: `test/unit/scripts/check-read-size.test.ts` green; the drift report reads `36 drifted, 11 agree, 0 not measured, of 47 recorded`, every drift inside its band (largest: `check-doc-snippets` files 406 → 415, 4% of the way to the ceiling). Nothing was re-recorded, per the rule.
- [X] T062 The `quality` job's checks, serially, each line of `.github/workflows/quality.yml` after `pnpm -r run lint`: `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts`; `pnpm --filter backend exec tsx scripts/check-channel-resolution.ts --enforce`; `pnpm --filter backend run` each of `check:command-coverage -- --strict`, `check:kernel-boundary`, `check:module-boundary`, `check:admin-surface`, `check:admin-zones`, `check:entry-scope`, `check:container-imports`, `check:port-dependencies`, `check:port-catches`, `check:port-shape`, `check:subscribe-seam`, `check:queue-names`, `check:transaction-context`, `check:singleton-identity`, `check:entry-presence`, `check:lock-claims`, `check:action-route-permissions`, `check:harness-teardown`, `check:fixture-substitution`, `check:shared-table-wipes`, `check:nul-bytes`, `check:diacritic-folds`, `check:doc-snippets`, `check:module-docs`, `check:docs-translations`, `check:error-translations`, `check:bundle-pairing`, `check:env-inputs`, `check:block-names`, `check:block-renderers`, `check:class-vocabulary`, `check:off-state-coverage`, `check:test-ownership`, `check:default-language-prose`, `check:demo-data-budget`, `check:storefront-indexability`, `check:rsc-discipline`, `i18n:hardcoded`; `pnpm run check:pdfmake-footprint`; `pnpm --filter backend run` each of `overlay:check`, `check:divergence`, `check:release-intent`, `check:platform-surface`, `manifests:check`; then `pnpm run check:naming && pnpm run check:language`
  - Result: every check exits 0 after one repair: `check:class-vocabulary` reported two modifier classes this feature rendered but never styled (`b2b-sidebar__group--pinned`, `b2b-sidebar__rail-popover--pinned`); both were removed from the markup. `check:naming` and `check:language` OK.
- [~] T063 [P] Quickstart tour by hand on `pnpm run setup && pnpm run dev` (quickstart.md, every numbered step, two admins, two browsers and a narrow viewport); the curl block of *API by hand*; record what was exercised. Update § *Requirement → test* below if any test file or task id moved during implementation
  - **Not done by the implementing agent.** `pnpm run setup` runs `db:fresh` against the development Postgres, which another session on this machine was using at the time; resetting it was not acceptable, and there is no browser available to the agent. The tour, the two-browser and narrow-viewport checks and the curl block are left for the owner. No test file or task id moved, so § *Requirement → test* stands.
  - **Partial tour by the lead session, 2026-10-27**, on an isolated database (`b2b_wt164`: `pnpm --filter backend run setup` + `cli demo seed`; the shared dev database was left untouched), Chrome, desktop viewport, `admin@demo.local`. Exercised and as specified: pin from the sidebar hover control (Orders, Products) → Pinned section appears first; pin from ⌘K with `Alt+Enter` (Invoices) → pinned at the end, palette stays open, the control turns into *Unpin*; `Enter` on the same row still navigates; reload keeps pins, the active route is highlighted in the Pinned section too; rail mode → Pinned is the first rail icon and its fly-out lists the pins with an unpin control; `admin_user_preferences` held `sidebarPins = ["/orders","/catalog/products","/invoices"]` and `sidebarRailMode = true`. **Not exercised by hand**: the module-off / permission-withdrawn round trip (the browser extension stalled twice; covered by T039–T041), a second admin and a second browser, the narrow-viewport drawer, drag reorder, the offline notice, the legacy carry-over and the curl block.
- [X] T064 **Final verification**, one command at a time, on the branch tip, each result recorded beneath this task: (1) `pnpm run build:packages`; (2) `pnpm -r run typecheck`; (3) `pnpm -r run lint`; (4) targeted backend tests — `pnpm --filter backend exec vitest run --config vitest.unit.config.ts test/unit/kernel/permissionless-admin-routes.test.ts test/unit/db/migrations-registry.test.ts test/unit/_i18n/registered-bundles-shape.test.ts test/unit/kernel/module-removal.test.ts` and `pnpm --filter backend run test:unit:fast`; (5) the touched packages' suites — `pnpm --filter @endora-commerce/contracts --filter @endora-commerce/mod-admin-users --filter @endora-commerce/admin-kit --filter @endora-commerce/admin-shell --filter @endora-commerce/mod-i18n --filter admin run test`, then `pnpm --filter '!backend' run test` (a known load-timing flake in a file this branch does not touch is recorded, re-run alone, and named); (6) **with services** (D-198 — MR pipelines skip these), from `backend/`: `$SVC vitest test/contract/admin_users test/integration/admin_users test/contract/kernel/openapi-baseline.test.ts test/unit/db`; and, if time allows before the pull request, the complete `TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5441/b2b_test pnpm --filter backend run test`. If the services are not available, say so in this task — do not report the feature verified without (6)
  - Result, on `1a3a8231a` (the code tip; the commit after it touches `research.md` and this file only), Node 22.20:
    (1) `build:packages` exit 0. (2) `pnpm -r run typecheck` exit 0. (3) `pnpm -r run lint` exit 0, 0 errors (warnings only, all pre-existing).
    (4) the four targeted unit files: 342 passed. `test:unit:fast`: 359/360 files, 7700/7702 tests — the 2 failures are
    `test/unit/ci/dockerfile-workspace-supply.test.ts`, which spawns pnpm through corepack and finds no pnpm 12.8.1 under this
    Node 22 install; the same file passes 10/10 under the machine's Node 26. Environment, not this branch.
    (5) touched packages: contracts 1364, `_i18n` 6, `admin_users` 151, admin 3760/3761 (one load flake,
    `test/modules/crm/board-card-fields.test.tsx`, green alone twice). `pnpm --no-bail --filter '!backend' run test`: every
    member green except `packages/cli` `test/npmrc-auth-effect.test.ts` (2 tests; installs through corepack; passes under Node 26)
    and one admin load flake, `test/modules/quote_requests/negotiation-zones.test.tsx`, green alone twice. Neither file is touched
    by this branch.
    (6) with services (postgres-test :5441): `test/contract/admin_users`, `test/integration/admin_users`,
    `test/contract/kernel/openapi-baseline.test.ts`, `test/unit/db` — 36 files / 645 tests passed.
    The complete backend suite was started (4 workers) and stopped by the implementing agent after 1h26m and 1592 files with
    **no failure**; it did not complete.

**Verification**: T054 – T064 each green, in order, on the same tip; the tip is the one pushed.

---

## Dependencies & execution order

```text
Phase 1 ──► Phase 2 (2a ─► 2b; 2a ─► 2c) ──┬─► Phase 3 (US1) ──┬─► Phase 4 (US2)
                                            │                   ├─► Phase 6 (US4)
                                            │                   └─► Phase 5 (US3) — T047 needs T034/T035
                                            └─► Phase 5 (US3) T042–T045, T048–T049 need only Phase 2
Phases 3–6 ──► Phase 7
```

- **Foundational blocks everything.** Within it, 2a (contracts) precedes 2b and 2c; 2b and 2c
  are independent of each other — the kit's tests stub `apiClient`, so the store does not wait for
  the routes except for the by-hand tour.
- **US1 before US3, deliberately against plan.md's phasing.** The plan orders "shell: collapsed
  groups and rail on the store" (its phase 6) **before** the Pinned section (its phase 7); this
  file follows the stories' priority instead. The one coupling is the Pinned section's own fold
  (FR-013, key `pinned`): in Phase 3 it rides on `AppShell`'s existing collapsed-groups state
  (T034), and T047 moves that state onto the store with every other group. The `pinned` fold being
  server-held is asserted in T046, not in Phase 3.
- **US2 needs US1's rendering**; it adds no production code unless T039 finds a defect.
- **US4 needs US1's `PinnedSection`** and is independent of US2 and US3.
- Within a phase, a **RED** task precedes the task that turns it green.

### Within each user story

Tests (RED) → pure helpers → components → `AppShell` wiring → regression run → changeset.

## Parallel examples

- **Phase 2**: T004, T006, T008 (three test files) together; then T010, T014, T015, T016, T017,
  T024 — six RED files in two packages and two test trees — together before T011 / T018 / T025.
- **Phase 3**: T027, T029, T030, T031, T032 together (separate files); T033 → T034 → T035 → T036
  are sequential (`AppShell.tsx`).
- **Phase 5**: T042, T043, T046, T048 together; T044, T047, T049 then turn them green.
- **Phase 7**: T054, T056, T059 together; T063 beside T062.

## Implementation strategy

- **MVP = Phases 1–3** (US1): pins from the sidebar and the palette, server-held and isolated.
  Add **Phase 4** before shipping — US2 is part of the P1 slice (a pin must never advertise a
  hidden surface), so the first releasable increment is Phases 1–4.
- **Increment 2 = Phase 5** (US3, owner ruling (a)): the three existing settings and the
  carry-over. **Increment 3 = Phase 6** (US4).
- Phase 7 closes the feature. One pull request for the branch; each increment already carries
  its changeset text.

## Requirement → test

R-13's mapping, with the task that writes each test.

| Requirement | Test task(s) |
| --- | --- |
| FR-001 pin/unpin any visible entry | T030, T032 |
| FR-002 Pinned section first; absent with no visible pin | T030 (expanded, drawer, rail), T039 (AS-4) |
| FR-003 label/icon/active state from the original; original stays | T027 (`end` flag), T030 (AS-3, AS-8, AS-12) |
| FR-004 separate control, hover/focus, touch 44 px, state, name; one extra Tab stop (owner ruling) | T030, T031 |
| FR-005 announcements | T030 (pin/unpin), T032 (palette, in-dialog region), T052 (move) |
| FR-006 hidden pin never revealed, kept, restored in place | T027, T039 |
| FR-007 append; one per destination | T004, T014, T027, T030 |
| FR-008 no product limit; technical bound 200; no drop/reorder | T004, T014, T027, T030 (AS-11) |
| FR-009 reorder by drag and non-drag; hidden pins stable | T027, T052 |
| FR-010 server-held; no browser storage as source of truth | T014, T043, T046, T042 |
| FR-011 own preferences only; no permission code | T014, T019/T020 (ledger tests) |
| FR-012 closed set, shapes, bounds; refused with nothing changed | T004, T014 |
| FR-013 collapsed groups incl. `pinned`; rail ignored on mobile | T046 |
| FR-014 per list, default 20, shared `catalog-products` | T004, T043 |
| FR-015 unknown stored values ignored, not rewritten | T004, T010, T043, T046 |
| FR-016 applied on first paint, with identity | T015, T030 (AS-6), T046 |
| FR-017 optimistic; notice once; retry; no stale value | T024, T030 (notice) |
| FR-018 load failure → defaults, nothing saved, later load | T016 (`/admin/me` null), T024 (unavailable mode) |
| FR-019 refetch on load and foreground, pending kept | T024, T043 (open list not resized) |
| FR-020 no audit entry | T014; `check:command-coverage -- --strict` (T022, T062) |
| FR-021 platform-global classification | `check-entity-tenant-classification.ts` (T013, T022, T062) |
| FR-022 carry-over: own page sizes, server wins, unkeyed removed | T010, T014, T048 |
| FR-023 idempotent carry-over, never overwrites | T016, T048 |
| FR-024 no palette entry/group, no permission code | T030, T032; `check:action-route-permissions` (T022) |
| FR-025 en + pl strings | T029, T051, T059, T030 (AS-12) |
| FR-026 docs, both audiences, en + pl | T054, T055 (`check:module-docs`, `check:docs-translations`) |
| FR-027 palette pin control, destination-only, `Alt+Enter` (owner ruling) | T027 (`visibleDestinations`), T032, T031, T039 |
| SC-001 one activation, no scroll, ≤ 10 pins | T030 (Pinned section first in DOM order — jsdom measures no scroll; confirmed by hand in T063) |
| SC-002 identical on two browsers within one reload | T014, T015 (server document), T024 (refetch) |
| SC-003 zero layout shifts from preferences | T046 (`MutationObserver`), T030 (AS-6) |
| SC-004 no legacy key outside the carry-over | T042, T060 |
| SC-005 no page size lost on upgrade | T048 |
| SC-006 no pin renders that its original would not | T039 |
| SC-007 keyboard-only and axe-clean, expanded and rail | T031, T030, T052 |
| SC-008 every scenario and FR automated | this table; isolation T014, refusals T014, failed save T024, idempotent import T016/T048 |
| SC-009 every string resolves in en and pl | T059 |
| XVII platform axis for the new routes | T017 |
