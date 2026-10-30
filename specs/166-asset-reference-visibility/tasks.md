---
description: "Task list for asset visibility following the records that reference it"
---

# Tasks: Asset visibility follows the records that reference it

**Input**: Design documents from `specs/166-asset-reference-visibility/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution III is non-negotiable.
- In every phase the test tasks come first.
- Run each test and see it fail *for the stated reason* before starting the implementation task that turns it green.
- Record under the task which tests were seen red and why, as 165 did.
- Every new integration file builds the full reader matrix of `quickstart.md` (A, B, S, W, N). The wildcard reader W is the **control**, never the subject: a test that passes only for W proves nothing.

**Organization**: by user story. Phase 2 carries everything every story stands on: the registry's attribution and the batched scanners (R-6), the `readerRestriction` contract (R-2) and its three owner implementations, `AssetVisibility` with the caller classes (R-3) and the owner-off branch (R-4), and the by-id route guard (R-7) with its structural test. US1–US3 are P1; US4 and US5 are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: the task can run in parallel with its neighbours **inside its own phase**: it touches a different file and depends on no unfinished task of that phase.
- **[US#]**: the user story of `spec.md` the task serves. Setup, Foundational and Polish tasks carry none.

## Path conventions

- **The library:** `packages/modules/assets_library/` (written `AL/` below; `AL/backend/` = `AL/src/backend/`):
  - `src/manifest.ts`;
  - `src/backend/index.ts` (composition), `plugin.ts`, `routes.admin.ts`, `services/`;
  - `docs/assets-library/index.md` at the package root.
- **Other modules:** `T/` = `packages/modules/tasks/`, `P/` = `packages/modules/projects/`, `C/` = `packages/modules/crm/`, `X/` = `packages/contracts/src/`. Unrestricted contributors are written out in full (`packages/modules/{catalog,cms,blog,megamenu}/`).
- **Tests:**
  - Unit tests sit beside their subject as `*.test.ts` (`specs/106-module-owned-tests/`).
  - Backend tests: `backend/test/{integration,contract,perf}/assets_library/` and the owners' `backend/test/integration/{tasks,projects,crm}/`.
- **Targeted runs:**
  - `pnpm --filter backend exec vitest run <path>`
  - `pnpm --filter @endora-commerce/mod-assets-library run test` (and `mod-tasks`, `mod-projects`, `mod-crm`, `mod-megamenu`)
  - `pnpm --filter @endora-commerce/contracts run test`

## Standing rules for every task

1. **Read before writing.**
   - Read the routed convention for what you are about to do (`AGENTS.md` § *Where the rest of it lives*). In particular:
     - `module-composition.md` before the manifest edge, the boot hooks and the lazy `permissionService` wiring;
     - `module-activation.md` before the owner-off branch and any contribution hook (item 3: contribution hooks stay probe-free);
     - `release-intent.md` before changesets;
     - `backend-test-suite.md` before running or changing anything in `backend/test/`.
   - Read the prior art the task names: `TaskContextDescriptor` (`P/src/backend/services/task-context-descriptor.ts`) for an ambient-caller contribution; `owner-read-permissions.ts` in each owner for the read check.
2. **Re-derive a premise marked "checked first" or "verify"** in `research.md` from the tree, at the task that names it. Line numbers in `contracts/foreign-module-changes.md` were measured at `4d2c03490`; re-measure them after the T005 merge. Record the finding under the task.
3. **`pnpm run build:packages` before running anything**, and rebuild a package you edited (`pnpm --filter <pkg> run build`) before running tests against it (D-164).
4. **Regenerate generated files, never edit them.** Run `pnpm install --lockfile-only` beside `manifests:generate`, and commit what they render in the same change.
5. **Touch a file outside `packages/modules/assets_library/` only if `contracts/foreign-module-changes.md` lists it.** Otherwise add the line there first, with its reason, in the same commit. T001 names two lines this list is already expected to need.
6. **No port call is wrapped in a `catch`** (`check:port-catches`), and no owner's visibility code is called while that owner is not present (R-4). The library decides presence; owners never probe it in their contribution hooks.
7. **Never run `db:fresh`, `db:reset`, `setup` or `module:*`** against the development database unprefixed. Integration tests use `TEST_DATABASE_URL` on `pnpm run dev:infra:test`; the manual walk uses a separate database.
8. **Commit** in conventional style with `git commit -s` (DCO). Add no `Co-Authored-By` or other AI/LLM trailer. Deliver through a merge request from `166-asset-reference-visibility`, never straight to `master`.
9. **Ledgers.** Update each in the change that needs it:
   - `contracts/foreign-module-changes.md` (rule 5);
   - `backend/test/fixtures/openapi-baseline.json` — no route or schema changes, so a regeneration (`UPDATE_OPENAPI_BASELINE=1`) must render nothing; if it renders anything, stop and report;
   - `backend/test/unit/kernel/module-removal.test.ts` and any other ledger **derived** from a file's location (`AGENTS.md` traps) — nothing is moved or deleted by this plan, so it must stay green untouched;
   - no error code, permission, setting, palette action or migration is added, so `X/errors.ts`, the permission manifests and the migration registries are **not** touched.
10. **Admin tests on Node 26:** none is planned (no UI change), but if a task runs the admin suite (`packages/admin-kit` picker, the library drawer), run it with `NODE_OPTIONS=--no-experimental-webstorage`.
11. **Shell conditions in scripts and Monitor loops use `command grep`**, never the hooked `grep`, whose exit codes for `-q` / `-v` are unreliable.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: re-derive the premises the design rests on, land the additive descriptor contract, and declare the one new dependency edge. Nothing is user-visible yet.

- [X] T001 Re-derive the design's premises from the tree and record each answer under this task. Stop and report if (a), (b) or (c) is "no".
  - (a) F-21: `effectiveState.isPresent(moduleId)` is a synchronous read exported from the published barrel `@endora-commerce/platform/kernel` (not a `host-internal-subpath`; `check:platform-surface`).
  - (b) F-20: `permissionService.listPermissions(adminUserId)` returns `[]` and does not throw for a role-less administrator, and returns `'*'` for the Platform administrator role.
  - (c) R-7: in `AL/src/backend/routes.admin.ts`, a route-level `preHandler` placed after the permission gate runs **before** the replace route's multipart stream is consumed (`request.file()` / `request.parts()` in the handler), so a refused replace stages no bytes.
  - (d) R-2: `check:port-shape` accepts an optional **data property** (`readonly readerRestriction?`) on `AssetReferenceDescriptor`, which is a contribution shape, not a port.
  - (e) R-14 / F-22 and the spec's Edge Case "an owner not part of the deployment": a platform-unavailable or soft-uninstalled owner is still composed and still contributes its descriptor; only an uncomposed package contributes none.
  - (f) **Where the owners' complement tests can run.** `quickstart.md` places them co-located in `T/`, `P/`, `C/`; measured at planning time, no co-located test in those three packages opens a database. If that holds, keep the co-located files for the restriction's wiring (getters resolved per call, the read-permission clause, a `null` condition) and put the SQL complement property in `backend/test/integration/{tasks,projects,crm}/asset-reference-restriction.test.ts`; add those three lines to `contracts/foreign-module-changes.md` §F.
  - (g) **Catalog has no reference-scanner test today** (`command grep -rl asset-references backend/test` finds blog and the kernel seam test only). Add `backend/test/integration/catalog/asset-references.test.ts` to `contracts/foreign-module-changes.md` §E for T011.
  - Done 2026-10-29, measured on `c50adae91`. (a) **Yes**: `effectiveState` is exported from `packages/platform/src/kernel/index.ts:81`, the published `@endora-commerce/platform/kernel` barrel; `isPresent` is the synchronous in-memory read (`lifecycle/effective-state.ts:33`); Tasks already imports it from the same barrel (`T/index.ts:32,187`); `check:platform-surface` clean (4/4 ledgered, 0 violations). (b) **Yes**: `PermissionService.listPermissions` (`admin_roles/…/permission-service.ts`) answers `role?.permissions ?? []` — no throw for a role-less or unknown administrator (only `hasPermission` throws `ADMIN_ROLE_REQUIRED`); the bootstrap role holds `'*'`. (c) **Yes**: `@fastify/multipart` 10.0.0 registers `setMultipart` as the content-type parser, which only flags the request and calls `done()` (`index.js:31-34`); `attachFieldsToBody` is not set (`AL/plugin.ts:155`), so nothing reads the stream before the handler's `req.parts()` — a preHandler runs first. (d) **Yes**: after T003, `check:port-shape` is clean (189 ports, 0 violations) — the descriptor is a contribution shape, not a port. (e) **Yes**: `composeModules` registers every supplied entry without consulting `module_registrations` (`platform/src/kernel/compose.ts:355-375`), and boot hooks run regardless of state. (f) **Holds**: no co-located `*.test.ts` in `T/`, `P/`, `C/` opens a database (the one `postgres` match, `crm/…/demo/demo.test.ts`, is prose). The co-located files carry the wiring; the SQL complement went to `backend/test/integration/{tasks,projects,crm}/asset-reference-restriction.test.ts`, added to `foreign-module-changes.md` §F, and §B–§D's co-located lines now say "wiring". (g) **Holds**: added `backend/test/integration/catalog/asset-references.test.ts` to §E — and `backend/test/integration/blog/asset-references.test.ts`, which T011 names but §E did not list.
- [X] T002 [P] Write failing type-level tests in `X/assets-library.test.ts`:
  - a descriptor returning plain `AssetReference[]` still compiles as an `AssetReferenceDescriptor` (compatibility, `ports.md` §1);
  - a descriptor returning `AssetReferenceHit[]` with `assetId` compiles;
  - a restricted descriptor exposes `readerRestriction.visibleEntityIds`, `assetIdsWithHiddenReferences` and `allReferencedAssetIds` with the `ports.md` §1 signatures;
  - `readerRestriction` is optional and readonly.
  - Red 2026-10-29 as a type error, the only way a type-level test fails here (`pnpm --filter @endora-commerce/contracts run typecheck`): `AssetReferenceHit` / `AssetReferenceReaderRestriction` not exported, `readerRestriction` not on `AssetReferenceDescriptor` (5 errors). `expectTypeOf(...).toExtend` checks the plain-`AssetReference[]` descriptor; a `@ts-expect-error` assignment pins `readonly`.
- [X] T003 Implement the descriptor half of the contract in `X/assets-library.ts` per `contracts/ports.md` §1–§2: `AssetReferenceHit`, `AssetReferenceReaderRestriction`, the optional `AssetReferenceDescriptor.readerRestriction`, `findReferences` returning `AssetReferenceHit[]`, and the doc blocks (who each method answers to; the registry's enumeration policy versus the library's visibility policy). `AssetReadPort.visibleToCaller` is **not** added here: it is required, and lands with its only implementation in T022 so the workspace keeps type-checking. Rebuild `@endora-commerce/contracts`, run `pnpm -r run typecheck`, and record any consumer error under this task (none is expected: the change is additive). T002 green.
  - Done 2026-10-29: `AssetReferenceHit`, `AssetReferenceReaderRestriction`, the optional readonly `readerRestriction`, `findReferences` returning hits, and a paragraph on `AssetReferenceRegistryPort` ("enumeration is not visibility"). The port's own `findReferences` / `findReferencesMany` signatures are unchanged (`AssetReference[]`; the registry class returns hits, a subtype). T002 green (contracts suite 44 → 45 with T012's case). `pnpm run build:packages` exit 0; `pnpm -r run typecheck` exit 0 — **no consumer error**.
- [X] T004 Add `'admin_roles'` to `dependencies` in `AL/src/manifest.ts` (R-3; `admin_roles` is non-deactivatable, so no `whenAbsent` is owed). Run `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only`, and commit what they render. Run `pnpm --filter backend run check:port-dependencies`.
  - Done 2026-10-29. `manifests:generate` and `pnpm install --lockfile-only` rendered **nothing**, after rebuilding `mod-assets-library` and running both again: a module's `dependencies` are not mirrored into its `package.json` (it lists no `mod-*` peer), so `contracts/foreign-module-changes.md` §F's "re-renders the package manifest" does not happen. `check:port-dependencies` clean (0 violations; the edge resolves in T021).

**Checkpoint**: the contract says what a restricted descriptor is, the library may resolve `permissionService`, and the workspace type-checks and builds.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the batched, attributed reference scan (R-6, which also repairs #535), the three owners' `readerRestriction`, the one evaluator `AssetVisibility` (R-3, R-4, R-5's `exclusionFor`, `hiddenAmong`, `visibleReferences`), `assetReadPort.visibleToCaller` (R-13), and the by-id guard (R-7). Every story stands on these.

**⚠️ CRITICAL**: no user-story work begins until this phase's checkpoint is green.

### Tests first

- [X] T005 Merge `origin/master` into `166-asset-reference-visibility` first (`git fetch origin && git merge origin/master`), to pick up the separate #535 hot-fix of `findReferencesMany` (a minimal per-asset fallback). Record under this task the hot-fix's commit, the fallback it added in `AL/src/backend/services/reference-registry.ts`, and its test file. If #535 has not merged yet, record that, continue, and repeat this merge before T013. Then write failing tests in `AL/src/backend/services/reference-registry.test.ts` (extend the hot-fix's file if it chose this path; **keep every hot-fix case unchanged**):
  - `findReferencesMany([x, y])` attributes each tagged hit to its own asset by `hit.assetId`, asking each tagged descriptor **once** for the batch;
  - a descriptor returning untagged hits for a batch of more than one asset is asked once per asset, and only that descriptor;
  - a batch of one asset attributes an untagged hit without a second call;
  - `findReferences` still asks every descriptor whatever its owner's state (F-9, FR-008, FR-011);
  - the registry exposes the descriptors partitioned into restricted and unrestricted for `AssetVisibility`.
  - Red reason expected: the batched one-call assertion (the hot-fix asks per asset) and the partition.
  - **#535 not merged** (`gh pr view 537`: `OPEN`, branch `535-folder-delete-reference-guard`, measured 2026-10-29). Its fallback replaces the body of `findReferencesMany` with `for (const id of assetIds) out.set(id, await this.findReferences(id))` (one sequential round per asset); its tests are `AL/src/backend/services/reference-registry.test.ts` (3 cases, `describe('… (#535)')`) and `backend/test/integration/assets_library/folder-delete-references.test.ts`, plus a changeset. Proceeded without the merge at first; **merged later the same day** (see T013).
  - The new file is the hot-fix's `reference-registry.test.ts` **verbatim** (taken with `git show origin/535-…:…`), with the 166 cases appended in their own `describe`, so the future add/add conflict resolves to this file unchanged.
  - Red 2026-10-29: 7 of 10 — the three #535 cases (F-8: every list empty, the hot-fix is not on the branch), the batched one-call and per-asset-fallback assertions, and `partition` / `referencesOf` (not functions). The three that passed: "a batch of one", "no hit asked once" and `findReferences` asking every descriptor — today's behaviour, kept on purpose.
- [X] T006 [P] Write failing tests in `AL/src/backend/services/asset-visibility.test.ts` with fake descriptors, a fake `effectiveState` and a fake `permissionService` (`quickstart.md` §1, Foundational row):
  - caller classes (R-3): the system actor → unrestricted `system`; an admin whose `listPermissions` contains `*` → unrestricted `wildcard`; any other admin → `admin`; no context, a customer or an API key → `nobody`; `listPermissions` asked at most once per request;
  - FR-001 a: no reference, or only unrestricted ones → visible;
  - FR-001 b: one visible restricted reference among hidden ones → visible; a restricted hidden reference plus an unrestricted one → visible (rescue);
  - owner off (R-4): its references are hidden from `admin` and `nobody`; `visibleEntityIds` and `assetIdsWithHiddenReferences` are **never** called; `exclusionFor` uses `allReferencedAssetIds`; the wildcard still sees the asset;
  - `nobody` sees no restricted record and asks no owner's `visibleEntityIds`;
  - unrestricted callers skip every owner call;
  - `hiddenAmong(ids)` asks each restricted descriptor's `findReferences` once, each present owner's `visibleEntityIds` once, and the unrestricted descriptors only for the pending ids (FR-014);
  - `exclusionFor(where)` asks each restricted descriptor exactly once, returns nothing without a candidate, and scopes candidates by the list's own `where`;
  - `visibleReferences` returns every unrestricted reference plus the visible restricted ones, all of them for an unrestricted caller, and strips `assetId`;
  - invariant I-1: a visible asset with references has at least one visible reference;
  - `assertVisible(id)` throws the shared `assetNotFound(id)` error, byte-identical to the service's missing-row error.
  - Written before T021 and run against it; the red was shown by moving `asset-visibility.ts` aside: the suite does not load (`./asset-visibility.js` missing, 0 tests). 37 cases: R-3 classes (system, wildcard, admin, and nobody for no context / customer / API key / an admin actor without an id), `listPermissions` once per tenant context, FR-001 a/b, cross-owner rescue, owner off (hidden from admin and nobody, owner never asked, `exclusionFor` on `allReferencedAssetIds`, wildcard sees it, presence read per evaluation), nobody, unrestricted callers asking nothing, call counts of `hiddenAmong` and `exclusionFor`, `visibleReferences`, invariant I-1 over four scenarios, and `assertVisible` byte-identical to the missing-row error (status, code, message, details) and passing a non-uuid through untouched.
- [X] T007 [P] Write failing tests for the Tasks restriction: `T/src/backend/services/task-asset-references.test.ts` (wiring: hits carry `assetId`; getters resolved per call, never at boot; without `tasks:read` `visibleEntityIds` is empty and `assetIdsWithHiddenReferences` is every referenced asset; a `null` visibility condition hides nothing) and, per T001 (f), the SQL complement property over seeded rows — private, draft, public, a Project-context Task the caller cannot see, and a row with a NULL `context_id` — asserting `assetIdsWithHiddenReferences()` is the exact complement of `visibleEntityIds` and `allReferencedAssetIds()` is every attached asset (R-16).
  - Co-located `T/…/task-asset-references.test.ts` (8): red 2026-10-29 — hits without `assetId`, no `readerRestriction`. Complement `backend/test/integration/tasks/asset-reference-restriction.test.ts` (5): red against the pre-change build, `registry.partition is not a function`. Seed: public, private, draft, a Task in a `project` context nobody may see, and the no-context public Task — the schema forbids a NULL `context_id` beside a set `context_type` (`CHECK ((context_type IS NULL) = (context_id IS NULL))`), so the NULL row is the no-context one; readers: creator, plain reader, `tasks:see_private`, no `tasks:read`.
- [X] T008 [P] Write failing tests for the Projects restriction in `P/src/backend/services/project-asset-references.test.ts` and, per T001 (f), its complement over seeded Member / Viewer / Organization-reach rows, including a caller without `projects:read`.
  - Co-located (6): red 2026-10-29 — no `assetId`, no restriction. Complement `backend/test/integration/projects/asset-reference-restriction.test.ts` (6): first run failed in `beforeAll` on a fixture error of mine (`visibility = 'members'` is not a value; the check allows `inherit`, `everyone`, `members_and_listed`), fixed, then red on `registry.partition is not a function`. Readers: Member, Viewer, neither, one confined to Organization one, no `projects:read`.
- [X] T009 [P] Write failing tests for the CRM restriction in `C/src/backend/services/crm-asset-references.test.ts` and, per T001 (f), its complement over Opportunities in two Organizations for a caller scoped to one, and a caller without `crm:read` (R-15).
  - Co-located (5): red 2026-10-29 — `opportunityAttachmentReferenceDescriptor is not a function` (it was not exported). Complement `backend/test/integration/crm/asset-reference-restriction.test.ts` (4): red, `registry.partition is not a function`. Two Organizations, a reader reaching all and the same reader confined to the second (`resolveTenantContext` with an allowed set), and one without `crm:read`.
- [X] T010 [P] Write the failing structural test `AL/src/backend/routes.admin.guard.test.ts`: enumerate every admin route of `AL/src/backend/routes.admin.ts` with an `:id` asset parameter (10 today, `contracts/admin-api.md` §1 rows 2–5, 7–11, 13) and fail on any without `requireVisibleAsset` placed after its permission gate; it must also fail on a newly added `:id` route that lacks it (assert against a fixture route list as well as the real file).
  - Red 2026-10-29 (shown by stashing `routes.admin.ts`): `isVisibleAssetGuard` does not exist, every case throws. The test records the routes the module registers into a fake app (no regex over the source), expects exactly the ten `:id` routes, asserts the gate-then-guard order, asserts no other route carries the guard, and runs the checker over fixtures: an unguarded new `:id` route, a reversed chain, a guard without a gate, a folder route.
- [X] T011 [P] Write failing two-asset attribution cases in the unrestricted contributors' existing tests (R-6): `backend/test/integration/assets_library/cms-body-scan.test.ts` (cms), `backend/test/integration/blog/asset-references.test.ts` (both blog descriptors), `packages/modules/megamenu/src/backend/services/contributed-reference-scanners.test.ts` (megamenu), `backend/test/integration/{cms,blog}/asset-reference-while-off.test.ts` (attribution while off), and the new `backend/test/integration/catalog/asset-references.test.ts` (all five catalog descriptors, T001 (g)). Each asserts that a batch of two assets returns hits tagged with the right `assetId` and that the jsonpath descriptors issue **one** statement per batch (count queries on the connection).
  - Red 2026-10-29 with the four scanner files stashed: megamenu (statement does not select the asset id); `cms-body-scan` 6 statements for 3 ids, expected 1; `blog/asset-references` 10, expected 2; `cms/…-while-off` 4, expected 1; `blog/…-while-off` 5, expected 2; catalog 22, expected 5, and no hit tagged. Statements are counted with a `Proxy` over the EntityManager the descriptor is handed (`execute` calls). `cms-body-scan` and the catalog file timed out in `setupBackendServer` on the first, shared run (load) and were re-run alone with `--hookTimeout=180000` before being read as red.
- [X] T012 [P] Write failing tests for `visibleToCaller` in `AL/src/backend/services/asset-read-port.test.ts`: hidden and missing ids are absent alike, a non-uuid is absent, the system actor and the wildcard get every existing id, one evaluation per call whatever the batch size; and a type-level assertion in `X/assets-library.test.ts` that `AssetReadPort` declares `visibleToCaller` as a required method.
  - Red 2026-10-29 (shown by stashing `asset-read-port.ts`): `visibleToCaller` is not a function, 5 cases; the type-level case in `X/assets-library.test.ts` was a type error until T022. The constructor takes the evaluator as its **third**, required argument (before the optional retention reader); the two existing harnesses in `asset-read-port.test.ts` pass a `NO_VISIBILITY` stub that throws if asked.

### Attribution and batching (R-6)

- [X] T013 Repair the registry in `AL/src/backend/services/reference-registry.ts`, **replacing the #535 hot-fix's per-asset fallback** (re-merge `origin/master` first if T005 recorded it as unmerged): attribute by `hit.assetId`; fall back to one call per asset only for a descriptor that returned an untagged hit in a batch of more than one; drop `__assetId`; expose the restricted/unrestricted partition. The hot-fix's test stays and stays green. T005 green.
  - Done 2026-10-29 **without** the #535 merge (still open). `findReferencesMany` attributes by `hit.assetId` through a new `referencesOf(descriptor, ids)` — one call per descriptor; a batch of one attributes without a second call; a descriptor that returned any untagged hit in a larger batch is re-asked per asset, and only it. `__assetId` is gone; `partition()` exposes restricted / unrestricted in registration order. The hot-fix's three cases are green on this implementation. T005 green (10/10).
  - **#537 merged** (`e91d55a8b`; the hot-fix commit is `308188212`, *fix(assets_library): a folder delete refuses assets still in use*). `git merge refs/remotes/origin/master` → merge commit `1b4f02823`. Conflicts exactly as foreseen: `reference-registry.ts` (content) resolved to this branch's batched attribution, which **replaces** the hot-fix's sequential per-asset `findReferencesMany`; `reference-registry.test.ts` (add/add) resolved to this branch's file, whose first part was checked byte-identical to the merged hot-fix file (its 3 cases unchanged). `folder-delete-references.test.ts` and `.changeset/assets-library-folder-delete-references.md` came in unchanged. After the merge: registry tests 10/10; `folder-delete-references.test.ts` + `admin-folders.contract.test.ts` 9/9 green against a rebuilt `mod-assets-library`. `manifests:generate` and `pnpm install --lockfile-only` rendered nothing; `composer:generate` re-rendered `docs/docs/module-reference/assets-library.md` (the T004 `admin_roles` row, missed at T004 because only `manifests:generate` was run), committed as `12a12a0c7`.
- [X] T014 [P] Tag every hit with `assetId` in all five catalog descriptors and make the category-content descriptor (the per-asset loop, ~163-185) one jsonpath statement over the batch returning the matched id, in `packages/modules/catalog/src/backend/services/asset-references.ts`. T011 catalog cases green.
  - Done 2026-10-29. The four column descriptors select and tag `asset_id`. Category content is one statement: `cross join lateral jsonb_path_query(c.content, 'strict $.**')`, string values matched with `= any(?::text[])` against one Postgres array literal of the asked ids (hex and dash only), `distinct`. Probed first that `strict $.**` visits every level including nested array elements, as the old lax `$.** ? (@ == "id")` did. A document is now walked once per statement however many ids are asked (the old loop was one recursive scan per id). T011 catalog cases green.
- [X] T015 [P] Tag hits and make the per-asset loop (~43-74) one statement in `packages/modules/cms/src/backend/services/asset-references.ts`. T011 cms cases green.
  - Done 2026-10-29: one statement over `cms_pages.content`, `share_image_asset_id`, `cms_blocks.content`, `cms_templates.content`, with an `asked` CTE; the same string-value match as T014. The header comment's "wildcard-key match" sentence was corrected (it matches any string value, as before). T011 cms cases green.
- [X] T016 [P] Tag hits on both descriptors and make the content loop (~78-108) one statement in `packages/modules/blog/src/backend/services/blog-asset-references.ts`. T011 blog cases green.
  - Done 2026-10-29: main-image descriptor tags `main_image_asset_id`; the content descriptor is one statement over posts and category descriptions, as T015. The file header's GIN-index sentence was replaced — `jsonb_path_exists()` never used that index (only the `@?` operator can). T011 blog cases green.
- [X] T017 [P] Tag hits in `packages/modules/megamenu/src/backend/services/asset-references.ts`. T011 megamenu case green.
  - Done 2026-10-29: two `union`ed selects (`assetId` and `iconAssetId`), each returning the matched field as `asset_id`; `union` keeps an item whose two fields name the same asset to one hit, as before. T011 megamenu case green.

### Owners' `readerRestriction` (R-2, R-15)

- [X] T018 [P] Tasks: add `TASKS_READ_PERMISSION` and its check (the existing `createOwnerReadCheck` shape, wildcard included) in `T/src/backend/services/owner-read-permissions.ts`; in `T/src/backend/services/task-asset-references.ts` tag hits with `assetId` and add `readerRestriction` over `TaskAccess.visibleIds`, `TaskVisibility.condition('t')` written `(…) is not true`, and `select distinct asset_id from task_attachments`; take the dependencies as getters; pass the getters from the asset-reference boot hook in `T/src/backend/index.ts` (still contribution-only, no presence probe). T007 green.
  - Done 2026-10-29. `TASKS_READ_PERMISSION` added beside the existing checks (the existing `createOwnerReadCheck` is reused; it already accepts the wildcard). `readerRestriction`: `visibleEntityIds` → `tasks:read`, then `TaskAccess.visibleIds`; hidden set → without `tasks:read` the all-referenced statement, else `condition('t')` written `(…) is not true`, `[]` for a `null` condition; `allReferencedAssetIds` plain SQL. The boot hook passes getters (`ctx.cradle().tasksAccess` / `tasksVisibility`) and a lazy `permissionService`; still no presence probe. T007 green (8 + 5).
  - **Derived ledger moved:** `T/src/backend/task-visibility-seam.test.ts`'s `RULE_SCOPED_READ_LEDGER` for this file went 2 → 5 (measured by the test, not computed), and its reason in `T/services/task-access.ts` (`TASK_ACCESS_READERS`) now names the restriction. Both files added to `foreign-module-changes.md` §B first.
- [X] T019 [P] Projects: tag hits and add `readerRestriction` over `ProjectAccess.visibleIds` / `visibleProjectSql` with `canRead` in `P/src/backend/services/project-asset-references.ts`; pass the getters from the boot hook in `P/src/backend/index.ts`. T008 green.
  - Done 2026-10-29. `visibleEntityIds` → `ProjectAccess.visibleIds` (already none without `projects:read`); hidden set → `currentViewer()`, the all-referenced statement when `!canRead`, else `visibleProjectSql(viewer)` written `(…) is not true`, `[]` when `null`. Getter from the boot hook. T008 green (6 + 6). Same derived ledger as T018: `P/src/backend/project-access-seam.test.ts` 2 → 5 and the reason in `P/services/project-access.ts`, added to §C.
- [X] T020 [P] CRM: add the `crm:read` check in `C/src/backend/services/owner-read-permissions.ts`; tag hits and add `readerRestriction` over the scoped EntityManager (`CrmOpportunity`, Organization reach; two statements for `assetIdsWithHiddenReferences`) in `C/src/backend/services/crm-asset-references.ts`; pass the getters from the boot hook in `C/src/backend/index.ts`. T009 green.
  - Done 2026-10-29. `CRM_READ_PERMISSION` added; the check is the module's existing `createOwnerReadCheck` (which answers `true` for a caller with no administrator — never asked by the library for such a caller). `visibleEntityIds` → `crm:read`, then `emFactory().find(CrmOpportunity, { id: { $in } }, { fields: ['id'] })` on the scoped EntityManager; hidden set → two statements (the raw `(asset_id, opportunity_id)` pairs, then one scoped `find`); `opportunityAttachmentReferenceDescriptor` is now exported for its test. T009 green (5 + 4).

### The evaluator, the port method and the guard (R-3, R-4, R-7, R-13)

- [X] T021 Implement `AssetVisibility` in `AL/src/backend/services/asset-visibility.ts` per `data-model.md` §2: `caller()` (system / wildcard via `permissionService.listPermissions` / admin / nobody, memoised per request), the owner-off branch via `effectiveState.isPresent` read per evaluation, `hiddenAmong`, `exclusionFor`, `visibleReferences`, `assertVisible`, and the shared `assetNotFound(id)` helper that `AL/src/backend/services/assets-library.service.ts` and `AL/src/backend/services/asset-replace.ts` now throw through. Construct it in `AL/src/backend/plugin.ts` and resolve `permissionService` lazily in `AL/src/backend/index.ts`. Never catch `ModuleDisabledError`. T006 green.
  - Done 2026-10-29. `caller()` memoises per tenant-context object (`WeakMap`), which is per request and also covers `assetReadPort`, which has no request object — so the guard does not store a caller on the request; R-3's "at most once per request" holds without it. `hiddenAmong` asks each restricted descriptor once through `registry.referencesOf`, present owners once, and the unrestricted descriptors only for the pending ids. `exclusionFor(scope)` takes the list's scoping statement as a callback (US1 supplies it). `visibleReferences(assetId)` asks the descriptors itself (it needs to know which hit is restricted). `assertVisible` passes a non-uuid id through to the service unchanged (the restricted descriptors' `in (?)` over a uuid column would otherwise answer a 500 where the service answers today). `assetNotFound(id)` now backs the 9 throws of `assets-library.service.ts` and 4 of `asset-replace.ts`. Wiring: `plugin.ts` constructs it from two new **required** options, `isModulePresent` and `permissions`; `index.ts` passes `effectiveState.isPresent` and a lazy `permissionService`; `soft-delete-retention.test.ts` passes stubs. Nothing catches `ModuleDisabledError` (`check:port-catches` clean). T006 green (37).
- [X] T022 Add the required `AssetReadPort.visibleToCaller` to `X/assets-library.ts` (`ports.md` §3) and implement it in `AL/src/backend/services/asset-read-port.ts` over `AssetVisibility` (existing ids only; uuid check first); pass `AssetVisibility` into `AssetReadService` from `AL/src/backend/index.ts`. Rebuild `contracts`, run `pnpm -r run typecheck` (test doubles cast or `Pick` the port, `ports.md` §3; record any that do not). T012 green.
  - Done 2026-10-29: `AssetReadPort.visibleToCaller` (required) with its doc block; `AssetReadService.visibleToCaller` = uuid filter, one `find` of the existing ids, one `hiddenAmong`. `pnpm -r run typecheck` after it: **no consumer error** — no test double in another module implements the port in full. T012 green.
- [X] T023 Implement the `requireVisibleAsset` preHandler in `AL/src/backend/routes.admin.ts` per R-7 (classify and store the caller on the request; restricted descriptors' `findReferences([id])` issued whether or not the row exists; present owners' `visibleEntityIds`; rescue; `assetNotFound(id)`), and attach it after the permission gate on the 10 `:id` routes, before any body or multipart read. T010 green.
  - Done 2026-10-29: `requireVisibleAsset` (tagged with a module-private symbol; `isVisibleAssetGuard` exported for the structural test) appended after `requireAdmin(...)` on the ten `:id` routes as `preHandler: [gate, guard]`. No body or multipart read precedes it (T001 (c)). T010 green (6).
- [X] T024 Foundational gate. Run `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, T005–T012 and the existing reference tests named in T011 (green before and after), `pnpm --filter backend run check:port-shape`, `check:port-catches`, `check:port-dependencies`, `check:entry-presence`, `check:module-boundary`. `command grep -rn 'findReferencesMany\|__assetId' backend/test packages/modules --include='*.ts'` and fix any assertion that encoded the empty answer. Record results under this task.
  - Done 2026-10-29, on the tree after the #537 merge, results below in the Phase 2 gate block. The sweep `command grep -rn 'findReferencesMany\|__assetId' backend/test packages/modules --include='*.ts'` finds no test encoding the old empty answer and no `__assetId`; what **did** encode the old shape was three exact `toEqual`s on `findReferences` in `backend/test/integration/{tasks,projects,crm}/attachments.test.ts` (hits now carry `assetId`) — fixed in the owners' commit, those files being on the ledger (§F).

**Checkpoint**: references are attributed in one call per descriptor, the three owners answer the visibility question, `AssetVisibility` decides it for every caller class with owners on or off, and every by-id route is guarded. US1, US2 and US4 can now start.

**Phase 2 gate** (2026-10-29, branch at `12a12a0c7` + this note; `origin/master` `e91d55a8b` merged):
- `pnpm run build:packages`: exit 0. `pnpm -r run typecheck`: exit 0, 0 errors. `pnpm -r run lint`: exit 0 (warnings only, all pre-existing React-hook / eslint-directive warnings in admin files of `catalog`, `blog`, `megamenu`).
- Co-located suites: `contracts` 84 files / 1 807 tests; `mod-assets-library` 23 / 385; `mod-tasks` 170; `mod-projects` 257; `mod-crm` 430; `mod-megamenu` 23; `mod-catalog` 348; `mod-cms` 329; `mod-blog` 22 — all green.
- Backend targeted (`TEST_DATABASE_URL` on `postgres-test` 5441): T011's five files + the three complement files 8 files / 32 tests green; `test/integration/assets_library` + `test/contract/assets_library` + `{tasks,projects,crm}/attachments` + `tasks/off-state` + `blog/reference-protection` + `unit/kernel/contribution-seams`: 34 files, 255 green and 4 red on the `findReferences` shape (fixed, then the three attachment files 32/32 green); after the merge `folder-delete-references.test.ts` + `admin-folders.contract.test.ts` 9/9.
- `test:unit:fast`: first run, under a load average of ~30 with a typecheck, a lint, an integration run and the merge in flight, 11 files / 14 tests red — 13 `Test timed out` in whole-tree scans and one cycle-warning assertion in the same file as a timed-out case. Re-run at load ~10: **364 / 365 files, 7 840 / 7 841 tests**; the one red (`check-module-boundary.test.ts`, "has every cross-module reach ledgered", 30 s timeout) is green alone with `--testTimeout=400000` (154/154). `test/unit/kernel/module-removal.test.ts` green untouched.
- Checks: `check:port-shape` (0 violations), `check:port-catches` (0), `check:port-dependencies` (0), `check:entry-presence` (0), `check:module-boundary` (0), `check:platform-surface` (0), `check:off-state-coverage` (41/41 proven), `check:action-route-permissions` (0), `check:naming`, `check:language` — all clean.
- **OpenAPI baseline: red, not this feature's.** `UPDATE_OPENAPI_BASELINE=1` rendered 102 added lines, every one under nine **catalog** paths from `master` (`…/attributes/{idOrKey}/scope-change-preview`, `…/products/{id}/{archive,restore,scope-overview,scopes,url-keys}`, `…/url-redirects/{redirectId}`, `…/gallery/channel-roles`, `GET /api/v1/catalog/products/resolve/{key}`) — no asset route. The fixture was **not** re-recorded (reverted); the test without the flag fails on the same nine paths. Same class as open issue #398 (which still names only the feedback route).
- No file moved or deleted (`git diff --diff-filter=DR origin/master...HEAD` empty), so no path to grep for.


---

## Phase 3: User Story 1 — Files of records I cannot see stay hidden in the library (Priority: P1) 🎯 MVP

**Goal**: a file used only by records the reader may not see is absent from the list, search and picker, answers every by-id route exactly as a missing file, is skipped by move-many, never named by a permalink conflict, and cannot be attached to another record (FR-004, FR-005, FR-006, FR-012).

**Independent Test**: `quickstart.md` §1, US1 rows. As B, a file on A's private Task is absent from `GET /assets` (root, `q=`, `includeDeleted`, the picker's query) and every by-id route of `contracts/admin-api.md` §1 answers for it exactly as for a random uuid (status, `code`, `message`, body), per restricted kind; A, S (private Task) and W see it; B's attach-existing is refused with the missing-file 422.

### Tests first

- [X] T025 [US1] Write the failing integration test `backend/test/integration/assets_library/reference-visibility.test.ts`, US1 block, with the reader matrix A, B, S, W, N built in the file:
  - per hidden kind — private Task, draft Task (S does not see it either), Task in Project P1's context, P1 attachment, O1 Opportunity (B reaches O2 only), and reader N for all of them;
  - `GET /assets` root folder, `q=` the file's name, `includeDeleted=true`, and the picker's query: the file is absent, pages stay full and `nextCursor` never lands on a hidden row only;
  - **not-found identity**, table-driven over `admin-api.md` §1 rows 2–5, 7–11, 13: hidden id versus random uuid, equal status, `code`, `message` and body;
  - replace of a hidden id stages no bytes (storage untouched);
  - move-many with a hidden id: skipped like a missing id (`movedCount`, the audit row's `assetIds`, the file's folder unchanged);
  - a permalink conflict whose holder is hidden answers `details.assetId: null`;
  - A, S (private Task only) and W see and use the file.
  - Red reason expected: list, move-many and permalink cases (the guard rows may already be green after T023; record which).
  - Written 2026-10-29: `backend/test/integration/assets_library/reference-visibility.test.ts`, one top-level `describe` that builds the matrix (A plain admin with every read/write + `tasks:see_private`, member of P1, all Organizations; B a `sales_representative` confined to O2 = `OTHER_TEST_ORGANIZATION_ID`; S a plain admin with B's codes + `tasks:see_private`; W the harness administrator; N `assets.read/write`) and a nested `US1` block that Phase 4/5 blocks can sit beside. Ten root-folder files, the restricted ones attached in SQL: private Task, draft, a Task in P1's context, a P1 attachment, an O1 Opportunity attachment, a soft-deleted and an image file on the private Task, plus three visible controls (unused PDF, unused PNG, a public Task's file). Lists are paged at 2 and 3 and compared with W's list minus the reader's hidden files (items and order; every page but the last full).
  - Red 2026-10-29 (against `a18019521` + the T023 guard), 11 of 20: the root list for B, S and N (B got 9 rows, expected 3), `q=` for B, S, N, `includeDeleted` for B and N, the picker query, move-many (`movedCount` 2, expected 1 — first seen red on a fixture error of mine, a folder created without `parentId`; fixed and shown red for the stated reason by removing the skip locally, never committed) and the permalink conflict (`assetId` named the hidden holder). **Already green, as Phase 2 foresaw:** every by-id row of `admin-api.md` §1 (2–5, 7–11, 13) for all five kinds and every reader that may not see them — status, `code`, `message` and body equal to a random uuid's once the id and `requestId` are taken out — replace staging nothing (store directory and `asset_object_cleanups` unchanged), and A / S / W seeing and using the files.
- [X] T026 [P] [US1] Extend `backend/test/integration/tasks/attachments.test.ts` with the FR-006 cases: as B, attaching to B's own Task a file hidden by **another** module's record (a P1 attachment) and a hidden **public** file are both refused with the missing-file `422 VALIDATION_FAILED` sentence, before the private-file and active-content refusals.
  - Red 2026-10-29: the private file attached (201), the public one answered the private-file sentence instead of the missing-file one. The hiding record is a members-only Project (another module), seen through a reader holding `projects:read`, so the hiding is membership, not a missing code. The control: the Platform administrator attaches the private one (201) and gets the private-file refusal, not the missing-file one, for the public one.
- [X] T027 [P] [US1] Extend `backend/test/integration/projects/attachments.test.ts` with the same FR-006 cases for B's own Project.
  - Red 2026-10-29 as T026. The hiding record is a private Task of the harness administrator, read by somebody holding `tasks:read` without `tasks:see_private`.
- [X] T028 [P] [US1] Extend `backend/test/integration/crm/attachments.test.ts` with the same FR-006 cases for B's own Opportunity.
  - Red 2026-10-29 as T026, for a sales representative reaching the Opportunity's Organization; hiding record a private Task, as T027.

### Implementation

- [X] T029 [US1] Narrow the list in SQL (R-5): `listAssets` in `AL/src/backend/services/assets-library.service.ts` takes the caller and adds `id <> all(?::uuid[])` from `AssetVisibility.exclusionFor(where)` for a restricted caller, `includeDeleted` included; `GET /assets` in `AL/src/backend/routes.admin.ts` passes the caller the guard stored (or classifies it). Unrestricted callers run today's query unchanged.
  - Done 2026-10-29. `AssetsLibraryService` takes `visibility: Pick<AssetVisibility, 'exclusionFor' | 'hiddenAmong'>` as a **required** dependency (`plugin.ts` passes the one evaluator). `listAssets` asks `exclusionFor` with a scope callback that runs the list's own clauses plus `id in (candidates)` on a fork, `fields: ['id']`, and adds `{ id: { $nin: hidden } }` before paging; `includeDeleted` included, because the clauses are the list's. **Deviation:** the caller is not passed in — `exclusionFor` classifies the ambient caller itself, memoised per tenant context (T021), so the route is unchanged; an unrestricted caller gets `[]` with no read and the query is today's (unit case). The exclusion is written `not in (…)` through the ORM rather than `<> all(?::uuid[])`; T049 measures it. The four tests constructing the service directly (`{cms,blog}/asset-reference-while-off`, `{projects,crm}/attachments`) pass an `AssetVisibility` over their own registry for the system actor — ledger line added to `foreign-module-changes.md` §F. Unit cases in the new `AL/…/services/assets-library-reader.test.ts` (5; 3 red against the old service).
- [X] T030 [US1] Skip hidden ids in `moveMany` in `AL/src/backend/services/assets-library.service.ts` (R-9): load the ids, drop those `hiddenAmong` returns, move the rest; `movedCount` and the audit row's `assetIds` count only what moved.
  - Done 2026-10-29: the found rows are filtered through one `hiddenAmong` call; `movedCount` and the audit row's `assetIds` are what moved. T025's move-many case green.
- [X] T031 [US1] Redact a hidden permalink holder (R-11) in the permalink refusal of `AL/src/backend/services/assets-library.service.ts`: `details.assetId` is `null` when the holder is hidden from the caller; status, code, message and `details.permalink` unchanged.
  - Done 2026-10-29: `#nameableHolder(id)` — one `hiddenAmong([holder])` — backs both `ASSET_PERMALINK_TAKEN` throws (the pre-check and the unique-violation branch). Status, code, message and `details.permalink` unchanged; a holder the caller sees is still named (A in T025).
- [X] T032 [P] [US1] In `T/src/backend/services/attachment-service.ts`, `add()` asks `assets.visibleToCaller([assetId])` right after `findById(…, { liveOnly: true })`, before `#refuseAFileHeldOutOfSight`, the private-file and the active-content refusals; absent → `fileUnavailable()`. Widen the `assets` dependency type. T026 green.
  - Done 2026-10-29: one line after `findById`, before `#refuseAFileHeldOutOfSight`. The `assets` dependency is already the full `AssetReadPort` (`visibleToCaller` became required in T022), so there was no type to widen. No new read of the `tasks` table, so the seam ledger did not move (`mod-tasks` 170/170). T026 green.
- [X] T033 [P] [US1] The same in `P/src/backend/services/attachment-service.ts`. T027 green.
  - Done 2026-10-29, as T032 (`mod-projects` 257/257, seam ledger unchanged). T027 green.
- [X] T034 [P] [US1] The same in `C/src/backend/services/opportunity-attachment-service.ts`, before `#refuseAFileHeldOutOfReach`. T028 green.
  - Done 2026-10-29, as T032, before `#refuseAFileHeldOutOfReach` (`mod-crm` 430/430). T028 green.
- [X] T035 [US1] US1 gate: T025–T028 green; the existing `backend/test/contract/assets_library/` suite green unchanged (for its full-permission readers nothing changes); `pnpm --filter @endora-commerce/mod-assets-library run test`. Record under this task.
  - Done 2026-10-29: T025–T028 green (`reference-visibility.test.ts` 20/20; the three `attachments.test.ts` 2 new cases each; with the two `asset-reference-while-off` files 6 files / 64 tests). `test/contract/assets_library` + `test/integration/assets_library`: 30 files / 181 tests green, unchanged. `mod-assets-library` 24 files / 390 tests (the new `assets-library-reader.test.ts` included); `mod-tasks` 170, `mod-projects` 257, `mod-crm` 430 — the seam ledgers did not move.

**Checkpoint**: issue #513's leak is closed for files of records the reader cannot see. The "used by" list of a *visible* file still names hidden records until US3.

**Phase 3 gate** (2026-10-29, on `3d283a615` + this note):
- `pnpm run build:packages` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (no warning in a touched file).
- Backend targeted (`TEST_DATABASE_URL` on `postgres-test` 5441): the US1 files above, and every other test that attaches an existing file through an owner's route or reads the restrictions — `contract/crm/{attachments,attachment-upload}`, `integration/crm/{attachment-upload,audit-coverage,history,off-state,tab-counts}`, `integration/{projects,tasks}/off-state`, `integration/tasks/draft-private`, `contract/admin_users/permissionless-admin-routes.runtime`, the three `asset-reference-restriction` files: 15 files / 166 tests green.
- `test:unit:fast`: 360 / 365 files, 7 834 / 7 841 tests at load ~30. Six red were load (`Test timed out` in whole-tree scans: `module-package-manifest` ×2, `package-peer-coherence`, `check-module-boundary`, and `migration-order-boot-warning`'s timeout plus its cycle-warning case); **one was mine**: `check-fixture-substitution` flagged a defaulted read (`rows[0]?.n ?? 0`) in the new `reference-visibility.test.ts` — fixed (a missing row throws). The five files re-run alone with `--testTimeout=400000`: 5 / 5 files, 309 / 309 tests.
- Checks: `check:naming`, `check:language`, `check:port-dependencies` (0), `check:off-state-coverage` (41/41), `check:module-boundary` (0), `check:action-route-permissions` (0), `check:port-catches` (0), `check:port-shape` (0), `check:entry-presence` (0) — all clean.
- OpenAPI baseline: not run — no route, schema or response shape changed in this phase (still red on master's nine catalog paths, #398).
- No file moved or deleted.

---

## Phase 4: User Story 2 — Shared files and files uploaded straight to the library keep working (Priority: P1)

**Goal**: unrestricted kinds, unused uploads and multi-referenced files stay exactly as visible as today (FR-001, FR-003, FR-013, SC-002).

**Independent Test**: `quickstart.md` §1, US2 row. B's and W's lists, `nextCursor` and details are equal for product gallery, category, CMS, blog and megamenu images and an unused upload; a file used by A's private Task and a product, and a file used by a Task B sees and one B does not, are visible to B.

### Tests first

- [X] T036 [US2] Write the US2 block (*unrestricted kinds*) of `backend/test/integration/assets_library/reference-visibility.test.ts`:
  - product gallery, category content, CMS, blog and megamenu images and an unused upload: B's and W's lists (items and order), `nextCursor` and details are equal, in the root folder and in a product-image folder;
  - rescue: a file used by A's private Task **and** a product is visible to B on the list, the detail, the URL and every by-id route;
  - a file used by two Tasks, one B sees and one B does not, is visible to B;
  - the shared picker's query returns the same set to B and W for unrestricted content.
  - Expected: green on first run if Phase 2 is right; a case seen red names a defect in the rescue step. Prove each case measures something by showing it red against a deliberately broken rescue (comment out the step locally, never committed) and record that.
  - Written 2026-10-29 as a sibling `describe` of US1. Fixtures are uploaded through `POST /assets` as W (real bytes, public, names `rvs-<run>-…` so US1's `q=rv-<run>` never matches them) and referenced in each contributor's own table: a gallery item, category content, a CMS page body (wire kind `cms_body_embed`), a blog post main image, a megamenu item; plus an unused upload and a rescued file (A's private Task + a product) — one set in the root folder, one in a product-image folder G; and a root file of two Tasks (the open one B sees, A's private one). A top-level W control asserts each file's kind. Shared helpers (`hiddenListFor`, `reader`, `BY_ID_ROUTES`) moved from the US1 block to the top level, unchanged. Cases: B's detail equals W's byte for byte for the five kinds and the unused upload (root and G); B's root list = W's minus US1's hidden set at limits 2 and 3, every US2 file present; G's pages equal W's page by page (`data` and `nextCursor`) at limits 2, 3, 50; the picker query (`mime=image/`) at root and in G; rescue on list, detail, URL and every by-id route (none answers the missing-file answer); two Tasks visible to B and — the control — 404 for N, who reads no Task.
  - **Green on first run** (11/11 with US1's 20, after one fixture fix: the CMS kind on the wire is `cms_body_embed`, not the SQL's `cms_page`). Shown red against three deliberate breaks of `hiddenAmong`, each built into `mod-assets-library`'s dist and run with `-t US2`, the source restored from a copy and rebuilt after (never committed): **R** (no rescue) — 7 red: root list, G pages ×3, picker, rescue list/detail/URL, rescue by-id; **V** (the visible-restricted step dropped) — 3 red: root list, picker, two Tasks; **O** ("hidden unless a restricted reference is visible", over-hiding) — 9 red: both detail-equality cases, root list, G pages ×3, picker, both rescue cases. Every non-control case is red under at least one.

### Implementation

- [X] T037 [US2] No new code is planned. If T036 finds a defect, fix it in `AL/src/backend/services/asset-visibility.ts` (rescue step or partition) with its unit case added to `AL/src/backend/services/asset-visibility.test.ts` first, and record it under this task.
  - Done 2026-10-29: no defect found, no production code changed.

**Checkpoint**: everyday content work is unchanged for every library reader.

**Phase 4 gate** (2026-10-29, on `01c822cbf` + the US2 block; only the test file changed):
- `pnpm --filter backend run typecheck` exit 0; `eslint` on the test file exit 0.
- `reference-visibility.test.ts` (31: US1 20 + US2 11) and `test/unit/scripts/check-fixture-substitution.test.ts`: 2 files / 59 tests green (`TEST_DATABASE_URL` on `postgres-test` 5441, `b2b_test`).
- `check:naming`, `check:language` clean. No production code, route, schema, package or generated file changed, so `build:packages`, the package suites and the module checks are unaffected; they run in the Phase 5 gate. No file moved or deleted.

---

## Phase 5: User Story 3 — The "used by" list shows only what I may see (Priority: P1)

**Goal**: a visible file's references list only the records the reader may see; hidden ones are neither named nor counted (FR-007).

**Independent Test**: `quickstart.md` §1, US3 row. For a file used by a product and A's private Task, B's detail lists the product only; A's and W's list both.

### Tests first

- [X] T038 [US3] Write the *used by* block of `backend/test/integration/assets_library/reference-visibility.test.ts`:
  - `GET /assets/:id`: B sees the product only, A and W see both, and no response carries `assetId` on a reference;
  - the detail every mutating by-id route returns (rename via `PATCH`, move, replace, previous-version restore, permalink set and remove, restore) is filtered the same way for B;
  - the same for a Project and an Opportunity reference alongside a CMS embed.
  - Written 2026-10-29 as the `US3` sibling block. Files uploaded as W (real bytes, so replace and previous-version restore run): F (a product gallery + A's private Task), FP (P1 attachment + a CMS page body embed), FO (O1 Opportunity attachment + a CMS embed). Cases: F's detail per reader (B and N the product only; A, S, W both); B's detail from PATCH rename, move, replace, previous-version restore (versions from the replace's answer), permalink set, permalink remove and restore — each the product only — with W still seeing both after; FP and FO per reader (B, N: the CMS page; S: the Opportunity but not P1; A, W: both). Every reference on the wire has exactly `entityId`, `kind`, `label`. References are compared sorted (`kind:entityId`).
  - Red 2026-10-29, 3/3, for the stated reason: B got both references (`expected [ …(2) ] to deeply equal [ Array(1) ]`) on the detail, on the first mutating route (PATCH) and on FP. Also red, the new unit cases: `assets-library-reader.test.ts` (the detail did not ask `visibleReferences`), `asset-visibility.test.ts` (order — see T039) and `reference-registry.test.ts` (`inRegistrationOrder` missing; shown by stashing the method, written ahead of its test).

### Implementation

- [X] T039 [US3] Filter `detail()` in `AL/src/backend/services/assets-library.service.ts` through `AssetVisibility.visibleReferences` for the caller, and strip `assetId` from the wire; make every route that returns a detail (`AL/src/backend/routes.admin.ts`, and the replace and previous-version paths in `AL/src/backend/services/asset-replace.ts`) return it through the same call. T038 green.
  - Done 2026-10-29. `detail()` takes its references from `visibility.visibleReferences(a.id)` (the service's `visibility` dependency widens to include it); every route answering a detail — upload, read, PATCH, move, restore, permalink set/remove, replace and previous-version restore (both `asset-replace.ts` paths already return through `service.detail`) — goes through it, so `asset-replace.ts` and `routes.admin.ts` needed no change. `assetId` no longer reaches the wire (before this, `findReferences`' hits since T013 carried it: no response schema strips it).
  - **Deviation (small, inside the library):** `visibleReferences` returned unrestricted references first, then restricted ones; it now walks the descriptors in registration order through a new `AssetReferenceRegistry.inRegistrationOrder()`, so a reader who sees every reference (A, W, the system) gets today's list in today's order. Unit cases: registry order, and interleaved order for an admin and the wildcard.
  - Other modules that call `assetsLibraryPort.getAsset` (Tasks / Projects / CRM attachment URLs, invoices, settings, cms embeds, pwa) now get the caller's list: a customer or API-key context sees no restricted reference; an admin's call asks each present restricted owner's `visibleEntityIds` once per detail. None of them reads `references` (they read `url`). T049 should measure the attachment-list paths too.
  - `assets-library-url.test.ts`'s unrestricted stub gained `visibleReferences: async () => []` (its registry is empty). OpenAPI: no schema change — the baseline test is red only on master's catalog paths (#398), no asset path. T038 green (34/34 in the file).

**Checkpoint**: all P1 stories hold. No record's number or existence leaks through the library for a restricted reader.

**Phase 5 gate** (2026-10-29, on `6260f8ab1`):
- `pnpm run build:packages` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (no warning in a touched file).
- `mod-assets-library` 24 files / 392 tests. Backend targeted (`b2b_test` on 5441): `test/integration/assets_library` + `test/contract/assets_library` + `{cms,blog}/asset-reference-while-off` + `{tasks,projects,crm}/attachments` + `catalog/asset-references`: 36 files / 241 tests; the detail's other callers — `test/integration/{tasks,projects,cms,invoices}`, `crm/{attachments,attachment-upload}`, `contract/crm/attachments`: 89 files / 734 tests — all green.
- `test:unit:fast` at load ~22: 361 / 365 files, 7 836 / 7 841 tests; the 5 red were whole-tree scans timing out (`migration-order-boot-warning`, `module-package-manifest` ×2, `package-peer-coherence`, `check-module-boundary`), the same set as Phase 3. Re-run alone with `--testTimeout=400000`: 4 / 4 files, 281 / 281 green.
- Checks: `check:port-dependencies`, `check:off-state-coverage`, `check:module-boundary`, `check:action-route-permissions`, `check:port-catches`, `check:port-shape`, `check:entry-presence`, `check:naming`, `check:language` — all exit 0.
- OpenAPI baseline: run without the flag — red only on master's catalog paths (#398); no asset route or schema changed, not re-recorded.
- No file moved or deleted.

---

## Phase 6: User Story 4 — Deleting a file in use is still refused (Priority: P2)

**Goal**: the in-use check counts every reference whoever asks, the refusal names only visible ones, the recursive folder delete really refuses (the R-6 repair), folder counts follow the reader, and a folder holding only hidden files deletes as empty with those files re-homed (FR-008, FR-012, SC-003, R-10).

**Independent Test**: `quickstart.md` §1, US4 row. As B, deleting a file used by a product and A's private Task is refused naming one record, count 1; a hidden file gives 404; `deleteRecursively` over a referenced file refuses; a folder of only hidden files deletes under `cancel` and the files sit in the parent afterwards.

### Tests first

- [X] T040 [US4] Write the failing integration test `backend/test/integration/assets_library/folder-delete-references.test.ts` with the reader matrix:
  - `DELETE /assets/:id` as B on F (product + A's private Task): `409 ASSET_REFERENCED`, message count 1, `details` the product only; as W: both named; a hidden file: the 404 of a missing one;
  - `deleteRecursively` over a subtree holding a referenced visible file refuses with `details` = visible ids only, and soft-deletes nothing (red today without the #535 hot-fix; with it, red on the visible-only `details` and on re-homing);
  - `deleteRecursively` with hidden files: they are re-homed to the deleted root's parent (root when none), not soft-deleted; `softDeletedAssetIds` lists only visible unreferenced files;
  - `cancel` on a folder of only hidden files: deleted, files in the parent; on a folder with a visible file: `409 ASSET_FOLDER_NOT_EMPTY` counting visible files only;
  - `moveContentsToParent`: unchanged;
  - the `asset_folder.delete` audit row carries `stateBefore.rehomedAssetIds` in the same flush;
  - `GET /assets/folders/:folderId/permalink-count` excludes hidden files for B and counts them for W;
  - deletion stays refused for W too while any reference exists (FR-010 keeps FR-008).
  - Written 2026-10-29 as a nested `US4` block of the #537 file (its case kept unchanged, sharing its server and `us1-catalog` seed), with readers A, B, S, N and the control W built in the block. Eight cases: `DELETE /assets/:id` on F (a product's gallery + A's private Task) for all five readers; a hidden file (B and N: byte-identical to a random uuid's 404; W: 409 naming the Task); `deleteRecursively` refused naming the visible referenced file only, nothing deleted or moved, then — the gallery reference removed — going through with the visible files soft-deleted and the hidden one re-homed to the deleted folder's parent; the same at the root (re-homed to `null`); `cancel` on a folder of only hidden files (W refused; B: deleted, files in the parent); `cancel` on a mixed folder (still refused for B); `moveContentsToParent` (unchanged); permalink count per reader (W, A, S 2; B, N 1). The audit row's `stateBefore.rehomedAssetIds` is asserted in the re-homing cases.
  - Red 2026-10-29, 6 of 8, for the stated reasons: B's 409 named the Task too; `deleteRecursively` named the hidden file (`details` of 2 ids), and at the root refused over the hidden file instead of re-homing it; `cancel` refused B over hidden files; `moveContentsToParent` had no `rehomedAssetIds`; B's permalink count was 2. Green on first run, as expected: the hidden-file 404 (the guard, T023) and the mixed `cancel`.
  - **Finding: the counts are not on the wire.** Every refusal's sentence is replaced by the translated one (`errors.ASSET_REFERENCED`, `errors.ASSET_FOLDER_NOT_EMPTY`, `error-envelope.ts` `localizeErrorEnvelope`), which carries no number, so B's message is W's word for word, and the count of the English fallback is internal. The integration cases therefore assert the messages equal, and the counts are measured in unit tests: `AL/…/services/assets-library-reader.test.ts` (softDelete: 1 of 2 references, the registry still asked) and the new `AL/…/services/folders.service.test.ts` (6: `cancel` visible-only count and the unrestricted count, only-hidden folder deleted and re-homed, `deleteRecursively` count and ids, permalink exclusion) — red against the old code (the constructor took no evaluator; the softDelete 409 named both references).
- [X] T041 [P] [US4] Extend `backend/test/contract/assets_library/admin-soft-delete.contract.test.ts`: the 409's count and `details` are the visible references (at least one, invariant I-1); a full-permission reader's answer is unchanged.
  - Done 2026-10-29: the existing gallery case now pins today's `details` shape (`{ path: kind, issue: label }`, one entry); a new case — a reader with `assets.*` and `tasks:read`, a file of a product and a harness administrator's private Task — gets one detail, the product's, which is W's list filtered to it. Red on the Task being named (2 details).
- [X] T042 [P] [US4] Extend `backend/test/contract/assets_library/admin-folders.contract.test.ts`: the permalink count and the `ASSET_FOLDER_NOT_EMPTY` count are reader-aware; the folder tree response is unchanged.
  - Done 2026-10-29: a reader with `assets.*` only, a folder holding a permalinked unused file and a permalinked file of a public Task: W counts 2, the reader 1 (red: 2); `cancel` is refused for both with the same sentence (the count is not on the wire — see T040); `GET /assets/folders` is equal for both.

### Implementation

- [X] T043 [US4] In `softDelete` of `AL/src/backend/services/assets-library.service.ts`, keep asking every descriptor through the registry (count all, FR-008) and build the 409's count and first 20 `details` from `AssetVisibility.visibleReferences` (R-8). T041 green.
  - Done 2026-10-29: `findReferences` still decides (every descriptor, FR-008); only when it found any does `visibleReferences(assetId)` build the count and the first 20 `details`. The guard ran first, so the asset is visible and I-1 gives at least one. A file nothing uses costs no extra read (unit case). T041 green.
- [X] T044 [US4] Make the permalink count in `AL/src/backend/services/folders.service.ts` subtract the caller's exclusion set over the subtree (R-10). T042 permalink case green.
  - Done 2026-10-29: `countPermalinkedAssets` asks `exclusionFor` with a scope callback running the count's own clauses plus `id in (candidates)`, and adds `id not in (hidden)` when anything is hidden; an unrestricted caller gets today's count with no extra read. `FoldersService` takes the evaluator (`Pick<AssetVisibility, 'hiddenAmong' | 'exclusionFor'>`) as its third, required constructor argument; `plugin.ts` passes the one instance (no other constructor call exists). T042 permalink case green.
- [X] T045 [US4] Rework folder delete in `AL/src/backend/services/folders.service.ts` per `contracts/admin-api.md` §1.1: reader-aware `cancel` refusal; real recursive reference check through the repaired `findReferencesMany`; hidden files re-homed (`folder_id` → parent or root) inside the existing folder-delete Command and flush; `stateBefore.rehomedAssetIds` on the existing audit row. Run `pnpm --filter backend run check:command-coverage` (expected clean: no new write path). T040 and T042 green.
  - Done 2026-10-29. `cancel` and `moveContentsToParent` ask `hiddenAmong` over the folder's own assets (soft-deleted included, as the old refusal counted them); `cancel` refuses only for sub-folders or visible assets and otherwise re-homes the hidden ones and deletes the folder; `moveContentsToParent` moves everything as before. `deleteRecursively` loads every asset of the subtree (soft-deleted included, so a hidden one is re-homed whatever its state rather than left to the foreign key's `set null`), asks `hiddenAmong` once, checks the **visible live** ones through the batched `findReferencesMany` (all-or-nothing, `details` their ids), soft-deletes them and re-homes the hidden ones. The audit row is written in the branch that deletes, with `stateBefore: { name, strategy, rehomedAssetIds }` (an empty array for an unrestricted caller), in the same flush as the delete. A first run soft-deleted nothing: a loaded entity's absent `deletedAt` is `undefined`, not `null` — the filter reads `!a.deletedAt`. **Deviation:** the folder delete is not a Command-Bus Command today (the route calls the service, which records its audit row through `recordAuditFromContext`); nothing was added to it, so "inside the existing folder-delete Command" reads as "inside the existing flush and audit row". `check:command-coverage`: 0 blocking. T040 and T042 green.

**Checkpoint**: data integrity is at least as strong as before (stronger: the recursive delete refuses), and no refusal or count names a hidden record.

**Phase 6 gate** (2026-10-29, production code at `2af84db47`; run on `ed95a61fb`, which adds only Phase 7's tests):
- `pnpm run build:packages` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0 (no warning in a touched file).
- `mod-assets-library` 25 files / 400 tests (the new `folders.service.test.ts` 6, `assets-library-reader.test.ts` 8).
- Backend targeted (`b2b_test` on 5441): `folder-delete-references.test.ts` (9: the #537 case unchanged + 8), `admin-soft-delete.contract.test.ts` (4), `admin-folders.contract.test.ts` (9); with the rest of `test/integration/assets_library` + `test/contract/assets_library` and `{tasks,projects,crm}/off-state`: 34 files / 282 tests green.
- `test:unit:fast` at load ~17: 363 / 365 files, 7 838 / 7 841 tests; the 3 red were `Test timed out in 30000ms` in whole-tree scans (`module-package-manifest` ×2, `check-module-boundary`), a subset of Phase 3/5's set. Re-run alone with `--testTimeout=400000`: 2 / 2 files, 269 / 269 green.
- Checks: `check:naming`, `check:language`, `check:port-dependencies`, `check:off-state-coverage` (41/41), `check:module-boundary`, `check:action-route-permissions`, `check:port-catches`, `check:port-shape`, `check:entry-presence`, `check:command-coverage` (0 blocking) — all exit 0.
- OpenAPI baseline: not run — no route, request or response schema changed (`rehomedAssetIds` is in the audit row, not in a response).
- No file moved or deleted; the one removed symbol (`FoldersService.collectSubtreeAssetIds`, private) is named nowhere else.

---

## Phase 7: User Story 5 — Switching a module off does not expose or destroy its files (Priority: P2)

**Goal**: a switched-off owner's files stay hidden from every non-wildcard reader and undeletable for everyone; switching back on restores every reader's view with no write (FR-009, FR-010, SC-005, Constitution XVII).

**Independent Test**: `quickstart.md` §1, US5 row. `withModuleOff('tasks')`: F is absent for B and S, present for W, and `DELETE` is refused for everyone, W included; switched back on, B's, S's and W's lists equal the ones taken before. Repeated for `projects` and `crm`.

### Tests first

- [X] T046 [US5] Write `backend/test/integration/assets_library/reference-visibility-owner-off.test.ts`, for each of `tasks`, `projects`, `crm`, on both axes (`deactivated`, `platform-unavailable`, F-22):
  - snapshot B's, S's and W's lists and details before;
  - while off: the owner-only file is absent for B and S and answers by-id as a missing file, present for W; `DELETE` refused for all three, W included; the library's list does **not** answer 503 (R-4: the library never resolves the owner's gated code);
  - rescue while off: a file used by the switched-off owner's record **and** a CMS page stays visible to B;
  - switched back on: every reader's list and details equal the snapshot; no row was written (assert `assets.updated_at` unchanged).
  - Expected: green on first run if T021 is right; prove each case measures something as in T036 and record it.
  - Written 2026-10-29 with readers B (confined to an Organization O2 seeded with a row — Projects and CRM hold real foreign keys, so the harness's `OTHER_TEST_ORGANIZATION_ID` will not do), S and the control W; A and N are not built (A differs from S only in authorship, N sees no owner's record even while it is on — neither can tell an owner switched off from one on). Per owner a file **B and S see while the owner is on** — a public Task, a Project open to everyone in O2, an Opportunity of O2 — so hiding it is measurable for B too, a file of the same record plus a CMS page, and an unused file. A control case (everything on: B, S, W list and open every file), then `it.each` over the six owner × axis rows (written as object rows, so `check:off-state-coverage` reads each subject): hidden from B and S (list, and `GET /assets/:id` and `/url` byte-identical to a random uuid's), listed and opened by W, the list answering 200 throughout; `DELETE` as B and S identical to a random uuid's, as W `409 ASSET_REFERENCED`, the row not deleted; the rescued file listed and opened by B, its references the CMS page only, its `DELETE` refused naming the page only; and switched back on, every reader's list and every file's detail equal to the snapshot taken before (signed URLs' token and expiry masked) and the `assets` rows (`updated_at`, folder, `deleted_at`, permalink) unchanged, after B, S and W listed, opened and tried to delete every used file while off.
  - **Green on first run** after two fixture fixes of mine (the O2 foreign key above; a private file's signed URL is minted per answer, so the snapshot masks its token and expiry). Shown red against five deliberate breaks of `mod-assets-library`, each built into its dist and run with T047's file, the sources restored from a copy and rebuilt after (never committed): **P** (an owner switched off is asked as if on) — 20 red: every hidden, delete and rescue row (the owner's gated code answers `503 MODULE_DISABLED`, the R-4 failure) and both T047 cases; **E** (the registry skips an absent owner at enumeration, D-39's `skip`) — 14 red: every delete row (W's delete went through), every restore row (rows written) and both T047 cases; **R** (no rescue) — the six rescue rows; **S** (an owner once seen off stays off) — the six restore rows and both T047 cases (the restore case first passed under S, its snapshot being taken after earlier rows had already made the break sticky; it now asserts B and S list every file before taking the snapshot, and was re-run red); **W** (a switched-off owner hides its files from the wildcard too) — 14 red: every hidden and delete row and both T047 cases. Every row except the control is red under at least one break.
- [X] T047 [P] [US5] Extend the existing "library refuses delete while off" case in `backend/test/integration/tasks/off-state.test.ts`: the file is also absent from a restricted reader's list while off and back once Tasks is on. Run `pnpm --filter backend run check:off-state-coverage`.
  - Done 2026-10-29: the case now also builds a reader with `tasks:read` and `assets.*` and asserts the file (of a public Task) is listed for them while Tasks is on, absent while off — listed for the Platform administrator — and listed again once Tasks is back, on both axes. Green on first run; red under breaks P, E, S and W (T046). `check:off-state-coverage`: 41/41 proven, 0 findings (the first draft of T046's table was built with `flatMap` and gave 4 `unresolvable-subject` findings; rewritten as literal rows).

### Implementation

- [X] T048 [US5] No new code is planned. If T046 or T047 finds a defect, fix it in `AL/src/backend/services/asset-visibility.ts` with its unit case in `AL/src/backend/services/asset-visibility.test.ts` first, and record it under this task.
  - Done 2026-10-29: no defect found, no production code changed.

**Checkpoint**: Constitution XVII holds for the library's view of every restricted owner.

**Phase 7 gate** (2026-10-29, on `ed95a61fb`; no production code changed in this phase, so the Phase 6 gate's build, typecheck, lint, package suites, `test:unit:fast` and checks are this tree's):
- `reference-visibility-owner-off.test.ts` (25) and `tasks/off-state.test.ts` (12) green; `{projects,crm}/off-state` green in the same targeted run (34 files / 282 tests above).
- `check:off-state-coverage`: 41/41 proven, 0 findings, after T046's table was written as literal rows.
- `mod-assets-library` dist rebuilt from the restored sources after the break runs; `git status` showed no library source change.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T049 Write `backend/test/perf/assets_library/reference-visibility.perf.test.ts` on the `PERF_RUN` pattern of `backend/test/perf/tasks/context-visibility.perf.test.ts` (R-16): 50 root-folder assets × 3 references of different kinds plus 2 000 hidden Task attachments; `GET /assets?limit=50` p95 over 30 iterations for B < 1 000 ms and ≤ 1.2 × W's p95 (env-overridable); the missing-versus-hidden by-id latency recorded, not gated. Run with `PERF_RUN=true` and record the figures under this task. If SC-004 fails, apply R-5's fallback (memoise each owner's scope per request) and re-measure.
  - Done 2026-10-29. `backend/test/perf/assets_library/reference-visibility.perf.test.ts`: 50 visible root files × 3 references (a product gallery, an open Task, an Opportunity B reaches) and 2 000 hidden files on 200 private Tasks, all newer, so B's first page is reached only through the exclusion; B = `tasks:read`, `crm:read`, `assets.*`. B's and W's reads are **interleaved** (B, W, B, W …), so a shared machine's load falls on both alike. Also recorded: by-id hidden vs missing, `GET /tasks/:id/attachments` (50 files), the permalink count over 1 000 hidden + 50 visible permalinked files, and one `cancel` folder delete re-homing 500 hidden files.
  - **First run (as built through T048): SC-004 missed** — B p95 877 ms, W p95 450 ms, ratio 1.95 (load ~13). Instrumented (in the built `dist`, never committed): the exclusion cost ~300 ms — Tasks' hidden set 25–40 ms (3 500 ids, every folder), the **scoping read 130–200 ms** (an ORM `find` hydrating 2 000 `Asset` rows from a 3 500-placeholder `in (…)`), `hiddenAmong` ~110 ms (owners' `findReferences` + `visibleEntityIds` ~45 ms, **then** the nine unrestricted descriptors over the 2 000 pending ids ~55–65 ms).
  - **Fixed (R-5's measurement clause), red first:** the new `AL/…/services/asset-id-sets.ts` passes a set as **one** `uuid[]` parameter — the scoping read is a query-builder `select a.id … and a.id = any(?::uuid[])`, executed without hydration (130 → ~17 ms), and the page's exclusion is `id <> all(?::uuid[])` (`raw` in the `where`, replacing `$nin`); the folder permalink count uses both (B p95 276 → ~130–157 ms). For a list's candidates — all of which hold a hidden restricted reference by construction — `exclusionFor` asks the unrestricted descriptors about every scoped candidate **alongside** the owners instead of after them (`#hiddenAmong(…, 'all')`; `hiddenAmong` keeps asking them for the pending ids only). The same statements, one per descriptor (FR-014). Unit: `asset-visibility.test.ts` "asks each unrestricted descriptor once, for every scoped candidate, while the owners are still answering" — red (`expected false to be true`: the rescue started only after the owner answered), then green; the two shape assertions of `assets-library-reader.test.ts` and `folders.service.test.ts` now read the `uuid[]` parameters back (`RawQueryFragment.getKnownFragment`). `test/integration/assets_library` + `test/contract/assets_library` 31 files / 230 tests green on the new SQL.
  - **After the fix, SC-004 is half met.** p95 B / W (ratio), 30 interleaved reads unless noted: with the array parameters only — 592 / 464 ms (1.28; 8 reads, load ~9); with the concurrent rescue too — 724 / 517 (1.40, load ~9), 1 183 / 775 (1.53, instrumented, load ~16), 711 / 379 (1.88, load ~33; medians 429 / 281). B < 1 000 ms is **met** except under the instrumented run at load 16; ≤ 1.2 × W is **missed** in every run. The exclusion is now ~110–150 ms; W's page is itself ~280–500 ms, mostly its 50 summaries (each resolves its URL with its own read), so the 20 % allowance is ~60–100 ms. R-5's named fallback (memoising Tasks' scope per request) would save the ~10 ms of one `TaskVisibility` evaluation and was not applied. **Owner decision**, see the Phase 8 gate. The gate stays at the spec's 1.2 (`PERF_ASSETS_RATIO`), so the benchmark is red under `PERF_RUN=true` until it is decided.
  - Recorded, not gated: by-id hidden p95 29–51 ms vs missing 13–22 ms (R-7's residual timing: the owner and rescue reads); `GET /tasks/:id/attachments` (50 files) B 1.6–3.5 s vs W 0.9–1.5 s — each attachment's URL comes from a full `getAsset` detail, which asks every descriptor for that file (pre-existing) and, since T039, each restricted owner holding a reference once more (deferrable; issue text in the report, `gh issue create` was refused); permalink count B 131–157 ms vs W 16–24 ms; folder delete (`cancel`, 500 re-homed) 199–240 ms.
- [X] T050 [P] Write the English documentation:
  - `packages/modules/assets_library/docs/assets-library/index.md`: a "Who sees which files" section for users (hidden files, the "used by" list, delete refusals, folders re-homing hidden files, owner switched off, the Platform administrator, public links unchanged, FR-009a's two ways to remove files for good) and, for developers, the `readerRestriction` contract, `AssetReferenceHit.assetId`, batching, and `assetReadPort.visibleToCaller`;
  - one sentence each in the attachments sections of `packages/modules/tasks/docs/tasks.md`, `packages/modules/projects/docs/projects.md` and `packages/modules/crm/docs/crm.md`.
  - Run `pnpm --filter backend run check:module-docs` and `check:doc-snippets`.
  - Done 2026-10-29. `AL/docs/assets-library/index.md`: a new **Who sees which files** section (the rule, what "absent" means, *Referenced by*, delete refusals naming visible records only with one message for everybody, folders — visible-only permalink count, a hidden-only folder empty for the reader, re-homing under every mode and `deleteRecursively`'s refusal, `rehomedAssetIds` — the Platform administrator, an owner switched off, FR-009a's two ways, and what does not change: file URLs and permalinks, background work, the storage page's counts, R-12); the intro bullet, the permalinks' folder-delete bullet and the soft-delete step updated; *Reference protection* now says every contributor's references are counted and only visible ones named, with a **For developers: reader-restricted references** subsection (`AssetReferenceHit.assetId`, `readerRestriction` and its three methods, getters and no presence probe, caller classes, the per-page cost, `assetReadPort.visibleToCaller`, `getAsset`'s filtered references). One sentence (two in CRM) in each of `tasks.md`, `projects.md`, `crm.md`. The refusal's message carries no number, so the user text gives none. `check:module-docs` 0 findings; `check:doc-snippets` clean.
- [X] T051 Write the Polish copies per `docs/docs/contributing/documentation-i18n.md` (manual workflow): `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/assets-library/index.md` and the one sentence in `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/{tasks,projects,crm}.md`, UI labels taken from each module's `i18n/pl.json`; update the cache entries under `docs/translation-cache/pl/` with the English source's hash. Run `check:docs-translations` (0 findings) and `pnpm --filter docs run build` in both locales.
  - Done 2026-10-29. Polish copies of all four pages (labels from `AL/i18n/pl.json`: *Używany przez*, *Nieposortowane (root)*); each cache entry's `content` copied from the materialised page and `sourceHash` set from `hashSourceBody()` of the English source. `check:docs-translations` also reported `generated:module-reference/assets-library` stale — the `admin_roles` row `composer:generate` added at T013 had no Polish mirror — so that row was mirrored too (ledger §G). `check:docs-translations`: sources=173 **findings=0**. `pnpm --filter docs run build`: exit 0, `[SUCCESS]` for `en` and `pl`.
- [X] T052 [P] Write the changesets in `.changeset/` per `plan.md` *Other gates* and `release-intent.md`, one per meaning: `@endora-commerce/contracts` minor; `@endora-commerce/mod-assets-library` minor (reader-aware admin API; repaired recursive folder delete, with a release note that it now refuses in-use files); `mod-tasks`, `mod-projects`, `mod-crm` minor; `mod-catalog`, `mod-cms`, `mod-blog`, `mod-megamenu` patch. Review each body against `specs/conventions/commercial-data.md`. Run `pnpm run check:release-intent --since origin/master` (or the backend script it routes to).
  - Done 2026-10-29: six files, `.changeset/166-*.md` — `contracts` minor (`AssetReferenceHit`, `readerRestriction`, the required `AssetReadPort.visibleToCaller` and who it breaks); `mod-assets-library` minor (the whole visibility behaviour, delete refusals naming visible references only, the recursive folder delete refusing over a visible in-use file and re-homing hidden files under all three modes including `cancel`, `stateBefore.rehomedAssetIds`, owner off, the `admin_roles` dependency); `mod-tasks`, `mod-projects`, `mod-crm` minor (restriction and attach check), one per package because each rule differs; `mod-catalog`, `mod-cms`, `mod-blog`, `mod-megamenu` patch in one file (one meaning). **Also edited #537's unreleased changeset**: its last sentence said each asset is asked separately, which T013 replaced and which would ship contradicted (ledger §I added). Reviewed against `commercial-data.md`: no counterparty, figure or strategy. `pnpm --filter backend run check:release-intent -- --since origin/master`: changesets-added=6, violations=0. **Feature-number collision:** `master` now also has `specs/166-mfa-totp-hardening/` (merged in `1b5436092`); every changeset and doc cites the slug.
- [X] T053 Regenerate the generated artefacts: `pnpm --filter backend run manifests:generate` then `pnpm install --lockfile-only`; `composer:generate` (expected: nothing, no migration); the OpenAPI baseline with `UPDATE_OPENAPI_BASELINE=1` (expected: nothing). Commit whatever renders; if anything beyond `assets_library`'s package manifest changes, stop and report.
  - Done 2026-10-29, after merging `origin/master` (`1b5436092`, no conflict: cms page translations, mfa TOTP hardening). `manifests:generate` + `pnpm install --lockfile-only` and `composer:generate`: **nothing rendered** (`git status` clean). OpenAPI baseline with `UPDATE_OPENAPI_BASELINE=1`: 102 added lines, all under the same nine **catalog** paths from `master` as at T024 (#398's class), no asset path — reverted, not re-recorded.
- [X] T054 Derived-ledger and deleted-symbol sweep: `command grep -rn 'findReferencesMany\|__assetId' backend/test admin/test packages --include='*.ts'`, plus the #535 hot-fix's fallback symbol recorded in T005; confirm no test still encodes the empty `findReferencesMany` answer or the hot-fix's per-asset call count. Nothing is moved or deleted, so `backend/test/unit/kernel/module-removal.test.ts` and the recorded read sizes must be green untouched; run `module-removal.test.ts` and record the result. Do not re-record a read size the band accepts.
  - Done 2026-10-29. `command grep -rn 'findReferencesMany\|__assetId\|collectSubtreeAssetIds' backend/test admin/test packages --include='*.ts' --include='*.tsx'`: no `__assetId` and no `collectSubtreeAssetIds` anywhere; `findReferencesMany` is called by the registry, `folders.service.ts`, the #535 cases (attribution and agreement with `findReferences` — no call count, no empty answer encoded), T011's attribution cases, and stubbed as an inert `async () => new Map()` in megamenu's registration test, which never calls it. The #537 hot-fix's fallback was a loop body, not a named symbol (T005), and is gone since T013. No file was moved or deleted on the branch (`git diff --diff-filter=DR origin/master...HEAD` empty); `test/unit/kernel/module-removal.test.ts` result under T056.
- [X] T055 Have an independent reviewer go over every leak path: each by-id route and the guard's placement, the list and picker, move-many, folder counts and folder delete, the permalink conflict, the delete refusal, the error bodies, and the three owners' attach paths. Record the result in the merge request description.
  - *(2026-10-29, before the review.)* The implementing agent cannot be that reviewer, and no merge request exists yet to record the result in (the branch is not pushed). Implementer's own pass over the leak paths on 2026-10-29, for the reviewer's starting point and not as a substitute: the ten `:id` routes carry `requireVisibleAsset` after the gate (structural test T010); the list and picker share `listAssets`' exclusion, `includeDeleted` included; move-many filters through `hiddenAmong`; the folder DTO carries no counts, and the folder-delete response names only `softDeletedAssetIds`, which are visible by construction; the permalink count, the `cancel` refusal and the `deleteRecursively` refusal count and name visible files only; the permalink conflict redacts a hidden holder; error bodies are byte-identical to a missing id's (T025, T046); the three owners' attach paths ask `visibleToCaller` first (T026–T028). One residual, by design (R-7): a hidden id's by-id answer takes ~15–25 ms longer than a missing one's (T049).
  - **Done 2026-10-30: independent read-only review**, three findings; the result still goes into the merge request description when one exists.
    - **F-1 (high, confirmed live) — fixed in `3fa82f9b8`, changeset note in `0a04f0f2b`.** `assertVisible` let every id that failed `isAssetIdShaped` through to the service, but PostgreSQL also reads a uuid without hyphens, in braces or grouped otherwise: `GET /admin/assets/<id without hyphens>` answered a hidden file's detail (200), and the same spellings got through `/url`, `PATCH`, permalink, replace, previous-version restore, move, restore and `DELETE`'s message. Now `assertVisible` answers every non-canonical spelling with the exact not-found answer, for every caller and asking no owner, checks the canonical form in upper case as its lower-case self (refused under that id, which is what the service names for a missing row), and returns the lower-case id, which the guard writes back into `req.params.id`, so no handler reaches the database with the spelling sent. **Decision: a visible file answers only to its canonical spelling, in either case** — other spellings 404 for every reader, `*` included. Red → green: `asset-visibility.test.ts` (5 spellings × 3 caller classes; the upper-case case) red on `undefined` returned / no throw; `routes.admin.guard.test.ts` (the parameter rewritten) red on the upper-case id kept; `reference-visibility.test.ts` — four spellings of a hidden file on all ten by-id routes for B and N, each equal to the same spelling of a random uuid and to the canonical answer (red: replace answered **415** for the hidden hyphen-less id), and a visible file's spellings for A, B and W (red: **200** for the hyphen-less id).
    - **F-2 (medium) — fixed in `91dfab56a`.** Attach-by-id paths of modules without reader restrictions read the asset for existence only: a hidden file was linkable (and the link, an unrestricted reference, made it visible to every library reader through FR-001 b), and the kind check was an existence oracle. FR-006 amended to "any record". Every admin path that takes an asset id from an administrator was traced:
      - **Fixed** (`visibleToCaller` right after the existence read, hidden = missing, nothing linked): catalog gallery `create`, attachment `createAttachment` (404 `NOT_FOUND`, unchanged for missing); catalog product create's `downloadAssetId` and category `PATCH`'s new `mainImageAssetId`, blog post and category `create`/`patch` `mainImageAssetId` (a missing id reached the foreign key and answered **500**; both now 404 `NOT_FOUND`); megamenu `validateTarget`'s icon and asset target (missing and hidden both `400 MEGAMENU_ASSET_KIND_MISMATCH`). Red → green: `foreign-attach-visibility.test.ts` (new) — gallery and attachments red on **201** for the hidden id; download, category image and blog images red on **500** for the random id; `target-validator.test.ts` — red on the hidden asset accepted.
      - **Not a linking path:** product `PATCH` does not write `downloadAssetId` (asserted in the new test); catalog category create has no image field; `orders` reads an invoice's own generated PDF; `pwa` icon is upload-only (it stores the id it just uploaded); `tasks`, `projects`, `crm` already check (T026–T028).
      - **Not fixed here; filed as #544. Owner ruling 2026-10-30: option (a), refuse every newly added id the caller cannot see, a missing id included; a separate feature after the 2026-11-03 release:** `cms` page bodies and `share_image_asset_id`, catalog category content, blog content store asset ids with no existence read and no foreign key (a missing id is accepted), so refusing a hidden one alone would tell it from a missing one, while refusing both changes what a content save accepts. `document_templates` Image blocks and the `invoices` logo inline bytes into PDFs; `settings` `shop.logo_asset_id` and `sales_channels` logo expose a public URL only; none of these registers a reference descriptor. `returns` attachment ids are customer-supplied (not an admin path).
    - **F-3 (pre-existing)** — the public file route answers 403 for an existing private asset and 404 for a missing one; filed separately by the orchestrator (#542).
    - **Accepted residuals named by the reviewer:** the check-then-act window between the guard and the handler; by-id timing (R-7, T049); a 500 when an owner's visibility read errors; the permalink-taken conflict saying a permalink is held (by design; the holder is redacted); audit rows holding hidden ids.
    - **T055 fix gate** (2026-10-30, on `91dfab56a`): `build:packages` exit 0; `pnpm -r run typecheck` exit 0; `pnpm -r run lint` exit 0, 0 errors (warnings only in untouched admin files). Co-located: `mod-assets-library` 408/408, `mod-catalog` 348/348, `mod-blog` 22/22, `mod-megamenu` 23/23. Backend `test/{integration,contract}/{assets_library,catalog,blog,megamenu}` + `test/unit/megamenu`: 1 331 / 1 338 — the 7 red are `integration/catalog/cross-sell-channel` (3) and `link-tile-price-source` (4), "names no default language", the same 7 the Phase 8 gate reproduced on `origin/master`. `test:unit:fast`: 7 844 / 7 845; the one red, `check-module-boundary` "has every cross-module reach ledgered" (30 s timeout), is green alone (154/154). `check:port-dependencies`, `check:module-boundary`, `check:port-catches` 0 violations; `check:naming`, `check:language` OK; `check:release-intent --since origin/master` 0 violations (7 changesets).
- [X] T056 Run the full verification set of `quickstart.md` §3 on the final tree: `pnpm run build:packages`; `pnpm -r run typecheck && pnpm -r run lint`; `pnpm --filter backend run test:unit:fast`; the targeted integration and contract directories (`test/integration/assets_library`, `test/contract/assets_library`, `test/integration/{tasks,projects,crm,cms,blog,catalog}`); `pnpm --filter '!backend' run test`; `PERF_RUN=true` perf run; `check:port-dependencies`, `check:port-catches`, `check:port-shape`, `check:entry-presence`, `check:module-boundary`, `check:command-coverage`, `check:off-state-coverage`; `pnpm run check:naming && pnpm run check:language`; `git status` clean after regeneration. Record every result, failures with their output.
  - Done 2026-10-29/30 on `91ff9074b`; results in the Phase 8 gate below. Every failure either reproduced identically on `origin/master` `743ef8198` (in a detached worktree, after `scripts/setup-worktree.sh` and `build:packages`) or was green when re-run alone. `test/unit/kernel/module-removal.test.ts` is green untouched (T054).
- [X] T057 Do the manual browser walk of `quickstart.md` §2 on a **separate** database (never the development database), with readers A, B and the Platform administrator. Record any deviation as a defect under the task that owns it.
  - *Done 2026-10-30 by the orchestrator with Claude in Chrome on a separate database `b2b_walk166` (`setup` + demo seed; backend 3101, admin 3102). Readers: A = `sales-rep-other`, B = `sales-rep` (the demo role was given `assets.read`/`assets.write` in that database only), Platform administrator = `admin`.*
  - **Deviation from the scenario.** The demo's product images are all SVG, which attachment rules refuse as active content. So the shared file was `chair.png`, attached to A's private Task TSK-000023 and to the public TSK-000025: the US2/US3 "a visible and a hidden record" case.
  - **Results, all seven steps pass:**
    1. A's private Task has `contract.pdf` and `chair.png`.
    2. As B:
       - `contract.pdf` is absent from the list, and searching "contract" finds nothing.
       - `chair.png` is listed; its *Referenced by* shows TSK-000025 only, and *Soft-delete* is disabled ("Remove every reference first").
    3. B's `GET /assets/<contract id>` and `/url` answer byte-for-byte like a made-up id (404 `ASSET_NOT_FOUND`).
    4. The picker is not shown: B has no catalog write. It uses the same list API as step 2. B attaching `contract.pdf` to B's own Task answers exactly like a made-up id (422).
    5. A sees both files, and `chair.png`'s *Referenced by* lists both Tasks.
    6. Tasks switched off:
       - the Platform administrator sees `contract.pdf` and gets 409 `ASSET_REFERENCED` on delete;
       - B sees neither file, since both are used only by Tasks.

       After switching back on, B sees `chair.png` again and still not `contract.pdf`.
    7. B's folder delete with `deleteRecursively` gets 409 `ASSET_REFERENCED`, naming `chair.png`'s id.
  - **Defect found and fixed (T055 F-1).** The walk confirmed the review's bypass: B got `contract.pdf`'s detail with its id written without hyphens or in braces. After `3fa82f9b8` the walk instance was restarted, and every spelling (canonical, hyphen-less, upper-case, braced) answers 404 `ASSET_NOT_FOUND` on detail and `/url`.
  - **Not a defect:** library thumbnails do not load on the walk instance, because they point to the shared `.env`'s backend address (3001), not the walk port (3101).
  - **Not done: no browser was available to the implementing agent.** Every API-level assertion of quickstart §2 (list, search, *Used by*, the by-id answer equal to a made-up id's, the picker query, the owner switched off and back on, the recursive folder delete refused naming the file) is covered by T025, T036, T038, T040 and T046. What only a browser shows — the drawer's *Delete* disabled for B on *chair.jpg*, the picker dialog — is still to be walked on a separate database.
- [X] T058 Update issue #513: a ticked checklist of FR-001…FR-014 and the stories, the progress per phase, the relation to #535 (hot-fix on master, superseded by T013 with its test kept), and the planning amendments the owner acknowledged on 2026-10-29 — R-9 (a hidden id in move-many is skipped like a missing one), R-10, R-12 (the storage page's two counts stay library-wide), R-14 and R-15. Close #535's loop by linking the merge request.
  - *Done 2026-10-30: the progress comment from Phase 8 plus a closing comment on #513 linking merge request #547 (which closes it); #535 commented that #537 is superseded by #547 (T013), its tests kept.*
  - **Partly done.** The progress comment is posted on #513 (2026-10-30, https://github.com/endora-commerce/endora-commerce/issues/513#issuecomment-6511555176). It has the ticked FR-001…FR-014 and story checklist, the progress per phase, SC-004's open ratio, the relation to #535/#537, and R-9, R-10, R-12, R-14 and R-15. **Still outstanding:** linking the merge request from #513 and #535. No merge request exists yet; the branch is not pushed.

**Phase 8 gate** (2026-10-30, on `91ff9074b`, with `origin/master` `743ef8198` merged as `1b5436092`):
- `pnpm run build:packages` exit 0. `pnpm -r run typecheck` exit 0. `pnpm -r run lint` exit 0 with 0 errors; every warning is in a file this feature does not touch.
- `test:unit:fast`, at load ~15–20: 363 / 365 files, 7 840 / 7 842 tests.
  - The 2 red were whole-tree scans that timed out, as in Phases 3–6: `module-package-manifest` ("writes nothing in --check mode") and `check-module-boundary` ("has every cross-module reach ledgered").
  - Re-run alone with `--testTimeout=400000`, together with `module-removal.test.ts`: 3 / 3 files, 277 / 277 tests green.
- `pnpm --no-bail --filter '!backend' run test` (`NODE_OPTIONS=--no-experimental-webstorage`): every package green except `admin`, at 471 / 473 files.
  - Its 2 red were `carts/cart-approval-policy-zone` (a spy not yet called) and `cms/brand-page` (a 30 s timeout), at load ~49. Both green alone: 2 files, 21 tests.
  - A first run with bail stopped on three 10 s timeouts in `cli`. `cli` was green in the no-bail run.
- **Full backend suite** (`pnpm --filter backend run test`, `BACKEND_TEST_WORKERS=3`, `b2b_test` on 5441, 6 352 s): 1 798 / 1 838 files, 16 784 / 16 877 tests. 14 files and 25 tests were red, in three groups:
  - **Load, green alone:** `integration/demo/demo-reset-after-use`, `contract/price_lists/price-book-batch-scope`, `unit/packages/module-package-manifest`, `unit/scripts/check-harness-teardown`, `unit/scripts/check-module-boundary`.
  - **OpenAPI baseline:** the same nine `master` catalog paths as at T024 (#398's class).
  - **Red on `master` too.** These 8 files / 17 tests fail identically and deterministically on `origin/master` `743ef8198` in a separate worktree:
    - `integration/catalog/cross-sell-channel` (3) and `integration/catalog/link-tile-price-source` (4): `ProductLinkService: the resolved channel … names no default language`;
    - `integration/orders/place-order-request-channel-consequences` (3): 404 where 201 or 422 was expected;
    - `integration/orders/place-order-sales-channel` (1);
    - `integration/orders/request-refusal-basket` (2): the Polish product name;
    - `contract/orders/admin-order-preview-availability` (1);
    - `contract/carts/cart-add-item-packaging` (2): 404;
    - `contract/quick_order/build` (1).

    None of them touches an asset path. Filing them as an issue was refused (`gh issue create` denied); the text is in the report.
- `PERF_RUN=true` `test/perf/assets_library`: red on SC-004's ratio only (T049).
- Checks, all exit 0:
  - `check:port-dependencies`, `check:port-catches`, `check:port-shape`, `check:entry-presence`, `check:module-boundary`, `check:command-coverage` (0 blocking), `check:off-state-coverage` (41/41), `check:action-route-permissions`, `check:platform-surface`;
  - `check:naming`, `check:language`;
  - `check:module-docs`, `check:doc-snippets`, `check:docs-translations` (0 findings);
  - `check:release-intent --since origin/master` (6 changesets, 0 violations).

  Three of these first exited non-zero because `build:packages` was rebuilding `dist` in parallel. All three were clean once re-run after the build.
- `pnpm --filter docs run build`: `en` and `pl` both `[SUCCESS]`.
- Generated artefacts: `manifests:generate`, `pnpm install --lockfile-only` and `composer:generate` render nothing. `git status` is clean.
- No file was moved or deleted.

**Owner decisions:**
1. **SC-004's ratio** (T049). The 50-file page stays under 1 s, but it is 1.3–1.9× the Platform administrator's when the folder holds 2 000 hidden attachments. Either accept the ratio (amend SC-004 and set `PERF_ASSETS_RATIO`) or commission structural work. Candidates: a cached per-owner hidden set, or the owners' predicates in the list's own SQL.
2. **Feature number 166 is now shared:** `master` also has `specs/166-mfa-totp-hardening/`. Cite the slug.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1):** T001 first; its findings (f) and (g) add ledger lines that T007–T011 need. T002 → T003. T004 independent of T002/T003.
- **Foundational (Phase 2):** needs Phase 1 and blocks every story. T005 (merge, then tests) → T013. T006–T012 in parallel. T013 → (T014 ∥ T015 ∥ T016 ∥ T017) and (T018 ∥ T019 ∥ T020) → T021 → T022 → T023 → T024.
- **US1 (Phase 3):** needs Phase 2. T029 → T030 → T031 (one file, sequential); T032 ∥ T033 ∥ T034.
- **US2 (Phase 4):** needs Phase 2 only; may run in parallel with US1 (it shares `reference-visibility.test.ts`, so add its block after US1's fixtures exist, or rebase by adding lines).
- **US3 (Phase 5):** needs US1 (the same test file's fixtures, the same service file).
- **US4 (Phase 6):** needs Phase 2 (T013's repair) and US3's `visibleReferences` use in `detail()` (T039) for the refusal's names.
- **US5 (Phase 7):** needs US1 (the list exclusion) and US4 (the delete refusal it asserts).
- **Polish (Phase 8):** needs every story. T049 needs US1–US3; T053 after every manifest or package change; T056 last before T057–T058.

### Story completion order

US1 → US2 (parallel-capable) → US3 → US4 → US5 → Polish.

### Parallel opportunities

- **Inside Phase 2:** the seven test tasks T006–T012, then the four unrestricted scanners T014–T017 and the three owners T018–T020 — seven different packages.
- **Across stories:** US2 alongside US1 once Phase 2 is green, in a separate worktree branched off this feature branch (`scripts/setup-worktree.sh`).
- **Hot files**, rebased by adding lines: `AL/src/backend/services/assets-library.service.ts`, `AL/src/backend/routes.admin.ts`, `AL/src/backend/services/folders.service.ts`, `backend/test/integration/assets_library/reference-visibility.test.ts`, `X/assets-library.ts` (frozen after T022).

### Parallel example: Foundational

```text
Red first, together:
  T006 asset-visibility.test.ts · T007 tasks restriction · T008 projects restriction
  T009 crm restriction · T010 routes.admin.guard.test.ts · T011 scanner attribution · T012 visibleToCaller
Then: T013 → (T014 ∥ T015 ∥ T016 ∥ T017) ∥ (T018 ∥ T019 ∥ T020) → T021 → T022 → T023 → T024
```

### Parallel example: User Story 1

```text
Red first, together:
  T025 reference-visibility.test.ts (US1) · T026 tasks attachments · T027 projects attachments · T028 crm attachments
Then: T029 → T030 → T031 (assets-library.service.ts) ∥ T032 ∥ T033 ∥ T034 → T035
```

### Parallel example: User Story 2

```text
T036 (after US1's fixtures exist) → T037 only if a case is red
```

### Parallel example: User Story 3

```text
T038 → T039
```

### Parallel example: User Story 4

```text
Red first, together: T040 folder-delete-references.test.ts · T041 admin-soft-delete · T042 admin-folders
Then: T043 (assets-library.service.ts) ∥ T044 → T045 (both folders.service.ts, sequential)
```

### Parallel example: User Story 5

```text
Together: T046 reference-visibility-owner-off.test.ts · T047 tasks/off-state.test.ts → T048 only if red
```

---

## Implementation Strategy

1. **Minimum MVP = Phases 1–3** (Setup, Foundational, US1): issue #513's leak of whole files is closed, and the recursive folder delete is repaired. It is not shippable alone: a visible file's "used by" list still names hidden records.
2. **Shippable MVP = Phases 1–5** (all three P1 stories): nothing a restricted reader receives names, counts or serves a hidden record's file, and everyday content work is proved unchanged. Show it on the demo to the owner at this checkpoint.
3. **Then the P2 stories:** US4 (refusal names and folder behaviour) and US5 (owner off), then Polish.
4. **One merge request** delivers the feature from `166-asset-reference-visibility` to `master`. If the owner wants it earlier, split at the Phase 5 checkpoint; every phase is green on its own, and there is no migration to keep single.

---

## Requirement traceability

| Requirement | Tasks |
| --- | --- |
| FR-001 visibility rule | T006, T021, T025, T036 |
| FR-002 owner decides | T007–T009, T018–T020 |
| FR-003 declared restriction | T002, T003, T018–T020 (unrestricted: T014–T017 add none) |
| FR-004 absent from list, folders, picker, detail, URL | T025, T029, T040, T044 |
| FR-005 by-id actions not found; move-many skip | T010, T023, T025, T030 |
| FR-006 attach-existing refused | T012, T022, T026–T028, T032–T034 |
| FR-007 "used by" filtered | T038, T039 |
| FR-008 deletion counts every reference | T005, T013, T040, T041, T043, T045 |
| FR-009 owner off fails closed | T006, T021, T046, T047 |
| FR-009a removal routes | T001 (e), T050 |
| FR-010 wildcard override | T006, T021, T046 |
| FR-011 system sees all | T005, T006, T012 |
| FR-012 no existence leak | T023, T025, T031, T040, T042, T045, T055 |
| FR-013 no weakening | T025 (A, S), T036 |
| FR-014 batched per page | T005, T006, T011, T014–T017, T049 |
| SC-001 | T025 |
| SC-002 | T036, T035 |
| SC-003 | T040, T041 |
| SC-004 | T049 |
| SC-005 | T046 |
