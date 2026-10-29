# Implementation Plan: Projects, with a first version of Tasks

**Branch**: `163-projects-and-tasks` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/163-projects-and-tasks/spec.md` (owner's rulings of
2026-10-26: Q1 = C, Q2 = A, Q3 = A, Projects do not require Tasks)

## Summary

Two new operator-toggleable domain modules:

- **`tasks`** (`@endora-commerce/mod-tasks`) — a deliberately small first version: Tasks with a
  number, title, description, assignee, due date and four statuses; a Tasks list, *My Tasks*, a
  detail screen; and an **opaque context** (`contextType`/`contextId`/`contextGroupId`) through
  which any module can own Tasks without `tasks` knowing it exists. Visibility of contextual Tasks
  is answered by the context's owner through an ungated **`taskContextRegistry`**, fail-closed.
- **`projects`** (`@endora-commerce/mod-projects`) — Projects for zero or more Organizations,
  Members holding Project Roles, per-Project Stages with a configurable move graph, an optional
  completion gate, Stage Task definitions, deadline alerts; Templates copied into new Projects;
  links to Orders, Quote Requests and Opportunities with a "which Project" panel on each of
  their screens and on a Task's; notes, messages, references, attachments, history; Custom
  Fields; analytics with lost-Project reporting.

`projects` binds **no** toggleable module: Tasks, CRM, Quote Requests and Admin notifications
are `degrades-without` edges. Orders, the asset library, Custom Fields and the rest are
non-deactivatable and bound normally (research F-1).

Tenancy follows the only precedent for "every related Organization in scope": `@RuleScoped`
entities enforced by one module-local `ProjectAccess` choke point that combines the
Organization rule (Q1 = C) and the visibility rule (Q2 = A) into a single SQL predicate used by
every read, including analytics and the Task-context registry (R-2, R-3, R-9).

CRM's collaboration UI (reference editor, comment thread, attachments, history) is **promoted
into `admin-kit`** and CRM is moved onto it in the same feature, because this is the second
consumer CRM's own plan was waiting for (R-17). The reference grammar moves to a neutral
contracts file and gains `quote_request` and `task`, and — by owner ruling of 2026-10-26
(FR-044) — **CRM adopts the same standard**: `@@` opens one grouped document list (Orders ·
Quote Requests · Tasks) in both modules, which costs CRM one constraint-widening migration, two
resolvers, one lookup endpoint and a `degrades-without` edge on `tasks` (R-14). **No new runtime
dependency.**

Decisions with alternatives: [research.md](./research.md). Schema: [data-model.md](./data-model.md).
Interfaces: [contracts/](./contracts/). Proof per story: [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 through `@endora-commerce/admin-kit`, Tiptap v3 (already in the workspace, moved from `mod-crm` peers to `admin-kit` peers), `<EChart>` — **no new runtime dependency**
**Storage**: PostgreSQL — `tasks`: 1 table + 1 sequence; `projects`: 23 tables + 1 sequence (one FK out of the module, to `organizations`); one BullMQ Job Scheduler queue `projects-stage-alerts` on Redis
**Testing**: vitest — co-located unit tests in both packages; `backend/test/{contract,integration,perf}/{tasks,projects}/`; `admin/test/modules/{tasks,projects}/`; admin-kit component tests for the promoted components; integration tests run against the real `orders`, `quote_requests`, `crm`, `custom_fields`, `assets_library` modules (Principle III)
**Target Platform**: existing backend (API + `BACKEND_ROLE=worker`) and the admin SPA; no storefront surface
**Project Type**: two module packages in the monorepo (backend, migrations, admin layers) plus host/kit changes
**Performance Goals**: Projects list/filter < 2 s at 1 000 Projects (SC-008); each analytics figure < 2 s at 1 000 Projects; a Stage move ≤ 1 port call to `tasks` for the gate + 1 for materialisation; alert sweep ticks with nothing due enter no scope
**Constraints**: tenant isolation without an ORM filter (R-2) — compensated by a single access seam, a seam test and cross-tenant tests per read; every write a Command (XIII); disabled-means-absent for both modules (XVII); `tasks` names no Project concept; `orders`, `quote_requests`, `crm` behave identically without `projects`; English + Polish for every string and doc
**Scale/Scope**: hundreds of Projects a year, tens of Members each, ≤ 100 Stage Tasks per Stage; ~10 admin pages, ~60 endpoints, 11 user stories; every file outside the two modules is in `contracts/foreign-module-changes.md`

## Constitution Check

*GATE: passed before Phase 0 research; re-checked after Phase 1 design — verdict at the end.*

| Principle | Verdict | How this design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | PASS | Each module owns its entities, services, routes, migration, i18n, docs, tests. `tasks` knows nothing of `projects` (opaque context, R-1); `projects` reaches `tasks`, `crm`, `quote_requests`, `orders` only through published ports and registries. Both are removable: `foreign-module-changes.md` §H lists what a deletion leaves (inert seams naming no Project concept). |
| **II. API-first** | PASS | `contracts/src/tasks.ts` and `projects.ts` land in the Foundational phase before any route; `contracts/admin-api.md` and `ports-and-events.md` are normative. Shared grammar moved to `record-references.ts` with CRM's exported names kept as re-exports — no CRM API shape changes. |
| **III. TDD (NN)** | PASS | Each story starts with its failing test in `quickstart.md`; CRM's existing admin tests are the regression proof for the promotion and run unchanged before and after. |
| **IV. YAGNI & minimal deps** | PASS | No new dependency (Tiptap moves, it is not added). Rejected: a platform filter class for join-table rules, versioned Templates, per-Project time zones, webhooks, a board/Gantt, Task comments/subtasks. One queue, justified under X. |
| **V. TypeScript** | PASS | Strict; every body, query, event and job payload is a Zod schema. |
| **VI. Naming (NN)** | PASS | Module ids `tasks`, `projects` (plural nouns); tables prefixed by module (`tasks`, `projects`, `project_*`); `check:naming` on the skeletons first (T-setup). **Note**: the `tasks` table name equals the module id — CRM's precedent prefixes (`crm_opportunities`); `projects`/`tasks` as the head table of their own module is how `orders` names `orders`. |
| **VII. SEO & performance** | N/A | No storefront surface; admin targets in Technical Context. |
| **VIII. English-only (NN)** | PASS | Code, comments, specs, docs in English; Polish only in i18n bundles, seeded per-language names and the Polish doc copies. |
| **IX. UI reuse** | PASS | Reuses the kit (list in `contracts/admin-surfaces.md` §2). **Promotes** seven CRM components to the kit and moves CRM onto them (R-17) instead of creating a second copy. Module-local new components: `StageBar`, `StageEditor`, `MembersEditor`, `LinkedRecords`, `CloseProjectDialog`, `ProjectPanel`. |
| **X. Scalable queue consumers** | PASS | One Job Scheduler (`projects-stage-alerts`, every 15 min), data-less, `concurrency: 1`, `ctx.worker`, only where `processRunsWorkers`, idempotent through the unique delivery key (R-12). Everything else synchronous and bounded (R-22). |
| **XI. Multi-tenant isolation (NN)** | PASS — with a stated compensation | `Project` + all children `@RuleScoped` (F-2 forbids transitive children under a rule parent), configuration `@GlobalEntity`, `Task` `@RuleScoped` (R-9). Enforcement: `ProjectAccess` — one predicate, one loader, `orgConstraintFor()` on every path (fail-closed). Because no ORM filter backs rule-scoped rows, the plan adds (a) a seam test that fails if a route reads a Project-owned entity without `ProjectAccess`, (b) cross-tenant tests for every read route incl. panels, search, mentions, analytics, the task registry and notifications, proving not-found-identical answers. No `withOrgScope`; the sweep uses `enterSystemScope` with a reason and re-checks each recipient's reach (R-4). The internal-Project path (zero Organizations) is visible only in `all` mode — an owner ruling, not a "no-organization **customer** path", which XI forbids. |
| **XII. Sales-channel scoping (NN)** | N/A | No channel-scoped content; Projects carry no Sales Channel. |
| **XIII. Command Bus (NN)** | PASS | Every write a named Command (`data-model.md` §1, §2.4); history tab = audit read. Read markers and alert-delivery bookkeeping are `command-coverage-ignore` with reasons (CRM precedent). Cross-module Task creation is the `tasks` module's own Commands, after the `projects` Command commits (R-8). |
| **XIV. Entity-agnostic extensibility** | PASS | *Project* becomes a custom-field host through the existing registry with `ownerModuleId` (R-18). The Task context and the stage-guard registry are host seams naming no contributor. |
| **XV. Untouched core & overlay** | PASS | Overlays use `projectStageGuardRegistry`, the events, `projectReadPort`, and `taskContextRegistry` for their own Task contexts. |
| **XVI. Command palette** | PASS | Seven actions (`contracts/admin-surfaces.md` §4), each on a real route with the route's permission. |
| **XVII. Operator-toggleable (NN)** | PASS | `activation: { settingCode: 'tasks.enabled' \| 'projects.enabled', default: true }`. `projects` declares `degrades-without` on tasks / crm / quote_requests / admin_notifications with `whenAbsent` sentences and `contributes-to` on `taskContextRegistry` / `adminSearchProviderRegistry` — so neither Tasks nor CRM is deadened by Projects (the owner's "Projects without Tasks"). CRM's new edge on `tasks` (FR-044) is `degrades-without` too, so Tasks stays switchable with CRM on. Off-state tests in the Foundational phase for both modules and extended per story; `tasks` hides contextual Tasks whose owner is absent (fail-closed). |

**Other gates**: *Docs* — `tasks.md` and `projects.md` (users + developers), Polish copies, in
the Foundational phase and grown per story; README owes nothing (no new service, env var or
system requirement). *Performance & scale* — R-9 is the one cost to measure (perf test with
5 000 Projects); nothing else approaches the targets. *Infrastructure* — no new service.

**Post-design re-check (after Phase 1)**: no violation. The XI compensation and the CRM
promotion are recorded in Complexity Tracking.

**Constitution Check verdict: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/163-projects-and-tasks/
├── spec.md
├── plan.md                     # this file
├── research.md                 # 14 facts, 23 decisions
├── data-model.md               # tables, classification, settings, audit actions, events
├── quickstart.md               # story → proving test; manual walk; verification set
├── contracts/
│   ├── admin-api.md            # endpoints and schema names
│   ├── ports-and-events.md     # ports, registries, events, dependency edges
│   ├── admin-surfaces.md       # nav, routes, zones, palette, permissions, off-state
│   └── foreign-module-changes.md
├── checklists/requirements.md
└── tasks.md                    # /speckit.tasks output (not created here)
```

### Source Code (repository root)

```text
packages/contracts/src/
├── tasks.ts, projects.ts                    # NEW
├── record-references.ts, record-rich-text.ts# NEW — shared grammar (R-14)
├── crm.ts, crm-rich-text.ts                 # re-export the shared grammar, names unchanged
├── admin-contributions.ts                   # + 'work' section, + 2 zones
├── custom-fields.ts                         # + 'project'
└── index.ts

packages/admin-kit/src/components/{references,comments,attachments,record-history}/   # promoted (R-17)
packages/admin-shell/src/components/AppShell.tsx                                      # + work section
packages/modules/_i18n/i18n/{en,pl}.json                                              # + appShell.section.work

packages/modules/tasks/                      # NEW
├── package.json, tsconfig*.json, vitest.config.ts, tailwind.css, README.md, LICENSE, CHANGELOG.md
├── i18n/{en,pl}.json, docs/tasks.md
└── src/
    ├── manifest.ts
    ├── migrations/{<stamp>_tasks_init.ts, index.ts}
    ├── backend/
    │   ├── index.ts                         # all composition, one section per area
    │   ├── entities/task.entity.ts
    │   ├── services/{task-service, task-number, task-context-registry, task-visibility, task-read-port, task-write-port, task-notifier, task-history-service}.ts
    │   ├── routes/{routes.tasks.ts, routes.lookups.ts}
    │   └── admin-search-provider.ts
    └── admin/{index.ts, api.ts, pages/{TasksList, MyTasks, TaskCreate, TaskDetail}.tsx, components/}

packages/modules/projects/                   # NEW
├── (package files as above), i18n/{en,pl}.json, docs/projects.md
└── src/
    ├── manifest.ts
    ├── migrations/{<stamp>_projects_init.ts, index.ts}
    ├── backend/
    │   ├── index.ts
    │   ├── domain/{stage-graph, deadline, visibility-rule, analytics-range}.ts       # pure
    │   ├── entities/*.entity.ts             # 23
    │   ├── services/
    │   │   ├── project-access.ts            # THE tenancy + visibility seam (R-2, R-3)
    │   │   ├── project-service, project-number, member-service, stage-service, move-service,
    │   │   ├── stage-task-service, template-service, role-service, loss-reason-service,
    │   │   ├── link-service, record-project-service, comment-service, mention-service,
    │   │   ├── reference-service, attachment-service, history-service, analytics-service,
    │   │   ├── stage-alert-service, stage-alert-email, project-notifier, owner-read-permissions,
    │   │   ├── attachment-active-content, scheduled-work-probe (copy), task-context-descriptor
    │   ├── routes/routes.<area>.ts
    │   ├── workers/stage-alert-worker.ts
    │   ├── email-templates/stage-alert-defaults.ts
    │   └── demo/{rows,seed,reset}.ts
    └── admin/{index.ts, api.ts, pages/…, components/…, zones/{ProjectPanel, OrganizationProjects}.tsx}

packages/demo-composition/src/projects.ts    # demoProjectsStep (R-20)
packages/modules/crm/src/admin/…             # moved onto kit components; + opportunity.detail.after mount
packages/modules/custom_fields/…             # + project host

backend/test/{contract,integration,perf}/{tasks,projects}/
admin/test/modules/{tasks,projects}/
*.generated.* , pnpm-lock.yaml, .changeset/*.md, docs/i18n/pl/…
```

**Structure Decision**: two module packages with the layout every module in
`packages/modules/` has, composed in **one** `src/backend/index.ts` per module (CRM's
measured constraint: `check:port-dependencies` reads only that file). The whole schema of
each module lands in the Foundational phase with one init migration, so later stories never
regenerate the migration or entity registries and parallel stories do not collide on generated
files. Shared hot files (rebased by adding lines): both `index.ts`, `manifest.ts`,
`admin/index.ts`, `admin/api.ts`, the i18n bundles, `docs/*.md`, `contracts/src/projects.ts`,
the off-state tests.

## Implementation phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 1 · Setup | both package skeletons, `work` nav section, contracts files (empty exports), generated artefacts, changesets | workspace installs, type-checks and builds with both modules registered and empty |
| 2 · Foundational — Tasks | `tasks` schema + entity + manifest + activation + permissions; Task CRUD, list, *My Tasks*, detail, history; `taskContextRegistry` with fail-closed hiding; ports; `task.detail.after` zone; notifier; off-state + tenant tests; docs skeleton; R-9 perf measurement | `tasks` off-state and context-hiding tests green |
| 3 · Foundational — Projects | full `projects` schema + entities + seeds, manifest with all edges, `ProjectAccess` + seam test, Project read endpoint, off-state / migration / tenant-scope tests, docs skeleton | off-state + `organization-reach.test.ts` green |
| 4 · US1 (P1, MVP) | Project CRUD, Organizations, Members + Roles (read), Stages, moves, move/close/reopen, stage-entry history, guard registry, events; list + create + detail with Stage bar | `stage-walk.test.ts` green **with `tasks` off** |
| 5 · US2 (P1) | Stage Task definitions, materialisation, gate guard, Tasks tab, Tasks-off behaviour | `completion-gate.test.ts` |
| 6 · Shared references & UI | `record-references.ts`; promote the seven CRM components into admin-kit; move CRM onto them; CRM reference standard (FR-044): migration, resolvers, `lookups/documents`, `tasks` edge, docs | CRM's tests green (only `@@`-as-Orders assertions changed, listed); new CRM reference tests; kit tests green |
| 7–11 · US3–US7 (P2) | Templates · Roles & loss reasons screens · visibility (setting, Project options, viewers, `see_all`) · links + four panels (+ crm zone) · notes/messages/references/attachments/history | each story's test in `quickstart.md` |
| 12–14 · US8–US10 (P3) | stage alerts sweep + e-mail template · custom fields host · analytics | same |
| 15 · US11 (P3) | palette actions, global search providers, Organization panel, demo step | same |
| 16 · Polish | docs completion EN + PL, full check sweep, read-size bands, release intent, browser walk, independent review of the `ProjectAccess` path | the `quality` job's set, locally |

Dependencies: everything needs 1–3. US1 needs 3; US2 needs US1 and Phase 2. Phase 6 is
independent of US1/US2 and can run in parallel with them; US7 needs Phase 6. US3 needs US2 (for
Stage Tasks) but its non-Task part only US1. US5 needs US1; US6 needs US1 (panels need US5's
visibility to be complete before release, not before build). US8 needs US1; US10 needs US1 and
benefits from US3 (Template filter). No other ordering.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| A read path forgets `ProjectAccess` (no ORM filter behind rule-scoped rows) | single loader + single SQL predicate; `project-access-seam.test.ts`; cross-tenant tests per read route; independent reviewer pass on the tenant path in Phase 16 |
| R-9's "every visible Project id per request" is slow | measured in Phase 2 with 5 000 Projects before Projects is built on it; the two fallbacks are named in research |
| The CRM promotion or the `@@` standard regresses CRM | CRM's tests run before and after; the only assertions allowed to change are those pinning `@@` = Orders, each listed in the commit; existing stored references are a subset of the widened grammar (no data migration); the constraint migration has a tested `down`; grep `backend/test/**` and `admin/test/**` for moved paths |
| Stage Task creation fails after a move committed | the move stays; the entry records `tasks_materialize_failed`; a retry endpoint exists; the test forces the port to throw |
| A new enum member (`work`, zones, `project`) breaks an exhaustive switch or enumerating test | grep for every use before changing each enum and repair in the same change |
| Alerts sent twice or at the wrong local day | unique delivery key; clock-controlled 60-day test across a DST change in `Europe/Warsaw` |
| Generated artefacts stale | `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only` are explicit tasks closing Phases 1–3 and any phase changing imports; `overlay:check` in every verification |
| Adding ~150 files moves recorded read sizes | drift inside a band is left to the release PR; only a refused band is re-measured on a clean tree after reading `check-estate.md` |

## Complexity Tracking

No constitutional violation needs justifying. Choices a reviewer is entitled to question:

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `@RuleScoped` everywhere in `projects`, enforced in one service (XI without an ORM filter) | a Project relates to 0..N Organizations with every-Organization semantics (owner ruling Q1 = C); F-2 forbids transitive children under a rule parent | `@OrgScoped` cannot express several or none; a new platform filter class for one consumer touches six platform files and the classification rule (R-2) |
| An opaque Task context + context-access registry in `tasks` | `tasks` must stay independent and reusable, yet hide Project Tasks from non-members (FR-031) | a `project_id` column couples the modules; duplicating visibility on Tasks goes stale (R-9) |
| Promoting seven CRM components to admin-kit and moving CRM onto them in this feature | second consumer; CRM's plan named them promotion candidates; IX | a copy in `projects` leaves two 43K Tiptap editors to diverge (R-17) |
| CRM changes behaviour (`@@` = documents) inside a Projects feature | owner ruling FR-044: one reference standard, decided now so the shared editor has one trigger table | a follow-up feature would ship the kit editor with a CRM-only special case and change it again later |
| A new host nav section `work` | Projects and Tasks are not sales or CRM sub-features | placing them under `crm` hides Tasks from users without CRM and names Tasks a CRM thing (R-16) |
| Two new admin zones (`opportunity.detail.after`, `task.detail.after`) | FR-022 asks for the Project on those screens; neither has a zone | a CRM-owned "Project" panel would make CRM name Projects (R-11) |
| `project_stage_entries` beside the audit log | analytics need Stage intervals and the lost Stage as rows, by name as it was | deriving intervals from audit JSON is slow and couples analytics to another table's shape (CRM precedent) |
| Copies of four tiny backend helpers in `projects` | the platform surface is deliberately narrow; `scheduled-work-probe.ts` is copied by design | publishing them from the platform widens a guarded surface for helpers of < 60 lines (R-17) |
| 23 tables in `projects` | each carries one requirement: configuration ×7 (roles, loss reasons, Template + roles, stages, stage tasks, moves), the Project + organizations, members ×2, viewers, stages ×4 (stages, stage tasks, moves, entries), links, comments ×4 (comments, reads, read baseline, references), attachments, alert deliveries | merging loses a constraint the design relies on — e.g. unique `(record_kind, record_id)` or the alert delivery key |
