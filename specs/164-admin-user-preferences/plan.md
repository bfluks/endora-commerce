# Implementation Plan: Admin user preferences — pinned sidebar items, and the admin's layout settings kept on the server

**Branch**: `feat/sidebar-pinned-items` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/164-admin-user-preferences/spec.md` (owner-approved
2026-10-27; rulings (a)–(e) binding — (e) and FR-027, pinning from the command palette, were added
the same day and are folded in here).

## Summary

An admin can pin any sidebar entry into a *Pinned* section at the top of the sidebar, and pins,
folded groups, rail mode and list page sizes follow the admin across browsers and the PWA. The
approach, with evidence and the rejected alternatives in [research.md](./research.md):

- **`admin_users` owns one new table**, `admin_user_preferences` — one row per (admin, key),
  `jsonb` value, composite primary key, `@GlobalEntity()`, foreign key to `admin_users`
  `on delete cascade` (R-1). Four keys, closed in `@endora-commerce/contracts`, strict on write
  and tolerant on read, with a technical pin bound of 200 against the 80 entries the platform can
  contribute today and no product limit (R-2, ruling (c)).
- **Three self-service routes** under `/api/v1/admin/me/preferences` — `GET`, `PATCH` (per-key
  replace, per-list merge for page sizes) and `POST …/legacy-import` (insert-if-absent, never
  overwrites) — gated by a session and no permission code, with no admin id anywhere on the
  wire (R-3). Writes are personal UI configuration outside the Command Bus, on the
  `setPreferredLanguage` / saved-views precedent (R-4).
- **Preferences ride on `GET /api/v1/admin/me`**, the one request the shell already waits for,
  so the first paint is already pinned, folded and railed; a failed read answers `null` and the
  admin still signs in (R-5).
- **One client store in `@endora-commerce/admin-kit/lib`, mounted by `AuthProvider`**:
  optimistic, one write in flight per key with the newest coalesced, retry on reconnect /
  foreground / next change, refetch on foreground, last-write-wins, and an *unavailable* mode
  that saves nothing and replays the admin's own deltas once loading succeeds (R-6).
  `usePageSizePreference(scope)` keeps its signature (R-9).
- **The Pinned section is the shell's own entries filtered by the shell's own predicate**, so a
  pin cannot outlive its original's permission or module presence (R-7, SC-006); reorder reuses
  the kit's `useReorderList` (drag, keyboard, touch, announcements) with a slot-preserving merge
  so hidden pins keep their place.
- **Pinning from ⌘K** (R-15, R-16, FR-027): `AppShell` computes one map of the sidebar's visible
  destinations and hands it to both the Pinned section and `CommandPalette`; a palette result
  whose destination is in it — Navigate row or server Action alike — gets a pin button beside it
  and `Alt+Enter` on the highlighted row, while focus stays in the search input and `Enter` keeps
  opening the destination; no palette entry or group is added.
- **Carry-over once** (R-10): this admin's page sizes are imported insert-if-absent and removed
  on confirmation; the two unkeyed sidebar keys are removed and never imported (ruling (d)).

No new dependency of any kind. One module migration.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod (backend); React 19 through `@endora-commerce/admin-kit` and `@endora-commerce/admin-shell` (admin) — no new runtime, dev or workspace dependency
**Storage**: PostgreSQL — one new platform-global table `admin_user_preferences`, owned by `admin_users`
**Testing**: Vitest — co-located unit tests in `packages/contracts` and `packages/modules/admin_users`; `backend/test/{contract,integration}` for server-bound tests; `admin/test/{kit,components,unit}` for the store, the carry-over and the shell, every render in `<StrictMode>`; `admin/test/helpers/axe.ts` for SC-007
**Target Platform**: Linux server (backend); the admin SPA and its installed PWA in evergreen browsers
**Project Type**: web application — monorepo with `backend/`, `admin/`, `packages/`
**Performance Goals**: no added request before first paint (preferences ride on `/admin/me`); one indexed read per load plus one per foreground; one small `PATCH` per change, coalesced under rapid input
**Constraints**: zero sidebar layout shift attributable to preferences (SC-003); no browser storage as source of truth (FR-010, SC-004); self-service only, no permission code (FR-011, FR-024); no audit entry (FR-020); a hidden pin never leaks (FR-006, SC-006); WCAG 2.2 AA, keyboard-complete, 44 px touch targets (FR-004, FR-009, SC-007)
**Scale/Scope**: 1 table, 1 entity, 1 service + 1 pure document module, 3 new routes + 1 extended, 0 new error codes, 1 contracts file, 1 kit store (4 files), 1 rewritten kit hook, 1 shell helper file + 3 shell components + 1 shell hook + `AppShell`/`RailSection`/`CommandPalette` changes, 20 `core` keys × 2 languages, 1 docs section × 2 languages, 3 changesets

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design — same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | `admin_users` owns the table, entity, migration, service, routes and docs; no other module gains an entity. The shell and the kit reach the data only through `admin_users`' published HTTP routes. The foreign key is intra-module (no lifecycle edge). No port is published — nobody else has a demand. |
| **II. API-first** | Pass | `packages/contracts/src/admin-preferences.ts` and the `adminMeResponseSchema` extension are written first, with their test ([contracts/admin-preferences-api.md](./contracts/admin-preferences-api.md)). The `/admin/me` change is additive. |
| **III. TDD (NN)** | Pass | Every FR and SC maps to a test written first ([research.md](./research.md) R-13): unit (contracts, document logic), contract (routes, isolation, no audit), integration (real DB: LWW, merge, concurrent import, cascade, degrade), and admin interaction tests per user story. |
| **IV. YAGNI, minimal dependencies** | Pass | No dependency. No new module, no port, no error code, no Setting, no cache, no live sync, no version/ETag protocol. Reorder reuses the kit's dependency-free primitive rather than `@dnd-kit`. |
| **V. TypeScript everywhere** | Pass | Zod at every new boundary; types inferred; the kit's `AdminMe` gains the inferred `AdminPreferences` type. |
| **VI. Naming (NN)** | Pass | Routes kebab-case (`/me/preferences`, `/legacy-import`); table and columns snake_case; JSON keys camelCase; the migration class is named by `migration:new` with the `AdminUsers…` owner segment. |
| **VII. SEO, performance** | N/A | Admin only; storefront untouched. |
| **VIII. English (NN)** | Pass | Code, comments, specs and docs in English; Polish only in the `pl` bundle and the Polish docs tree. |
| **IX. UI reuse** | Pass, one new composite | The Pinned section reuses the sidebar group, item, collapse button and rail popover; the pin control is the existing icon-button pattern; reorder is the kit's `useReorderList` + `TouchReorderButtons` + `ReorderAnnouncer`; the notice is the kit's `Alert`. Net-new: the Pinned section composite itself — UX justification in Complexity Tracking. |
| **X. Queue consumers** | N/A | Nothing asynchronous. |
| **XI. Tenant isolation (NN)** | Pass | `AdminUserPreference` is `@GlobalEntity()`, classified for `check-entity-tenant-classification`: platform-side users' personal configuration, holding no tenant data (FR-021). Not a "no-organization" path: no tenant-owned row is read or written. Cross-admin isolation is proven by contract tests. |
| **XII. Sales-channel scoping (NN)** | N/A | No channel-scoped read. |
| **XIII. Command Bus auditing (NN)** | Pass, by the spec's assumption | Personal UI configuration, not a domain mutation (FR-020); `command-coverage-ignore` on each writing method, the precedent of `setPreferredLanguage`, `ProductEditorPreferencesService.upsert` and 147's saved views (R-4). A contract test asserts no audit row; `check:command-coverage -- --strict` holds the markers both ways. |
| **XIV. Entity-agnostic extensibility** | N/A | No "add a field" requirement. |
| **XV. Untouched core / overlay** | N/A | No overlay change; an overlay's nav entries are pinnable like any other (they are composed `NavItem`s). |
| **XVI. Command palette** | Pass | No new surface, no palette entry and no palette group (FR-024). The palette gains a pin control beside existing results whose destination is a visible sidebar entry (FR-027, ruling (e)); matching by that destination means it never advertises a surface the admin cannot reach, which is XVI's own "permission-gated" concern. |
| **XVII. Operator-toggleable modules (NN)** | Pass | `admin_users` is non-deactivatable; its new routes are gated by `ctx.routes` on the platform axis, proven by extending `backend/test/integration/admin_users/off-state.test.ts`. A pin is the original entry filtered by `isSurfaceVisible`, so a switched-off or unavailable module's pin is absent on every sidebar form, proven by the full matrix in `AppShell.pinned-visibility.test.tsx` (SC-006). Switching a module off deletes no pin. |

**Admin permission manifest** — no new code (FR-011); the three routes are `requireAdmin()` and
are added to `PERMISSIONLESS_ADMIN_ROUTES` with their reasons. `permission-inventory.test.ts`
and `check:action-route-permissions` are unaffected (no manifest change).
**Command palette** — no entry or group added (FR-024); a control on existing results (FR-027,
R-15/R-16), with `Alt+Enter` as its keyboard binding.
**i18n** — 20 `core` keys in `packages/modules/_i18n/i18n/{en,pl}.json`; server refusals use the
existing translated `VALIDATION_FAILED` (R-11).
**Settings module** — no configuration introduced; the pin bound is a contract constant (R-12).
**Redis cache invalidation** — nothing is cached server-side (R-12).

## Project Structure

### Documentation (this feature)

```text
specs/164-admin-user-preferences/
├── spec.md
├── plan.md                                   # this file
├── research.md                               # R-1 … R-16, readings ruled by the owner 2026-10-27
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-preferences-api.md              # Zod, routes, write semantics, ledger entries
│   └── admin-preferences-client.md           # store, hooks, shell rendering, palette pinning, carry-over, core keys
├── checklists/requirements.md
└── tasks.md                                  # /speckit.tasks — not created by this step
```

### Source Code (repository root)

```text
packages/contracts/src/
├── admin-preferences.ts                      # NEW — keys, bounds, write/read schemas, page-size options
├── admin-preferences.test.ts                 # NEW
├── admin.ts                                  # adminMeResponseSchema + preferences
└── index.ts                                  # + export

packages/modules/admin_users/
├── src/backend/entities/admin-user-preference.entity.ts         # NEW
├── src/backend/services/admin-preference-document.ts            # NEW — pure: assemble, merge, bound
├── src/backend/services/admin-preference-document.test.ts       # NEW
├── src/backend/services/admin-preference-service.ts             # NEW — read / update / importLegacy
├── src/backend/routes.admin.ts                                  # /admin/me + preferences; 3 routes
├── src/backend/plugin.ts, index.ts                              # construct service; entities[]
├── src/migrations/<stamp>_admin_users_admin_user_preferences.ts # NEW (scaffolded)
├── src/migrations/index.ts                                      # + class (array and named export)
└── docs/admin_users.md                                          # + Admin UI preferences

packages/admin-kit/
├── src/lib/admin-preferences/{store.ts,AdminPreferencesProvider.tsx,use-admin-preference.ts,legacy-carry-over.ts}  # NEW
├── src/lib/auth.tsx                          # AdminMe.preferences; mounts the provider
├── src/lib/use-page-size-preference.ts       # over the store, same signature
├── src/lib/page-size-options.ts              # re-exports ADMIN_LIST_PAGE_SIZE_OPTIONS
├── src/lib/index.ts                          # + useAdminPreference, useAdminPreferencesStatus
└── README.md                                 # ./lib row

packages/admin-shell/src/
├── lib/pinned-entries.ts                     # NEW — visibleDestinations, resolve, pin, unpin, reorderVisiblePins
├── components/sidebar/{PinnedSection.tsx,PinToggleButton.tsx,PreferencesSaveNotice.tsx,use-pin-actions.ts}  # NEW
└── components/AppShell.tsx                   # store-backed collapse/rail; pin control; rail variant; CommandPalette pinTargets + Alt+Enter; legacy constants deleted

packages/modules/_i18n/i18n/{en,pl}.json      # + appShell.pinned.*, adminPreferences.*

backend/
├── src/db/migrations-registry.generated.ts   # regenerated (composer:generate)
├── test/helpers/permissionless-admin-routes.ts           # + 3 entries
├── test/contract/admin_users/me-preferences.test.ts      # NEW
├── test/contract/admin_users/me.test.ts                  # extended
├── test/integration/admin_users/preferences-persistence.test.ts  # NEW
└── test/integration/admin_users/off-state.test.ts        # extended

admin/test/
├── kit/{admin-preferences-store,admin-preferences-carry-over}.test.tsx   # NEW
├── kit/no-legacy-layout-storage.test.ts                                  # NEW
├── kit/session-cluster.test.tsx                                          # page-size cases rewritten
├── unit/pinned-entries.test.ts                                           # NEW
└── components/AppShell.{pinned,pinned-visibility,pinned-reorder,palette-pinning,layout-preferences,pinned.a11y}.test.tsx  # NEW

docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/admin_users.md + docs/translation-cache/pl/<entry>.json
.changeset/164-admin-preferences-{contract,server,client}.md
```

**Structure Decision**: the existing monorepo layout. Server code in the owning module's
package; harness-free single-module tests beside their subjects (`check:test-ownership`);
server-composing tests under `backend/test/`; admin tests under `admin/test/`. The pure pin
helpers live in the shell, the store in the kit (R-6); nothing is placed next to a module's
`src/manifest.ts`.

## Migrations

One, owned by `admin_users`, scaffolded — never numbered by hand
(`specs/conventions/module-migrations.md`):

| Module | Scaffold | Content | Depends on |
| --- | --- | --- | --- |
| `admin_users` | `pnpm --filter backend run migration:new -- --module admin_users --name admin_user_preferences` | `create table admin_user_preferences` (PK `(admin_user_id, preference_key)`, FK → `admin_users(id)` `on delete cascade`); `down` drops it | its own `admin_users` table only — no manifest `dependencies` change |

Then: add the class to `packages/modules/admin_users/src/migrations/index.ts`; run
`pnpm --filter backend run composer:generate` and commit
`backend/src/db/migrations-registry.generated.ts` (and anything else it rewrites);
`manifests:generate` + `manifests:check` + `pnpm install --lockfile-only` are expected to show no
diff and are run anyway. `pnpm run setup` exercises it on a fresh database.

## Phasing

Ten phases (1–8, 8b, 9), each independently committable; the **admin UI** phases may be routed to
`endora-commerce-designer` for copy, focus and layout review.

| # | Phase | Kind | Story |
| --- | --- | --- | --- |
| 1 | Contracts: `admin-preferences.ts`, `/admin/me` field, page-size options moved | backend (shared) | all |
| 2 | `admin_users`: entity, migration, document module, service | backend | all |
| 3 | `admin_users`: routes, `/admin/me` delivery and degrade, ledger entries, contract + integration tests | backend | all |
| 4 | Kit: store, provider inside `AuthProvider`, `useAdminPreference`, status, `usePageSizePreference` over the store | admin | US3 (+ US1) |
| 5 | Kit: legacy carry-over and the SC-004 static test | admin | US3 |
| 6 | Shell: collapsed groups and rail mode on the store; save-failure notice | admin UI | US3 |
| 7 | Shell: pin helpers, Pinned section (expanded, drawer, rail), pin control, visibility matrix, a11y | admin UI | US1, US2 |
| 8 | Shell: pinning from the command palette — `pinTargets`, row control, `Alt+Enter`, in-dialog live region | admin UI | US1 (FR-027) |
| 8b | Shell: reorder | admin UI | US4 |
| 9 | Docs en + pl, changesets, residue and the CI gate run locally (contract + integration trees, the checks in [quickstart.md](./quickstart.md)) | docs / verification | all |

Dependencies: 1 → 2 → 3; 1 → 4 → 5; 4 → 6 → 7 → 8 and 7 → 8b (8 and 8b are independent); the kit's tests stub `apiClient`, so 4–8 do
not wait for 3 except for the by-hand tour; 9 last.

## Risks

| Risk | Mitigation |
| --- | --- |
| Admin tests that seed `AuthProvider` and change a page size now send a `PATCH` instead of writing `localStorage` | A seeded session without `preferences` is *available* with defaults (client contract §1); phase 4 runs the whole admin suite and stubs `apiClient` where a test now writes. |
| `AppShell.tsx` (2113 lines) gets harder to change safely | New UI goes into `components/sidebar/*` and `lib/pinned-entries.ts`; `AppShell` only wires them. The existing `AppShell.*.test.tsx` files run in phases 6–8. |
| StrictMode double-mount runs the carry-over or a write twice | The import is idempotent server-side; the per-key queue coalesces; every kit and shell test renders in `<StrictMode>`. |
| `/admin/me` gains a read of a table absent on a not-yet-migrated database | The read is isolated (`preferences: null`, warn), so sign-in survives; `pnpm run setup` / the migrator apply it. |
| A derived artefact goes stale (migration registry, manifests, lockfile, Polish docs cache) | Phase 2 regenerates in the same commit; phase 9 runs `overlay:check`, `manifests:check`, `check:docs-translations` and `pnpm install --frozen-lockfile`. |
| The palette's `Enter` handler ignores modifiers today, so `Alt+Enter` would also navigate | The `Enter` branch is narrowed to `!e.altKey` in the same change, and `AppShell.palette-pinning.test.tsx` asserts `Alt+Enter` never navigates; the existing palette suites run as regression. |
| Deleting the two legacy constants leaves a test or fixture that seeds them | `grep -rn "b2b-admin.nav\|b2b-admin.page-size" admin packages backend/test` in phase 9, beyond the SC-004 test's own allow-list (AGENTS.md: grep before deleting). |

## Complexity Tracking

No constitution violation and no new dependency of any kind (runtime, dev or workspace). The
one row below is the Principle IX justification for the single net-new UI composite.

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `PinnedSection` (shell composite) | The spec's Pinned section lists references to other sections' rows, with its own pin/unpin/reorder controls and announcements | Rendering pins as a synthetic `NavSection` through the existing loop would duplicate the rows' gating and lose the source-section description, the original's `end` flag and the reorder affordances; every visual part inside it is an existing primitive. |

## Constitution Check — post-design

Re-evaluated after research, data model and contracts: **PASS**. No principle is violated, no
dependency is added, and nothing is left open. The seven readings of the spec in research.md
§ *Readings — owner rulings (2026-10-27)* were accepted by the owner on 2026-10-27: item 1 —
the pin button is one extra Tab stop per sidebar entry (FR-004); item 5 — the palette binding is
`Alt+Enter` (FR-027); item 6 — the palette's missing listbox/option semantics stay out of scope as
a follow-up; the rest stand as written.

## Handoff to `endora-commerce-dev`

- Run `/speckit.tasks` from this plan, then work its phases in order on
  `feat/sidebar-pinned-items`; commit each phase on its own with `git commit -s` and no AI
  trailer. Phases 6–8b are admin UI and may go to `endora-commerce-designer` for copy, focus order,
  the palette chord and touch-target review first.
- Read first: [research.md](./research.md) R-3, R-5, R-6, R-7, R-10, R-15, R-16;
  [contracts/admin-preferences-api.md](./contracts/admin-preferences-api.md);
  [contracts/admin-preferences-client.md](./contracts/admin-preferences-client.md).
- Do not touch `_i18n`'s `PATCH /api/v1/admin/me/preferred-language` or the `preferredLanguage`
  column — the language preference stays where it is (spec *Assumptions*). Do not touch the page
  builder's panel state (spec *Out of scope*).
- After editing any package, rebuild it (`pnpm --filter <pkg> run build`) before running a test
  that imports it; `@endora-commerce/contracts` and the kit are on every admin test's path.
- Merge-request pipelines skip the contract and integration suites (D-198): phase 9 runs them
  locally.
