# Research: Projects, with a first version of Tasks

**Feature**: `specs/163-projects-and-tasks/` · **Date**: 2026-10-26 · **Spec**: [spec.md](./spec.md)

Each entry: **Decision**, **Rationale**, **Alternatives considered**. Where a decision rests on
something not yet proven in code it is tagged **[unverified]** and names the task that proves it
before anything is built on it. File references are to the tree at `origin/master` 2b27fa2dd.

## A. Facts measured before deciding

| # | Fact | Where |
| --- | --- | --- |
| F-1 | `orders`, `assets_library`, `custom_fields`, `catalog`, `organizations`, `settings`, `transactional_emails`, `admin_users`, `audit_logs`, `auth` are `nonDeactivatable`; `crm`, `quote_requests`, `admin_notifications` are toggleable. | each module's `src/manifest.ts` |
| F-2 | Tenancy classes are exactly `org`, `customer`, `global`, `transitive`, `rule`. A `@TransitivelyScoped` chain must end at `org` or `customer`; ending at `rule` throws `UnresolvableTenantParentError` at boot. | `packages/platform/src/tenancy/org-scoped.decorator.ts:24, 313-325, 404-430` |
| F-3 | The one precedent for "visible only if **every** related Organization is in scope" is price books: `@RuleScoped` entities, enforced in the module's services through `orgConstraintFor()` with a `not exists … <> any(?)` predicate. | `price_lists/src/backend/services/price-book-scope.ts:47-50, 74-85` |
| F-4 | The platform's published `ruleVisibleForScope` has **any-of** semantics and treats "no organization" as visible to all — the opposite of FR-004. | `packages/platform/src/tenancy/derived-scope.ts:85-98` |
| F-5 | An admin's reach: any role other than `sales_representative` is `allowAll`; a sales representative reaches their assigned Organizations (subtrees with `organizations:rollup`). | `organizations/src/backend/services/admin-tenant-scope.ts:33-50` |
| F-6 | Mention tokens are `[[(product\|order\|admin_user):<uuid>]]`, defined in `packages/contracts/src/crm.ts` §9 under `Opportunity*` names; `@`/`@@`/`@@@` are composer keystrokes, never stored. | `contracts/src/crm.ts:93`, `crm/src/admin/lib/mention-trigger.ts:30` |
| F-7 | Nothing of CRM's collaboration UI is shared: `ReferenceField` (Tiptap v3), `ReferenceText`, `CommentThread`, `CommentComposer`, `AttachmentUploader`, `OpportunityHistory`, `CursorPagination` live in `crm/src/admin/` and call `crmApi` directly. CRM's plan named `ReferenceTextarea` and the history list "promotion candidates" (`143/plan.md:85`, `143/research.md` R-16). | `crm/src/admin/components/` |
| F-8 | Zones `order.detail.after` and `quote_request.detail.after` exist and are mounted; the Opportunity detail screen mounts **no** zone. `check:admin-zones` refuses a declared-but-unmounted zone and vice versa. | `contracts/src/admin-contributions.ts:150-515`; `crm/src/admin/pages/OpportunityDetail.tsx` |
| F-9 | `orders` and `quote_requests` cannot delete a document and emit no delete event; `crm` deletes Opportunities with no event (`crm.opportunity.delete`). | event lists in `orders`, `quote_requests`, `CRM_EVENTS` |
| F-10 | `OpportunityReadPort` = `findById`, `findByDocument`, `listOpenForOrganization`; tenant-scoped, no permission check, no text search, no consumer yet. `QuoteRequestReadPort` has no text search either. | `contracts/src/crm.ts:1649-1653`; `contracts/src/quote-requests.ts:925-953` |
| F-11 | Reminder sweep precedent: one BullMQ Job Scheduler (`every: 60_000`), data-less job, `for update skip locked` claim, outcome settle, presence probe + `anyRowExists` before entering `enterSystemScope`. | `crm/src/backend/workers/event-reminder-worker.ts`, `services/event-reminder-service.ts` |
| F-12 | No platform time-zone setting exists. CRM Events store the planner's time zone per Event. | grep of `settings`, `contracts` |
| F-13 | A new admin nav section is a host change: `AdminNavSectionNameSchema` member + `AppShell.tsx` section + `appShell.section.*` label. | `contracts/src/admin-contributions.ts:93`; `admin-shell/src/components/AppShell.tsx:~145` |
| F-14 | A new custom-field host type is four edits outside the host: the `supportedEntityTypeSchema` enum, `SUPPORTED_ENTITIES` (with `ownerModuleId`), `host-storage-binding.ts`, and the `custom_fields` i18n label. `orgOwned` is informational (cross-tenant test selection). | `custom_fields/src/backend/services/custom-field-registry.ts:13-22` |

## B. Decisions

### R-1 — Two modules, `tasks` and `projects`, and the direction of knowledge between them

**Decision**: `tasks` (`@endora-commerce/mod-tasks`) owns Tasks and knows **nothing** about
Projects. A Task carries an optional opaque **context** — `contextType` (a string such as
`project`), `contextId` (uuid) and `contextGroupId` (uuid, the Stage) — whose meaning belongs to
whichever module registered that `contextType`. `projects` depends on `tasks` only through
non-binding edges (`degrades-without` on `taskReadPort`/`taskWritePort`, `contributes-to` on
`taskContextRegistry`).

**Rationale**: the owner ruled that a Project works without Tasks (spec *Clarifications*), and
Principle I requires `tasks` to stay removable and reusable ("the base for later growth"). An
opaque context is the shape `origin` already has in `orders`/`quote_requests` (CRM US10): a host
seam that names no contributor. Later contexts (`crm_opportunity`, `order`) plug into the same
seam without changing `tasks`.

**Alternatives considered**: a `project_id` column on tasks — couples `tasks` to `projects`,
breaks detachability. Tasks owned by `projects` — contradicts the technical requirement of a
separate Tasks module. A join table in `projects` (`project_tasks`) — splits the truth about a
Task's Stage across two modules and makes the gate a cross-module join.

### R-2 — Project tenancy: `@RuleScoped` with one module-local predicate

**Decision**: `Project` and **every** projects-owned table (children included) are
`@RuleScoped()`; configuration dictionaries (`ProjectRole`, `ProjectLossReason`, Templates and
their children) are `@GlobalEntity()`. Visibility is enforced by one module-local service,
`ProjectAccess`, which owns:

- `projectOrgRule(scope, orgIds)` — `scope.all || (orgIds.length > 0 && orgIds.every(inScope))`
  (FR-004, owner ruling Q1 = C);
- `visibleProjectSql(scope, viewer)` — that rule **and** the visibility rule of R-3, as one SQL
  predicate over `projects p`, used by every list, count, search and analytics query;
- `loadVisible(id)` — the **only** way a route or service obtains a Project; it answers 404
  `PROJECT_NOT_FOUND` for out-of-scope, invisible and non-existent alike. Every child read
  (stages, comments, members, links, attachments) loads its Project through it first.

`orgConstraintFor()` is called on every path, so a missing tenant context still throws
(fail-closed). Writes that attach an Organization check `isOrgInScope` for it.

**Rationale**: F-2 rules out `@TransitivelyScoped` children under a rule-scoped parent and F-3 is
the sanctioned precedent for an every-Organization rule; the constitution lists rule-scoped as a
classification whose enforcement lives in the owning service. F-4 shows the generic helper is the
wrong semantics. A zero-Organization Project with `orgIds.length > 0` false is visible only in
`all` mode — exactly the ruling.

**Alternatives considered**: `@OrgScoped` on a single "primary" Organization — cannot express
several or none. `@GlobalEntity` + service checks — semantically wrong for tenant-owned data
(review pushback documented in `org-write-guard.ts:106-114`). A new platform filter class for
join-table rules — touches `org-scoped.decorator.ts`, `filters.ts`, the classification CLI rule,
the transitive walk and the docs for one consumer (YAGNI); revisit if a third module needs it.
Adding `allOrgsInScope` to the platform's published surface — one consumer; price_lists keeps its
own copy too. **[unverified]** that a module-local `@Filter` would have been possible (not
needed; recorded so nobody tries it without measuring).

**Guard against a forgotten path** (since no ORM filter backs this): a co-located unit test,
`project-access-seam.test.ts`, parses every `routes/*.ts` file of `projects` and fails if a
handler resolves a Project-owned entity by id without passing through `ProjectAccess`
(mirroring how price_lists' scope tests are structured); cross-tenant integration tests per
story (Principle XI).

### R-3 — Visibility rule (FR-018 – FR-020, owner ruling Q2 = A)

**Decision**: effective visibility of Project P to admin U =

```
orgRule(U, P)                                         -- R-2, always first
AND (  U holds projects:see_all
    OR U is a Member of P
    OR U is a listed viewer of P
    OR effectiveMode(P) = 'everyone' )
effectiveMode(P) = P.visibility = 'inherit' ? setting projects.visibility : P.visibility
```

`P.visibility ∈ {inherit, everyone, members_and_listed}`; module setting
`projects.visibility ∈ {everyone, members}`, default `members`. `projects:read` is the route
gate for all of it. Holders of `*` hold `projects:see_all` by the platform's wildcard rule.

**Rationale**: it is the ruling verbatim and keeps Organization reach (Principle XI) strictly
outside anything a Project setting can widen.

**Alternatives considered**: a per-Project deny list — not asked; a bypass for any holder of
`projects:configure` — conflates configuring the module with reading every Project.

### R-4 — Members, Project Roles and "every Member is notified"

**Decision**: `project_members (project_id, admin_user_id)` plus
`project_member_roles (member_id, role_id)`; one person, many Roles (FR-008). "A Member who may
see the Project" for notifications = active admin **and** `projects:read` **and**
`projectOrgRule` against that admin's own reach (`AdminTenantScopePort.resolveForAdmin`, the
crm `admin-reach.ts` shape with every-Organization semantics). Members always pass the
visibility rule by definition.

**Rationale**: matches spec User Story 8 scenario 4 and CRM's notification rule; a Member a sales
representative cannot reach must not receive the Project number in the bell.

**Alternatives considered**: storing Roles as a jsonb array on the member — loses referential
integrity when a Role is archived and makes "who holds Role X" (Stage Task assignment, US3 sc.3)
a jsonb scan.

### R-5 — Stages and the Stage workflow

**Decision**: per Project, `project_stages` (name jsonb-free plain text — Stage names are
operator content written once per Project, not translated), `position`, `color`,
`planned_duration_days`, `responsible_role_ids uuid[]`, `alert_offsets_days int[]`,
`completion_gate`, `completion_permitted`, `started_on date`, `deadline_on date`,
`deadline_manual boolean`, `tasks_materialized_at`, `tasks_skipped_at`;
`project_stage_moves (project_id, from_stage_id, to_stage_id)`; one pure
`StageGraph` class (the `opportunity-status-graph.ts` shape) answering `canMove(from, to)`,
`unreachable()`. History in `project_stage_entries (project_id, from_stage_id, to_stage_id,
outcome, gate_note, actor, at)` — rows, not only audit, because analytics need intervals (CRM
precedent: `crm_opportunity_status_history`).

Outcome is on the Project (`state ∈ open|completed|lost`, `closed_at`, `lost_stage_id`,
`loss_reason_id`, `loss_comment`), not a Stage kind: a Project can be lost from **any** Stage
(FR-005), which a "lost Stage" in the graph could not express without an edge from every Stage.

Stage deadline (FR-013): on entry, `started_on = today (alert zone, R-12)`; `deadline_on =
started_on + planned_duration_days` unless `deadline_manual`. Re-entering a Stage restarts
`started_on` and recomputes a non-manual deadline.

**Alternatives considered**: a platform-wide Stage workflow like CRM's status workflow — the owner
asked for Stages per Project and per Template. Translatable Stage names — Stages are written per
Project by its manager; Templates are where reuse happens, and analytics group by name (R-15),
which translation would split.

### R-6 — Transition hooks (FR-014)

**Decision**: the CRM model exactly: an ungated `projectStageGuardRegistry`
(`register({ ownerModuleId, before(ctx) → Allow | Refuse(reason) })`, filtered by
`effectiveState.isPresent(ownerModuleId)` when enumerated) and templated EventBus events
`projects.stage.moved.v1` / `projects.project.closed.v1` / `projects.project.reopened.v1` for
the "after" side. The completion gate (R-8) is the module's own first guard.

**Rationale / alternatives**: as `143/research.md` for `opportunityTransitionGuardRegistry`;
inventing a second mechanism would make overlays learn two.

### R-7 — Templates are copied, never referenced

**Decision**: `project_templates`, `project_template_roles`, `project_template_stages`
(same attributes as a Project Stage minus dates), `project_template_stage_tasks (title,
description, responsible_role_id, due_offset_days, position)`, `project_template_stage_moves`.
Creating from a Template copies Stages, moves, gates, alerts, default description and **Stage
Task definitions** into `project_stage_tasks` rows of the new Project (the Project's own copy,
editable, FR-016). `projects.template_id` is kept as provenance (`on delete set null`).

**Rationale**: FR-016 says later Template edits must not reach existing Projects; a copy is the
only way that holds without versioning Templates. Copying Stage Task **definitions** (not Tasks)
is what lets Stage Tasks materialise later, on Stage entry (FR-017), and lets them be defined on
a Project that was not created from a Template ("each Stage may have a predefined set of Tasks").

**Alternatives considered**: versioned Templates — heavier, not asked.

### R-8 — Stage Tasks, the completion gate and Tasks being off (FR-012, FR-017, FR-040)

**Decision**:
- **Materialisation**: on entering a Stage (the first Stage at creation), if
  `tasks_materialized_at is null and tasks_skipped_at is null`: if `tasks` is present,
  `taskWritePort.createMany([...], { contextType: 'project', contextId, contextGroupId: stageId
  })` and set `tasks_materialized_at`; if absent, set `tasks_skipped_at` and write the entry note
  `stage_tasks_skipped`. Both are terminal: re-entry and re-enabling never create them.
- **Assignment**: the Member holding the Stage Task's Role if exactly one does; otherwise
  unassigned, with `responsibleRoleLabel` written into the Task's `contextNote` (a plain string
  the Task shows).
- **Gate**: a guard (R-6) that, when `completion_gate` and `tasks` present, calls
  `taskReadPort.listOpenInContext({ contextType: 'project', contextId, contextGroupId })`;
  non-empty → refuse 409 `PROJECT_STAGE_GATE_OPEN_TASKS` with `{ id, number, title }[]`. With
  `tasks` absent the guard allows and the entry records `gate_not_applied_tasks_off`. Closing as
  lost bypasses the gate.
- **Ordering inside a move**: the move is one Command in `projects`; Task creation is a second
  call through the port **after** that Command commits (the owner's own Commands audit the
  Tasks). A failure creating Tasks leaves the Stage entered, records `tasks_materialize_failed`
  on the entry and shows a "create Stage Tasks again" action — never a half-moved Project.

**Rationale**: the owner's ruling makes Tasks optional; a Command cannot span two modules'
transactions without one importing the other's EntityManager.

**Alternatives considered**: materialising all Stages' Tasks at creation — the spec chose entry
time (US3 sc.2) so due dates count from the real Stage start. Creating Tasks in the same
transaction via a shared EM — forbidden coupling.

### R-9 — Task visibility for Tasks inside a Project (FR-031) — the context-access registry

**Decision**: `tasks` owns an **ungated** `taskContextRegistry`
(`TaskContextRegistryPort.register(descriptor)`), each descriptor
`{ contextType, ownerModuleId, allVisibleContextIds(): Promise<string[]>,
visibleContextIds(ids: string[]): Promise<Set<string>>,
describe(ids): Promise<Map<id, { label, href, groupLabel? }>> }`, called **under the caller's
ambient context**. `tasks`:

- shows a Task with no context to any holder of `tasks:read`;
- shows a Task with a context **only** if its owner is registered, present, and returns the id
  from `visibleContextIds`; an unregistered or absent owner hides the Task (fail-closed —
  Principle XVII: with `projects` off, Project Tasks are absent, and return when it is back);
- answers 404 for a hidden Task by id, and excludes hidden Tasks from lists and counts with one
  SQL pre-filter, built before the query runs: for each registered and present `contextType`,
  the owner's `allVisibleContextIds()` returns every context id the caller may see; the list
  query then carries `context_type is null or (context_type = ? and context_id = any(?)) or …`.
  Lists and counts therefore stay exact and pageable. **[unverified]** that returning every
  visible Project id per request stays cheap at the target scale (hundreds of Projects a month,
  a few thousand in total): the Tasks-foundation phase measures it with 5 000 Projects; the
  fallback is a cached per-request set, then a materialised `task_context_visibility` view
  owned by the contributor.

`projects` registers `{ contextType: 'project', ownerModuleId: 'projects', … }` from an `onBoot`
contribution hook (no presence probe) and backs `allVisibleContextIds` and `visibleContextIds` with `visibleProjectSql`.
`Task` is classified `@RuleScoped()` — its tenancy is its context's rule.

**Rationale**: the only way `tasks` can honour Project visibility without importing `projects`;
the shape is the asset-reference and audit-reference registries the platform already uses.

**Alternatives considered**: duplicating Project visibility into a `visible_to` array on each
Task — stale the moment membership or the setting changes. Letting `projects` serve Project
Tasks only through its own endpoints and hiding them from `tasks` entirely — breaks *My Tasks*
(a Member's Project Tasks must appear there, US2).

### R-10 — Linked records (FR-021 – FR-024)

**Decision**: `project_links (project_id, record_kind ∈ order|quote_request|opportunity,
record_id, linked_by, linked_at)`, unique `(record_kind, record_id)` — "at most one Project".
Held **by value** (no FK; F-9 means nothing tells us of deletion), rendered `available:false`
when the owner returns nothing (FR-023 and "a deleted record disappears" degrade to
"unavailable"; see R-21 for the spec amendment). Validation: the record's `organizationId` must
be in the Project's Organizations (422 `PROJECT_LINK_ORGANIZATION_MISMATCH`), read through
`orderReadPort` (binding, F-1), `quoteRequestReadPort` (`degrades-without`), `opportunityReadPort`
(`degrades-without`). Already linked elsewhere → 409 `PROJECT_RECORD_ALREADY_LINKED`, naming the
holder only if visible to the caller. Unique-violation races map to the same 409. Rendering
number/status/amount checks the owner's read permission (`orders:read`, `rfqs:handle`,
`crm:read`) through `permissionService` (`PermissionReadPort`) — CRM's `owner-read-permissions` shape (F-7), written
in `projects` (a ~40-line copy; see R-17).

Picking records in the admin uses the owners' own list endpoints filtered by Organization and
`q` (CRM precedent: `crmApi.searchOrders`), plus `GET /api/v1/admin/crm/opportunities?
organizationId=&q=` for Opportunities and `/api/v1/admin/quote-requests?organizationId=&q=` —
**[unverified]** that both list endpoints accept `organizationId` and `q`; T-link reads them
first and, if not, uses the global-search endpoint with `entityTypes` and filters client-side by
the Organization in the result.

**Alternatives considered**: storing links on the records' owners — three foreign module schema
changes for a feature they must not know about.

### R-11 — "Which Project is this record in" panels (FR-022)

**Decision**: one endpoint `GET /api/v1/admin/projects/records/:kind/:id/project` (kind ∈ order,
quote_request, opportunity, task) returning a `ProjectSummary` or 404, applying
`ProjectAccess` (an invisible Project is a 404, so the panel renders nothing — US5 sc.5). Panels
contributed by `projects` to zones `order.detail.after` (exists), `quote_request.detail.after`
(exists), **`opportunity.detail.after` (new, mounted in crm)** and **`task.detail.after` (new,
mounted by `tasks` on its own screen)**. For `task` the endpoint asks `taskReadPort.findById`
for the context and answers only when `contextType = 'project'`.

**Rationale**: F-8; the four-step zone recipe; host modules name no contributor.

**Alternatives considered**: a `projectId` on each record's own API — foreign schema changes.

### R-12 — Deadline alerts: a daily-granular sweep (FR-035)

**Decision**: one BullMQ Job Scheduler `projects-stage-alerts`, `every: 15 * 60_000`, data-less
job, F-11's skeleton (presence probe → `anyRowExists` probe → `enterSystemScope`). An alert is
**due** when the Project is open, the Stage is current, `today(alertZone) = deadline_on -
offset`, the local time is past 08:00, and there is no row in
`project_stage_alert_deliveries (stage_id, offset_days, deadline_on)` — that unique key is the
idempotency guard: claim = `insert … on conflict do nothing returning`, so a moved deadline is a
new key and re-arms (US8 sc.3), and a Stage entered after the alert day sends nothing backdated
(US8 sc.5): the sweep only claims alerts whose **due day is today**, never past days. Delivery
is outside the transaction; outcome settled on the row (`bell|bell_email|email|no_recipient|
undeliverable`). Recipients: R-4. Channels: bell through `adminNotificationRecordPort`
(`degrades-without`) **and** e-mail through `TransactionalEmailSender` (template
`projects_stage_deadline_alert`, en-US / pl-PL defaults registered into
`emailDefaultsPort`) — the spec says "in the Admin UI and by e-mail" for every alert, unlike CRM's
"e-mail only if not seen for 5 min".

**Alert zone and send hour (F-12)**: module setting `projects.alerts_time_zone` (IANA, default
`Europe/Warsaw`) and alerts are claimed from 08:00 local on the due day. Default chosen because
every current deployment is Polish; operators change it on the settings screen.

**Alternatives considered**: one delayed BullMQ job per alert — loses work on Redis flush and must
be rescheduled on every deadline edit (CRM rejected it for the same reasons). A per-Project time
zone — not asked.

### R-13 — Notes, messages, references

**Decision**: `project_comments (kind note|message)`, `project_message_reads`,
`project_references` — the CRM shapes (F-7, `143/data-model.md`), keyed on `project_id`. Message
notifications go to **every Member** except the author (spec FR-025; CRM notifies assignee +
participants). Mentions notify per CRM's rules, with "may see" = R-3/R-4.

### R-14 — One reference standard for Projects **and** CRM; `@@` means "a document"

*Amended 2026-10-26 by owner ruling (spec FR-044): CRM adopts the same `@@` behaviour.*

**Decision**: a new `packages/contracts/src/record-references.ts` holds the token grammar under
neutral names — `recordReferenceTypeSchema = z.enum(['admin_user','order','product',
'quote_request','task'])`, `REFERENCE_TOKEN_SOURCE`, `formatRecordReferenceToken`,
`extractRecordReferenceTokens`, `splitRecordReferenceText`, `mentionedAdminUserIds` — and
`crm-rich-text.ts` moves beside it as `record-rich-text.ts`. `contracts/src/crm.ts` keeps its
exported names (`opportunityReferenceTypeSchema`, `formatOpportunityReferenceToken`, …) as
**aliases of the shared ones, widened** to the five types — an additive change (a response may
now carry two more `type` values; the only consumer is CRM's own admin).

Composer keystrokes, identical in both modules: `@` person, `@@` a **document** — one list
grouped Orders · Quote Requests · Tasks, each group offered only to a holder of its read
permission (`orders:read`, `rfqs:handle`, `tasks:read`) and only while its owner is present —
`@@@` Product. Orders and Quote Requests are those of the record's Organization(s) (the
Opportunity's one; the Project's, none for an internal Project); Tasks are any the user may see.

**CRM side** (no behaviour change for existing texts — tokens already stored are a subset):
- migration `crm_opportunity_reference_documents` widens
  `crm_opportunity_references_target_type_check` to the five types, the precedent being
  `20261007T180600_crm_opportunity_reference_admin_user.ts`; its `down` deletes rows of the two
  new types first, as that precedent does;
- `reference-service.ts` resolves `quote_request` (through the `quoteRequestReadPort` CRM already
  consumes, gated by `rfqs:handle` and presence) and `task` (through `taskReadPort`, a **new
  `degrades-without` edge** in CRM's manifest: "References to Tasks show as unavailable."), with
  `available:false` for anything absent, hidden or not permitted;
- a new lookup `GET /api/v1/admin/crm/lookups/documents?opportunityId=&q=` (`crm:write`) serving
  the grouped list — the same response schema as Projects' `GET /projects/lookups/documents`
  (`RecordDocumentLookupResponse`, in `record-references.ts`);
- the promoted `ReferenceField` (R-17) takes the trigger kinds `['admin_user','document',
  'product']` and a `ReferenceLookups` adapter in both modules — there is no CRM-specific
  trigger table any more;
- `ReferenceText` renders Quote Request and Task chips with links (`/quote-requests/:id`,
  `/tasks/:id`) in both modules;
- CRM's i18n, its docs page (EN + PL) and a one-line pointer in
  `specs/143-crm-sales-opportunities/spec.md` User Story 18 ("`@@` superseded by
  `specs/163-projects-and-tasks/` FR-044").

Mentions (people) and their notifications are unchanged in CRM.

**Rationale**: one grammar, one parser, one editor, one meaning per trigger length — the owner
asked for a standard rather than two dialects.

**Alternatives considered**: CRM keeps `@@` = Orders (this plan's first answer) — two meanings
of one keystroke across screens a Sales Rep uses side by side; ruled against by the owner. `#`
for Tasks and `$` for Quote Requests — new symbols users must learn, and `#` collides with
Markdown headings the rich-text subset may grow. `@@@@` — unusable.

### R-15 — Analytics (FR-037, FR-038)

**Decision**: endpoints under `/api/v1/admin/projects/analytics/*`, gated `projects:analytics`,
one grouped raw-SQL statement per figure, every statement carrying `visibleProjectSql(scope,
viewer)` (R-2, R-3 — analytics honour membership visibility too, spec US10 sc.5). Range applies
to `created_at` for "opened", `closed_at` for completed/lost and durations. Figures: `summary`
(opened, completed, lost, completion rate), `durations` (avg completed, avg lost — days),
`time-in-stage` (avg per Stage **name**, `lower(trim(name))`, from `project_stage_entries` with
`lead()`), `losses` (by lost-Stage name ranked, by reason, lost value **per currency**),
`value` (avg per currency), `top-open` (by value per currency), `managers` (Members holding the
*Project Manager* Role on completed Projects). Filters: Template, Organization, Project Manager.
Every response carries `{ from, to, projectCount, excluded: { noValue } }` (FR-038). Admin page
on `<EChart>` from admin-kit, the CRM AnalyticsPage layout.

**Days (owner decisions 2026-10-27, issue #465; T146)**: a range's days are counted in
`analytics.reporting_time_zone`, a setting of the `analytics` module (group `analytics`) — not of
`projects`, so CRM can read the same one later (#474) — default `UTC`, an IANA name refused on
write when the runtime does not know it. Projects reads it through `analytics`' gated
`reportingTimeZonePort` behind a `degrades-without` edge: with `analytics` off or absent it counts
in `UTC`. A first placement in `settings` (`reporting.time_zone`) was moved by the owner the same
day. The range is `[from 00:00, the day after to 00:00)` with both midnights
in that zone (`domain/analytics-range.ts`); in `UTC` it is the range the module counted before.

**Alternatives considered**: grouping losses by Stage id — Stages are per Project, so ids never
repeat; by Template Stage id — Projects without a Template, or edited Stages, would vanish.

### R-16 — Navigation section and permissions

**Decision**: a new host nav section `work` labelled **"Projects & tasks" / "Projekty i
zadania"** (owner may rename at review), holding Projects, Tasks, My Tasks, Templates, Roles,
Loss reasons, Analytics; each entry gated by its own module's permission, so the section shows
only Tasks entries when `projects` is off and disappears when both are. Permissions —
`projects`: `projects:read`, `projects:write` (create/edit/move/close/link/delete),
`projects:configure` (Roles, Templates, loss reasons, settings), `projects:see_all`,
`projects:analytics`; `tasks`: `tasks:read`, `tasks:write`. Palette actions per spec US11 sc.1.

**Alternatives considered**: placing entries under `crm` or `sales` — Projects are not a sales
sub-feature and the Tasks module is meant for every module; the CRM precedent got its own section
by owner ruling.

### R-17 — UI reuse: promote CRM's collaboration components to `admin-kit` (Principle IX)

**Decision**: promote into `@endora-commerce/admin-kit/components`:
`ReferenceField` + `ReferenceText` (+ `reference-node.ts`, `rich-text-doc.ts`,
`mention-trigger.ts`), `CommentThread`, `CommentComposer`, `AttachmentUploader`
(+ `upload-attachment.ts`), `RecordHistory` (from `OpportunityHistory`, field labels injected),
`CursorPagination`. Every `crmApi` call becomes a prop or a `ReferenceLookups` adapter
(`searchPeople`, `searchDocuments`, `searchProducts`, `resolve`). CRM is moved onto the promoted
components **in the same feature**, guarded by CRM's existing admin tests running unchanged.
Backend helpers that are pure and tiny (`attachment-active-content.ts`, the
`owner-read-permissions` shape, `newlyMentioned`, `scheduled-work-probe.ts`) are **copied** into
`projects` — `scheduled-work-probe.ts` is copied by design (its header and a parity test say so);
the others are < 60 lines each and the platform surface is deliberately narrow (D-285 family).

**Rationale**: the second consumer is the trigger CRM's own plan named for promotion; two
diverging copies of a 43K Tiptap editor is the outcome IX exists to prevent. **Tiptap is already
in the workspace**: `@tiptap/react` and `@tiptap/starter-kit` `^3.22.5` are peers + devDeps of
`packages/modules/crm/package.json:64-104` and dependencies of `admin/package.json:83-84`.
Promotion moves the peer declaration to `packages/admin-kit/package.json` (the `echarts` /
`@dnd-kit` arrangement); `manifests:generate` then drops it from `mod-crm` if nothing there
imports Tiptap any more. No new dependency; no version change.

**Alternatives considered**: copy into `projects` — two editors; leave CRM on its own copy and
promote for Projects only — the same two copies, one in the kit. Defer to a later feature —
Projects would then be built on a CRM-private component it may not import.

### R-18 — Custom fields host `project` (FR-036)

**Decision**: `supportedEntityTypeSchema += 'project'`; `SUPPORTED_ENTITIES.project =
{ labelKey: 'customFields.entity.project', orgOwned: true, ownerModuleId: 'projects',
listFilter: true }` (no carry targets); storage binding `projects.custom_field_values`; label in
`custom_fields` bundles. Validation through `customFieldValueService.validateAndMerge` inside
the Project's Command; reads through `project()`; history hides values without
`custom_fields:read` (CRM rule). Tasks: **not** a host in this feature (not asked).

### R-19 — Numbers

**Decision**: `projects_number_seq` → `PRJ-000001`; `tasks_number_seq` → `TSK-000001`; both
`nextval` on the caller's transaction, gaps accepted (CRM `opportunity-number.ts`).

### R-20 — Seeds

**Decision**: the init migrations seed, into the modules' own tables: Roles `sales_rep`,
`project_manager` (`name` jsonb `{en,pl}` + `default_name`, `is_system = true` — renamable, not
deletable, archivable); loss reasons `price`, `competitor`, `cancelled_by_client`,
`no_decision`, `other`. No install hook (CRM precedent). Demo: one Template *Showroom fit-out*
and four Projects (one per state, one internal) in `packages/demo-composition`
(`demoProjectsStep`), Tasks included only when `tasks` is installed.

### R-21 — Spec amendments forced by facts

- F-1: Orders and the asset library cannot be switched off, so FR-024's and FR-027's "when
  Orders / the asset library is off" cases are vacuous; FR-040 holds trivially for them. The
  spec is amended to say so; the design binds them as ordinary `dependencies`.
- F-9: Orders and Quote Requests cannot be deleted, and Opportunity deletion emits no event.
  User Story 6 sc.6 ("the link is gone and the removal is in history") is amended to "the link is
  shown as unavailable"; a dangling Opportunity link can be removed by hand.

### R-22 — Queue consumers (Principle X)

Only R-12's sweep. Everything else is synchronous: Stage moves touch one Project; Stage Task
materialisation creates at most a few dozen Tasks per entry (bounded by the Template; a
`createMany` cap of 100 per Stage, refused above it at Template save).

### R-23 — Webhooks, board, Gantt

Not in scope (spec *Assumptions*). The events of R-6 are emitted so a later feature can register
them with the webhook event registry without changing `projects`' writes.
