# Implementation Plan: Task management — growing the Tasks module

**Branch**: `165-task-management` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/165-task-management/spec.md`. The owner's rulings of 2026-10-28 were Q1 = B, Q2 = A and Q3 = A.

## Summary

The existing `tasks` module (`@endora-commerce/mod-tasks`, `specs/163-projects-and-tasks/`) grows into a ClickUp-like Task module. The table below gives each capability and where it is decided.

| Capability | Decided in |
| --- | --- |
| Several assignees | R-2 |
| Operator-defined statuses with permitted transitions, grouped into categories open, done and cancelled | R-1 |
| Priorities and tags | R-9, R-10 |
| A rich description resolved per reader (#446) | R-4, R-5 |
| Comments with mentions | R-6 |
| Attachments | R-7 |
| Custom fields | R-8 |
| Sub-tasks and related Tasks | R-15 |
| Links to Opportunities, Orders and Quote Requests, with a Tasks panel on each | R-16 |
| A board beside the list, the choice remembered per user | R-11, R-14 |
| Saved filters | R-13 |
| Reminders and an opt-in daily digest | R-17, R-18 |
| Drafts, and private Tasks readable through `tasks:see_private` | R-3 |
| Idempotent Stage Task creation and a sweep that removes orphaned Tasks (#450) | R-19 |

**Patterns copied, not invented.**
- The status workflow, tags and board follow CRM.
- Comments, references, attachments and mentions follow Projects.
- Saved views follow feature 147.
- Reminders follow CRM's 60-second sweep.
- The visibility seam is 163's. It is extended with the draft and private rules, so every reader, including other modules' ports, honours them through one predicate.

**Changes in other modules.** These are the only ones.
- The reference grammar gains `opportunity` and `project` everywhere. CRM and Projects widen one check constraint each and gain resolvers.
- Two CRM components (`TagPicker`, `MoveToMenu`) are promoted to admin-kit.
- Projects uses `sourceKey` and `existingContexts`.
- Custom fields gains the `task` host.
- Admin preferences gains `listViewModes`.

**Dependencies.** No new runtime dependency. The tasks package gains peers that the workspace already uses: `bullmq`, `ioredis` and `@endora-commerce/email-components`.

Decisions: [research.md](./research.md). Schema: [data-model.md](./data-model.md).
Interfaces: [contracts/](./contracts/). Proof per story: [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM

**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, BullMQ, ioredis (backend); React 19 + react-router-dom 7 through `@endora-commerce/admin-kit` (KanbanBoard, StatusTransitionGraph, ReferenceField/TipTap, CommentThread, AttachmentUploader, SavedViewsControl, CustomFieldValuesPanel) — **no new runtime dependency**

**Storage**: PostgreSQL. The `tasks` module alters 1 table and adds 15 more (9 owned by a Task, 6 configuration and per-admin). CRM and Projects get one constraint migration each. Redis carries one Job Scheduler queue, `tasks-reminders`.

**Testing**: vitest:
- co-located unit tests (graph, cursor, visibility SQL, due-moment arithmetic);
- `backend/test/{contract,integration,perf}/tasks/`;
- the extended `backend/test/integration/projects/` and `…/crm/` tests;
- `admin/test/modules/tasks/`;
- admin-kit tests for the promoted components.

Integration tests run against real `crm`, `orders`, `quote_requests`, `projects`, `custom_fields`, `assets_library` and `transactional_emails`.

**Target Platform**: the existing backend (API plus `BACKEND_ROLE=worker`) and the admin SPA. There is no storefront surface (FR-044).

**Project Type**: the work extends one module package. It also changes contracts, admin-kit, `crm`, `projects` and `custom_fields`, each listed in `contracts/foreign-module-changes.md`.

**Performance Goals**:
- List page and board under 2 s with 5 000 visible Tasks (SC-002).
- A reminder is delivered within 2 min of its moment (SC-004).
- A tick with nothing due enters no scope.

**Constraints**:
- **Visibility:** one predicate covers context, draft and private (XI, R-3). Every write is a Command (XIII). Disabled means absent (XVII).
- **Module independence:** `tasks` names no Project concept (163 R-1). `crm`, `orders`, `quote_requests` and `projects` behave identically without `tasks`.
- **Languages:** English and Polish for every string and doc.

**Scale/Scope**: 10 user stories, about 70 endpoints (40 new), 8 admin routes, 3 zones, 3 new palette actions and one worker with three passes.

## Constitution Check

*GATE: passed before Phase 0 and re-checked after Phase 1. The verdict is at the end of this section.*

| Principle | Verdict | How this design meets it |
| --- | --- | --- |
| **I. Modular (NN)** | PASS | Every new table, service, route, worker, i18n key and doc belongs to `tasks`. Other modules are reached only through published ports (`opportunityReadPort`, `quoteRequestReadPort`, `orderReadPort`, `catalogProductReadPort`, `projectReadPort`) and registries (asset references, admin search, `taskContextRegistry`). Projects is reached through the opaque context, including the new optional `existingContexts`. CRM's and Projects' own changes are their own migrations and resolvers (`foreign-module-changes.md`). |
| **II. API-first** | PASS | `contracts/src/tasks.ts` and the other contract files change in the Foundational phase, before any route. `contracts/admin-api.md` is normative. |
| **III. TDD (NN)** | PASS | Every story opens with the failing test named in `quickstart.md` §1. The migration test, written first, proves 163's data survives. |
| **IV. YAGNI / deps** | PASS | No new dependency. Rejected: per-Project workflows, a message thread, watchers, time tracking, dependencies, automations, an e-mail outbox (R-17), a generic saved-views service and a generic tags module. |
| **V. TypeScript** | PASS | Strict, with every body, query, event and job payload in Zod. |
| **VI. Naming (NN)** | PASS | Tables are prefixed `task_*`. The queue is `tasks-reminders`. Settings use the `tasks.*` prefix and permissions `tasks:*`. Migration classes carry the `Tasks` tail. |
| **VII. SEO / perf** | N/A | No storefront. The admin targets are under Performance Goals. |
| **VIII. English (NN)** | PASS | Polish appears only in i18n bundles, seeded names and the Polish doc. |
| **IX. UI reuse** | PASS | Every collaboration component is the kit's. `MoveToMenu` and the tag components are **promoted** at their second consumer, and CRM moves onto them (R-10, R-11). New module-local pieces: `TasksPanel`, `SubtasksSection`, `RemindersSection`, `LinkedRecordsSection`, `DigestControl`, and the board card. |
| **X. Queue consumers** | PASS | One data-less Job Scheduler, `concurrency: 1`, `ctx.worker`, only where `processRunsWorkers`. Each pass is idempotent through unique delivery rows, day claims or idempotent deletes. The `scheduled-work-probe` copy and its drift test are in place. |
| **XI. Tenancy (NN)** | PASS, with 163's stated compensation | The child tables are `@RuleScoped` and read only through `TaskVisibility`. Configuration and per-admin rows are `@GlobalEntity`. Compensation: a new **seam test**, plus not-found-identical tests for private, draft and context Tasks on every read route, port, lookup, panel, search and notification. The sweeps use `enterSystemScope` with a reason and re-check each recipient with `canSeeAs` and the permission. |
| **XII. Channel scoping (NN)** | N/A | Tasks carry no Sales Channel. |
| **XIII. Command Bus (NN)** | PASS | Every write is a named Command (`data-model.md` §7). Delivery rows and digest claims are `command-coverage-ignore` with a reason, following the CRM and Projects precedent. Status and priority reassignment write per-Task audit rows inside the configuration Command (R-1, with a fallback). |
| **XIV. Extensibility** | PASS | *Task* becomes a custom-field host (R-8). The descriptor extension names no contributor. |
| **XV. Overlay** | PASS | Overlays can register their own Task contexts, read `TaskReadPort`, and subscribe to the events. Nothing requires editing core. |
| **XVI. Palette** | PASS | Three new actions on real routes, each with its route's permission (`admin-surfaces.md` §4). |
| **XVII. Toggleable (NN)** | PASS | The module keeps its activation. New edges are `degrades-without` on `crm`, `quote_requests` and `projects` (each with `whenAbsent`), and `dependencies` only on non-deactivatable modules. The zones, the worker and the panels gate on presence. The off-state tests are extended. Projects' existing `degrades-without` edge on `tasks` is unchanged, so Tasks stays switchable. |

**Other gates.**
- **Docs:** `packages/modules/tasks/docs/tasks.md` (users and developers) and its Polish copy grow per story. CRM's and Projects' docs gain the two reference kinds.
- **Release intent:** changesets for contracts (breaking events and statuses), admin-kit (minor), mod-tasks (major) and mod-crm / mod-projects / mod-custom-fields (minor).
- **Infrastructure:** no new service.

**Post-design re-check (after Phase 1)**: no violation. The XI compensation, the promotion and the reference-kind widening are recorded in Complexity Tracking.

**Constitution Check verdict: PASS.**

## Amendments from planning (2026-10-28)

These are facts measured during `/speckit.plan` (research.md). They are not owner rulings, and they are reflected in the spec's wording at `/speckit.tasks` time.

- **SC-004** "exactly once" holds for the Admin UI notification. The e-mail is **at most once**: a crash between commit and send loses the e-mail while the bell entry stays (R-17).
- **US7 scenarios 2 and 6 contradict each other** for a long switch-off. One rule resolves them: a reminder overdue by less than 24 h is delivered once; an older one is recorded as expired and not sent (R-17).
- **The digest hour and date-only due dates** use a new `tasks.time_zone` setting (default `Europe/Warsaw`). The spec said "platform time zone"; the analytics reporting time zone was rejected because `analytics` is switchable and falls back to UTC (R-17).
- **FR-011:** an operator deleting a tag records one audit row on the tag with its usage count, not one row per Task. This is CRM's precedent (R-10).
- **FR-005:** to keep one reference grammar, `opportunity` and `project` become referenceable **in CRM and Projects too**, not only in Tasks (R-5). This follows the owner's 2026-10-26 standardisation ruling.

## Project Structure

### Documentation (this feature)

```text
specs/165-task-management/
├── spec.md
├── plan.md                     # this file
├── research.md                 # 17 facts, 23 decisions
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api.md
│   ├── ports-and-events.md
│   ├── admin-surfaces.md
│   └── foreign-module-changes.md
├── checklists/requirements.md
└── tasks.md                    # /speckit.tasks output, not created here
```

### Source Code (repository root)

```text
packages/contracts/src/{tasks,record-references,crm,projects,custom-fields,saved-list-views,admin-preferences}.ts

packages/modules/tasks/
├── i18n/{en,pl}.json, docs/tasks.md (+ docs/i18n/pl copy)
└── src/
    ├── manifest.ts                          # permissions, settings, edges, errorCodes, actions, transactionalEmails
    ├── migrations/<stamp>_tasks_task_management.ts
    ├── backend/
    │   ├── index.ts                         # all composition (check:port-dependencies reads only this file)
    │   ├── domain/{task-status-graph, due-moment, list-cursor, board-card-fields, hierarchy}.ts   # pure
    │   ├── entities/                        # task (altered) + 15 new
    │   ├── services/
    │   │   ├── task-visibility.ts (extended), task-access.ts (new: assertMayChange)
    │   │   ├── task-service, task-commands, task-transition-service, workflow-config-service,
    │   │   ├── priority-service, tag-service, assignee-service, hierarchy-service, relation-service,
    │   │   ├── record-link-service, comment-service, mention-service, reference-service,
    │   │   ├── owner-read-permissions, attachment-service, attachment-active-content (copy),
    │   │   ├── task-asset-references, custom-field-host, board-service, board-card-field-service,
    │   │   ├── saved-view-service, reminder-service, digest-service, maintenance-service,
    │   │   ├── scheduled-work-probe (copy), time-zone-validator (copy), task-notifier (extended),
    │   │   └── task-read-port, task-write-port (extended)
    │   ├── routes/routes.{tasks,board,workflow,priorities,tags,collaboration,lookups,views,digest,settings}.ts
    │   ├── workers/tasks-reminders-worker.ts
    │   ├── email-templates/{reminder,digest}-defaults.ts
    │   └── demo/{rows,seed,reset}.ts
    └── admin/
        ├── index.ts, api.ts
        ├── pages/{TasksPage, MyTasksPage, TaskCreate, TaskDetail, settings/{TaskWorkflowPage, TaskTagsPage, TaskPrioritiesPage, TaskGeneralSettingsPage}}.tsx
        ├── components/{TaskBoard, TaskCard, TaskFilters, SubtasksSection, RemindersSection, LinkedRecordsSection, RelatedTasksSection, DigestControl, …}.tsx
        └── zones/{TasksPanel, OrderTasksPanel, QuoteRequestTasksPanel, OpportunityTasksPanel}.tsx

packages/admin-kit/src/components/{tags/, kanban/MoveToMenu.tsx, references/}, src/lib/admin-preferences/
packages/modules/crm/…        # kit imports, read port, references (+ migration)
packages/modules/projects/…   # stage tasks (#450), descriptor, read port, references (+ migration), TasksTab
packages/modules/custom_fields/…   # task host
packages/demo-composition/src/projects.ts

backend/test/{contract,integration,perf}/tasks/, backend/test/integration/{projects,crm}/
admin/test/modules/tasks/
*.generated.*, pnpm-lock.yaml, .changeset/*.md
```

**Structure Decision**: the layout every module in `packages/modules/` has, composed in the one `src/backend/index.ts`.
- **Schema:** the whole `tasks` schema lands in the Foundational phase in one migration, so stories never regenerate the registries and parallel stories do not collide on generated files.
- **Shared hot files:** these are rebased by adding lines: `index.ts`, `manifest.ts`, `admin/index.ts`, `admin/api.ts`, the i18n bundles, `docs/tasks.md`, `contracts/src/tasks.ts` and the off-state tests.

## Implementation phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 1 · Setup | Contract skeletons; manifest additions (permissions, settings, edges, emails); changesets; `CommandBus` multi-audit check (R-1) | Workspace type-checks and builds; generated artefacts current |
| 2 · Foundational | The migration, entities and seeds; statuses as codes everywhere (contracts, Projects, demo, tests); assignees as a list everywhere; `TaskVisibility` with draft/private and `TaskAccess`; seam test; off-state baseline; R-12 cursor | Migration test, seam test and the full existing tasks and Projects suites green on the new shape |
| 3 · US1 (P1) | Rich description and references (#446) with the grammar extension in tasks, CRM and Projects; mentions; priority; tags (assign); custom fields host; attachments; due time and start date; extended history | `task-fields.test.ts`, `attachments.test.ts`, CRM and Projects reference tests |
| 4 · US2 (P1) | Workflow configuration (API and page), transition service, reassignment, Projects gate on categories | `workflow.test.ts` |
| 5 · US3 (P1) | Board endpoint and page, `MoveToMenu` promotion, card fields, list sorts and filters, saved views, `listViewModes` | board contract test, saved views, view-mode test |
| 6 · US4–US6 (P2) | Comments · hierarchy and relations · links and the three zones, with the `opportunityReadPort` and `projectReadPort` additions | each story's test |
| 7 · US7 (P2) | Worker; reminders; digest; two e-mail templates; time-zone setting | `reminders.test.ts`, `digest.test.ts` |
| 8 · US8–US9 (P3) | Draft and publish; private and `tasks:see_private` across every surface; tag and priority screens; tag component promotion | `draft-private.test.ts`, `tags-priorities.test.ts` |
| 9 · US10 (P3) | `sourceKey` in the write port and Projects; `existingContexts`; maintenance pass | stage-tasks and maintenance tests |
| 10 · Polish | Docs EN and PL (tasks, crm, projects); demo step; palette; perf test; full check sweep; designer review of board and detail; independent review of the visibility path | the `quality` job's set, run locally |

**Dependencies between phases.**
- Everything needs Phases 1 and 2.
- US2 must precede US3, because the board's columns are the workflow.
- US4 needs the reference work of Phase 3.
- US7 is independent of US3 to US6.
- US8's visibility predicate is in Phase 2. Phase 8 adds the UI and the write paths.
- US10 is independent after Phase 2.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| A read path forgets the draft or private rule (another module's port, search, a panel, a notification) | One predicate in `TaskVisibility`; the seam test; the not-found-identical test matrix in `draft-private.test.ts`; an independent reviewer pass on the visibility path in Phase 10 |
| Statuses becoming codes and assignees becoming a list break Projects, the demo or tests outside `tasks` | Done in Phase 2 alone, with the complete consumer list from the planning sweep (`foreign-module-changes.md` §G); all existing tasks and Projects suites must be green before any story starts |
| Widening the reference grammar breaks CRM or Projects storage | Their check migrations land in Phase 3 with the grammar change in the same commit; tests paste an `[[opportunity:…]]` token into CRM and Projects text; the `down` migrations are tested |
| Writing the bell entry and the delivery row in one transaction needs the notification port to share the caller's transaction | Checked in Phase 7 before the worker is written. Fallback: delivery row first, bell second, with the notification's own `subjectId` + `kind` + recipient de-duplication, accepting a lost bell on a crash in between |
| The reassignment Command writing many audit rows | Bounded at 5 000; the fallback is batched Commands under one lock (R-1) |
| The board's per-column queries multiply the visibility pre-filter | The scope is computed once per request and reused for every column; measured in the perf test |
| Promoted CRM components regress CRM | CRM's admin tests run before and after; no behaviour change is allowed; grep tests for the old paths |
| Generated artefacts stale; recorded read sizes move | `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` close Phases 1, 2 and 7; drift inside a band is left to the release PR |

## Complexity Tracking

No constitutional violation needs justifying. The table lists choices a reviewer is entitled to question.

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Status codes by value with a category, not an FK | Keeps 163's rows untouched, the CRM and Orders precedent, and the gate's meaning | An FK rewrites every row and adds nothing the graph check does not give |
| Reassign on status removal (CRM and Orders refuse) | Spec FR-016 | Refusing forces operators to move Tasks one by one |
| Opportunity and Project references platform-wide | One shared token grammar (F-8); the owner's standardisation ruling | A Tasks-only kind crashes CRM and Projects on paste |
| Two components promoted from CRM | Second consumer (IX); 163 precedent | A copy diverges, and the a11y `MoveToMenu` is the kind of component that must not |
| A new admin-preference key | FR-018 across devices; the closed set is by design | `localStorage` is per device |
| Its own digest table instead of a preference | The worker must find subscribers by SQL | Preferences are keyed per admin and read per request |
| A third copy of `attachment-active-content.ts`, `scheduled-work-probe.ts` and the time-zone validator | The platform surface is deliberately narrow (163 R-17); the probe copy has a drift test | Publishing helpers under 60 lines widens a guarded surface |
| 15 new tables | Each carries one requirement and one constraint the design relies on (unique delivery, name uniqueness, hierarchy, link uniqueness) | Merging loses those constraints |
