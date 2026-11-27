# Implementation Plan: Asset visibility follows the records that reference it

**Branch**: `166-asset-reference-visibility` | **Date**: 2026-10-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/166-asset-reference-visibility/spec.md`: GitHub issue
#513, owner ruling option A, and owner rulings Q1 = A (fail closed while the owner is switched off)
and Q2 = A (the platform wildcard `*` is the only override, FR-009a).

## Summary

The asset library already asks every module that uses files "which of your records use these
assets?", but only to refuse a delete. This feature adds a second question to the same
contribution, "which of these records may the current reader see?". The three modules whose
records have reader-specific visibility — Tasks, Projects and CRM — answer it. The library then
hides what the reader may not see, on its own admin surface.

| Capability | Decided in |
| --- | --- |
| The descriptor gains an optional `readerRestriction` (three batched methods, answered for the ambient caller); hits carry `assetId` | R-2, R-6 |
| Who the caller is: system or wildcard (unrestricted), admin (asks owners), anyone else (sees no restricted record) | R-3 |
| Owner switched off → its references are hidden from everyone but the wildcard, and still protect from deletion | R-4 |
| The list (and the picker) narrowed in SQL by a per-request exclusion set, so pages stay full | R-5 |
| One preHandler guard on every by-id route, answering byte-identical `404 ASSET_NOT_FOUND` | R-7 |
| The detail's *Used by* lists visible references; the delete refusal counts all and names the visible ones | R-8 |
| Move-many, folder counts, folder delete (hidden files re-homed), permalink conflict | R-9, R-10, R-11 |
| Attaching an existing file asks the library first (`assetReadPort.visibleToCaller`) | R-13 |

**A defect found and repaired on the way.** `findReferencesMany` attributes nothing, because no
descriptor sets the hidden `__assetId` it keys on (research F-8). The recursive folder delete
therefore soft-deletes files that Tasks, Projects, products and pages still use. R-6 makes every
descriptor tag its hits and batch, which the design needs anyway.

**Facts that change the spec's assumptions.** These are measured, not ruled, and are listed under
*Amendments* below:
- FR-009a's platform-axis route does not remove references (R-14).
- CRM has no assignment-scoped visibility (R-15).

**Dependencies.** No new runtime dependency and no schema change. `assets_library` gains one
manifest edge, onto `admin_roles` (non-deactivatable).

Decisions: [research.md](./research.md). Model: [data-model.md](./data-model.md).
Interfaces: [contracts/](./contracts/). Proof per story: [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM

**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod — no new runtime dependency

**Storage**: PostgreSQL. No migration in any module (data-model.md §1). Nothing is cached in Redis.

**Testing**: vitest:
- co-located unit tests in `packages/modules/assets_library/src/backend/` for the registry,
  `AssetVisibility` and the route guard;
- one co-located test per restricted owner (`tasks`, `projects`, `crm`);
- `backend/test/{integration,contract,perf}/assets_library/`;
- the extended attachment tests of Tasks, Projects and CRM.

Integration tests run against real `tasks`, `projects`, `crm`, `catalog`, `cms`, `blog`,
`megamenu`, `organizations` and `admin_roles`.

**Target Platform**: the existing backend (API process). There is no worker change, no admin UI
change and no storefront surface.

**Project Type**: extends one module package, `assets_library`. It also changes `contracts`, the
three restricted owners and the four unrestricted contributors, each listed in
`contracts/foreign-module-changes.md`.

**Performance Goals**:
- SC-004: a 50-asset page, each asset with 3 references of different kinds, alongside 2 000
  hidden attachments: p95 < 1 s for a restricted reader, and ≤ 1.2 × the wildcard reader's p95
  (the wildcard path is today's code path).
- FR-014: a constant number of owner calls per request, never one per asset.

**Constraints**:
- **Leak-free:** not-found identical to a missing id — status, code, message and body (FR-012).
- **Integrity:** the deletion guard still counts every reference (FR-008).
- **XVII:** owner switch-off is fail-closed and reversible with no write (FR-009).
- **Ports:** the module-facing ports are unchanged in meaning (R-1).
- **Languages:** no new user-facing string. Docs in English and Polish.

**Scale/Scope**:
- 5 user stories;
- 20 library admin routes reviewed: 10 by-id routes get the guard, 4 routes get reader-aware
  results;
- 3 owners' attach routes changed;
- 14 reference descriptors touched in 7 modules (3 restricted, 11 attribution-only).

## Constitution Check

*GATE: evaluated before Phase 0 and re-checked after Phase 1. The verdict is at the end of this
section.*

| Principle | Before Phase 0 | After Phase 1 | How this design meets it |
| --- | --- | --- | --- |
| **I. Modular (NN)** | PASS | PASS | Each owner decides its own records' visibility inside its own module, over its own tables (FR-002). The library never reads another module's table (`check:module-boundary`). The seam is the existing `assetReferenceRegistry` contribution plus one method on the library's own `assetReadPort`. |
| **II. API-first** | PASS | PASS | The contract changes (`contracts/src/assets-library.ts`) land first, in the Foundational phase, and are additive. No HTTP schema changes; `contracts/admin-api.md` is normative for behaviour. |
| **III. TDD (NN)** | PASS | PASS | Every story opens with the failing test in `quickstart.md` §1. Two of them fail on today's tree for a reason independent of the feature (F-8), which proves they test something. Each FR maps to a test there. |
| **IV. YAGNI / deps** | PASS | PASS | No dependency, no table, no cache, no new permission. Rejected: a reference index table, a per-admin cache, per-owner visibility ports, a new `see_all` permission (R-2, R-3, R-5). |
| **V. TypeScript** | PASS | PASS | Strict. New shapes are TypeScript interfaces in `contracts` (descriptor and port; they are not wire data, so no Zod). |
| **VI. Naming (NN)** | PASS | PASS | `AssetVisibility`, `requireVisibleAsset`, `readerRestriction`, `visibleToCaller` — the module's existing vocabulary. No table, setting or permission names. |
| **VII. SEO / perf** | N/A | N/A | No storefront change; public asset routes are untouched. Admin targets are under Performance Goals. |
| **VIII. English (NN)** | PASS | PASS | Polish only in the docs translation. |
| **IX. UI reuse** | N/A | N/A | No UI change: the picker and the drawer are API clients, and invariant I-1 keeps the drawer's delete rule right (R-8). |
| **X. Queue consumers** | N/A | N/A | No worker. The retention sweeper stays a system reader (FR-011). |
| **XI. Tenancy (NN)** | PASS | PASS (stronger) | Assets stay `@GlobalEntity`. The rule rides on each owner's tenant-aware predicate (Projects' reach, CRM's scoped EntityManager), so a scoped administrator stops seeing other Organizations' attachments in the library (R-15). Not-found-identical tests per kind (quickstart US1). No "no-organization" path: a caller with no admin and no system marker sees no restricted record (R-3). |
| **XII. Channel scoping (NN)** | N/A | N/A | Assets carry no Sales Channel. |
| **XIII. Command Bus (NN)** | PASS | PASS | No new write path. The one new write (re-homing hidden files on folder delete) joins the existing folder-delete flush and its audit row, gaining `rehomedAssetIds` (R-10). `check:command-coverage` is expected clean. |
| **XIV. Extensibility** | PASS | PASS | A future restricted owner — including an overlay — declares `readerRestriction` and the library needs no change. An old-style descriptor still works (`ports.md` §1). |
| **XV. Overlay** | PASS | PASS | Overlays contribute descriptors on the same terms; nothing requires editing core. |
| **XVI. Palette** | N/A | N/A | No new screen or action. |
| **XVII. Toggleable (NN)** | PASS | PASS | No activation control changes. An owner switched off: its references hide the files from every non-wildcard reader (Q1 = A) and still block deletion. The owner's code is not called while it is off (R-4). Presence is read per request, so switching back on restores everything with no restart and no write (SC-005). Contribution hooks stay probe-free (`module-activation.md` item 3). The owner-off test covers `tasks`, `projects` and `crm`. |

**Other gates.**
- **Module checklists** (`specs/conventions/module-composition.md`):
  - one new edge, `assets_library → admin_roles` (`dependencies`, non-deactivatable owner);
  - no port call wrapped in a `catch`;
  - descriptors still pushed from contribution-only hooks.
- **Admin surfaces** (`module-admin-surfaces.md`): no permission code, gate, palette action or nav
  entry changes.
- **Migrations:** none.
- **i18n:** no new string.
- **Docs:** `assets-library` page in English and Polish. One sentence each in `tasks`, `projects`
  and `crm`.
- **Release intent** (`release-intent.md`), one changeset per meaning:
  - `@endora-commerce/contracts` **minor** (additive descriptor shape, a new `AssetReadPort` method);
  - `@endora-commerce/mod-assets-library` **minor** (reader-aware admin API, repaired recursive
    folder delete);
  - `mod-tasks`, `mod-projects`, `mod-crm` **minor** (restriction, attach check);
  - `mod-catalog`, `mod-cms`, `mod-blog`, `mod-megamenu` **patch** (attribution, batching).
- **Infrastructure:** no new service.

**Post-design re-check (after Phase 1)**: no violation. Complexity Tracking lists the choices a
reviewer may question; none is a constitutional exception.

**Constitution Check verdict: PASS.**

## Amendments from planning (2026-10-29)

These are facts measured during `/speckit.plan`, not owner rulings. The owner acknowledged
items 1–5 on 2026-10-29 and they are applied to `spec.md`; item 6 is noted in the spec's Edge Cases.
The integrity bug F-8 was filed as #535 and is hot-fixed on master separately; R-6 remains the
full batched fix.

1. **FR-009a, second route (R-14, F-22).** A module disabled on the platform axis, or
   soft-uninstalled, is **still composed** and still reports its references, so its files stay
   hidden and protected, exactly as under FR-009. Only removing the module from the composed set
   makes them "used by nothing": `module:uninstall --hard` followed by removing the package, or an
   instance built without it.
   - Proposed wording: "remove the module from the deployment's composed module set (uninstall it
     and remove its package)".
   - The design needs no change.
2. **FR-002 (CRM) and US1 scenario 6 (R-15, F-18).** CRM has no "assigned to me only" visibility.
   An Opportunity is visible to holders of `crm:read` whose Organization reach includes its
   Organization.
   - Proposed wording: "CRM: Organization reach and `crm:read`".
   - Scenario 6: "an administrator whose Organizations exclude the Opportunity's Organization".
3. **Edge case "Bulk actions" (R-9).** A hidden id in move-many is skipped exactly like a missing
   id, which is today's behaviour for missing ids. It is not a 404 for the whole request. Confirm
   the wording "never partially applied" means "the hidden file is never touched".
4. **Edge case "The library's own folders" (R-10).** Deleting a folder moves the files the deleting
   reader cannot see into its parent folder, so the folder answers as empty.
5. **FR-004 "totals" (F-2, R-12).** The list API has no total. The only counts are the folder
   permalink count and the folder-not-empty message, both reader-aware. The storage page's two
   operational counts stay library-wide unless the owner says otherwise.
6. **FR-010 consequence (F-16).** The wildcard holder sees attachments of **drafts** in the library,
   although Tasks shows a draft only to its Creator, wildcard included. This follows from Q2 = A as
   ruled; it is noted, not changed.

## Project Structure

### Documentation (this feature)

```text
specs/166-asset-reference-visibility/
├── spec.md
├── plan.md                     # this file
├── research.md                 # 23 facts, 17 decisions
├── data-model.md               # no schema change; the in-memory rule
├── quickstart.md
├── contracts/
│   ├── ports.md                # descriptor, registry, assetReadPort, edges
│   ├── admin-api.md            # route-by-route behaviour
│   └── foreign-module-changes.md
├── checklists/
└── tasks.md                    # /speckit.tasks output, not created here
```

### Source Code (repository root)

```text
packages/contracts/src/assets-library.ts (+ assets-library.test.ts)

packages/modules/assets_library/
├── src/manifest.ts                                   # dependencies += 'admin_roles'
├── docs/assets-library/index.md                      # "Who sees which files" (+ Polish copy under docs/i18n/pl/)
└── src/backend/
    ├── index.ts                                      # wires permissionService (lazy) and effectiveState.isPresent; AssetReadService gets AssetVisibility
    ├── plugin.ts                                     # constructs AssetVisibility; hands it to service, folders and routes
    ├── routes.admin.ts                               # requireVisibleAsset on 10 routes; caller passed to list/detail/delete/move-many/folders
    ├── routes.admin.guard.test.ts                    # new — every :id route is guarded
    └── services/
        ├── asset-visibility.ts (+ .test.ts)          # new — caller, hiddenAmong, exclusionFor, visibleReferences, assertVisible
        ├── reference-registry.ts (+ .test.ts)        # attribution by assetId, per-asset fallback; descriptor partition
        ├── assets-library.service.ts                 # listAssets exclusion; detail/softDelete filtered names; moveMany skip; permalink holder redaction
        ├── folders.service.ts                        # permalink count; re-home on delete; real recursive reference check
        └── asset-read-port.ts                        # visibleToCaller

packages/modules/{tasks,projects,crm}/src/backend/
├── services/*-asset-references.ts (+ .test.ts)       # readerRestriction, assetId
├── services/*attachment-service.ts                   # visibleToCaller in add()
├── services/owner-read-permissions.ts                # tasks:read / crm:read check
└── index.ts                                          # boot hook passes getters

packages/modules/{catalog,cms,blog,megamenu}/src/backend/services/*asset-references.ts   # assetId; one statement per batch

backend/test/integration/assets_library/{reference-visibility,reference-visibility-owner-off,folder-delete-references}.test.ts
backend/test/integration/{tasks,projects,crm}/attachments.test.ts
backend/test/contract/assets_library/{admin-folders,admin-soft-delete}.contract.test.ts
backend/test/perf/assets_library/reference-visibility.perf.test.ts
.changeset/*.md
```

**Structure Decision**: the layout every module in `packages/modules/` has. The evaluation lives in
one new library service, `AssetVisibility`, which the routes, the folder service and
`AssetReadService` share. The rule therefore has one implementation, as `TaskVisibility` is
Tasks' one read path.

## Implementation phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 1 · Setup | Contract shapes (`ports.md` §1, §3); `assets_library` manifest edge; changesets | Workspace type-checks and builds; `manifests:generate` committed |
| 2 · Foundational | Registry attribution and fallback (R-6, repairs F-8); every in-tree descriptor tags `assetId`, and the three loops become single statements; `AssetVisibility` with its unit tests; the three owners' `readerRestriction` with complement tests; `requireVisibleAsset` and its structural test | `reference-registry.test.ts`, `asset-visibility.test.ts`, the owners' complement tests, `routes.admin.guard.test.ts`; the existing cms, blog and megamenu reference tests green |
| 3 · US1 + US3 (P1) | Guard on the 10 routes; list exclusion; detail filtering; permalink redaction; move-many skip; `visibleToCaller` and the three `add()` changes | `reference-visibility.test.ts` (US1 and US3 blocks); the three attachment tests |
| 4 · US2 (P1) | No new code expected — the unrestricted and rescue paths are proved | `reference-visibility.test.ts` (US2 block) |
| 5 · US4 (P2) | Delete refusal names; folder permalink count; folder delete re-home and real recursive check | `folder-delete-references.test.ts`; extended contract tests |
| 6 · US5 (P2) | Owner-off branch proved per owner | `reference-visibility-owner-off.test.ts`; extended `tasks/off-state.test.ts` |
| 7 · Polish | Perf test and numbers recorded in `tasks.md`; docs in English and Polish; full check sweep; an independent review of the leak paths (every by-id route, list, folders, errors) | The `quality` job's set, run locally (`quickstart.md` §3) |

**Dependencies between phases.**
- Everything depends on Phase 2.
- US1 and US3 share the guard and the detail filter, so they go together.
- US2 can run in parallel with Phase 3 once Phase 2 is in.
- US4 needs Phase 2's registry repair.
- US5 needs Phase 3.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| A route forgets the rule (a later by-id route, a new count) | One guard as a preHandler; a structural test over `routes.admin.ts`; the table-driven not-found-identity test covers every route in `admin-api.md` §1; an independent review in Phase 7 |
| An owner's hidden-asset enumeration is not the exact complement of its visible set (e.g. a NULL in the predicate) | The contract says `(…) is not true`; a complement test per owner over seeded edge rows (Tasks' NULL `context_id`) |
| SC-004 missed on the root folder, where every attachment lands | Bounded evaluation (R-5): candidates narrowed by the list's own `where`; batched descriptors (R-6). The perf test gates it. Fallback: memoise each owner's scope per request |
| Repairing `findReferencesMany` changes behaviour someone relied on | It only makes the recursive folder delete refuse what was always meant to be refused. `grep findReferencesMany` in `backend/test/**` before finishing; release note in the `mod-assets-library` changeset |
| Turning the jsonpath loops into one statement changes their results | The existing `cms-body-scan`, `asset-reference-while-off` (cms, blog) and megamenu scanner tests run before and after; a two-asset attribution case is added to each |
| An owner's visibility code resolves a gated port while that owner flips off mid-request | The library decides presence first (R-4); if the flip lands between the presence read and the call, the request answers 503 `MODULE_DISABLED`. It is never caught (`check:port-catches`) |
| A hard uninstall that leaves the package composed points a descriptor at dropped tables | Pre-existing, documented by D-159 §7 (remove the package after `--hard`). Recorded in R-14; not changed here |
| Tests that use a full-permission admin keep passing and prove nothing | The quickstart's reader matrix (A, B, S, W, N) is required in every new integration file; the wildcard reader is the control, never the subject |

## Complexity Tracking

No constitutional violation needs justifying. The table lists the choices a reviewer is entitled
to question.

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Three methods on the restriction instead of one | The list needs an SQL pre-filter (`assetIdsWithHiddenReferences`); a switched-off owner must be answered without running its code (`allReferencedAssetIds`) | One `visibleEntityIds` alone forces filter-after-fetch, with unbounded page scans and a timing signal (R-5) |
| Batching the three jsonpath descriptors in catalog, cms and blog | The rescue step asks unrestricted descriptors about many assets at once; the contract already requires one statement | Keeping the loops makes the root-folder page cost three scans per hidden candidate |
| Re-homing hidden files on folder delete | A folder that only hides files must answer as empty (FR-012) | Refusing leaks existence; deleting the file is impossible (it is referenced) |
| A new required method on `assetReadPort` | FR-006 needs every owner's answer combined, which only the library holds; `check:port-shape` forbids an optional one | Each owner asking the registry would be three copies of the rule |
| Repairing `findReferencesMany` inside this feature | The design's batched questions depend on it, and SC-003 covers the folder delete it breaks | A separate fix first would touch the same 14 descriptors twice |
