# Research: Task management — growing the Tasks module

**Feature**: `specs/165-task-management/` · **Date**: 2026-10-28 · **Base**: `origin/master` at
`4e4cf7f83` (feature 163 merged in #477).

The facts (F-n) were measured in the tree. The decisions (R-n) follow from them. A decision
names the alternatives it rejected. Paths are relative to the repository root. `T/` stands for
`packages/modules/tasks/src/` and `C/` for `packages/modules/crm/src/`.

---

## Facts

**F-1 — The Task today.** There is one table, `tasks` (`T/migrations/20261026T133731_tasks_init.ts`):
- `status text` checked against the four literals, default `'todo'`.
- One `assigned_admin_user_id`.
- `due_on date`.
- `description text`, at most 20 000 characters: plain text with tokens.
- An all-or-nothing context (`context_type` / `context_id` / `context_group_id`) and `context_note`.
- No foreign keys.
- Three indexes, on (assignee, status, due), (context…, status) and (status, due).

The entity is `@RuleScoped`. Every read goes through `TaskVisibility` (`T/backend/services/task-visibility.ts`), which is raw SQL with one pre-filter built from each present contributor's `allVisibleContextIds()`. The system actor is unrestricted.

**F-2 — Writes.** Every write is a Command in `T/backend/services/task-commands.ts`:
- `tasks.task.create`
- `tasks.task.update`
- `tasks.task.assign`
- `tasks.task.status_change`: `done` sets `completedAt`.
- `tasks.task.delete`

`update()` runs up to three Commands in sequence (update, assign, status). History is the audit log for object type `task`. `TaskDetail` shows only five fields of it: title, status, dueOn, contextNote and completedAt.

**F-3 — Who depends on the fixed statuses and the single assignee.** The full lists, with line numbers, are in the planning notes and are reproduced in `contracts/foreign-module-changes.md`. In short:
- Contracts (`TASK_STATUSES`, `TASK_CLOSED_STATUSES`, `TaskSummary.assignee`, `NewContextTask.assignedAdminUserId`, events).
- Projects:
  - `stage-task-service.ts`: the `CLOSED` set at :82 and the `overdue` computation at :270, plus building the assignee at :258-277 and :352-358.
  - The Projects `TasksTab` and its `tasks.status.*` i18n keys.
- Demo (`packages/demo-composition/src/projects.ts`, which inserts into `assigned_admin_user_id` with literal statuses).
- 10 backend test files and 6 admin test files.

CRM uses only `findByIds` and `search` of `TaskReadPort`. **Nothing subscribes to the four `tasks.task.*` events.**

**F-4 — Status workflows elsewhere.**
- **CRM** (`C/backend/entities/crm-opportunity-status*.entity.ts`, `C/backend/domain/opportunity-status-graph.ts`, `C/backend/services/workflow-config-service.ts`):
  - `@GlobalEntity` status rows hold an immutable `code`, a localized `name` json, `defaultName`, `kind`, `isInitial` (a partial unique index allows one), `weight` (which is also the board order) and `color`.
  - Transitions are held by value as `(from_code, to_code)`, unique, with `from <> to`.
  - A pure graph class asserts validity after every write, inside the same audited Command.
  - Transitions are edited as a delta (`add` / `remove`).
  - Deleting a status that is in use is **refused** (409 `CRM_STATUS_IN_USE`) and offers no reassignment.
  - Enforcement at write time: an unknown target gives 422, a forbidden move gives 409, then guards run, then a pessimistic re-read; a concurrent change gives 409 `CRM_TRANSITION_CONFLICT`.
- **Orders** follows the same shape and also refuses deleting a status in use.
- **The graph editor** is admin-kit `StatusTransitionGraph` (statuses with `isTerminal`, `isSystem`, `inUseCount`, plus `onAdd` / `onRemove`).

**F-5 — Board.**
- CRM `GET /crm/board` (`C/backend/services/board-service.ts`):
  - One grouped query gives the count and totals of every column.
  - Then one sequential list call per column gives the first cards. It is sequential on purpose, to spare the connection pool.
  - Further cards of a lane come from the list endpoint, filtered to one status.
- The admin side wraps admin-kit `KanbanBoard`:
  - `onMove` returns a promise; a rejected promise reverts the card.
  - Cards have no order inside a lane.
  - A keyboard *Move to…* menu is required by WCAG 2.5.7. It is CRM's `MoveToMenu.tsx`, a CRM-local component.
- The card fields are a platform-wide json setting, `crm.board_card_fields` (`builtin:<key>` / `custom:<key>`, at most 6), edited on the workflow page.
- Board filters live in the URL.

**F-6 — Tags** (`C/backend/entities/crm-tag.entity.ts`, `crm-opportunity-tag.entity.ts`, `C/backend/services/tag-service.ts`):
- Tags are `@GlobalEntity`, with a 64-character name unique on `lower(name)` and a `#rrggbb` colour.
- The join table has a composite primary key and cascades on both sides.
- An AND filter adds one `id in (select … where tag_id = ?)` per tag.
- Deleting a tag cascades, and only the tag's own audit row records `usageCount`.
- The UI is `TagChips` / `TagMultiSelect` / `useTagOptions` in `C/admin/components/TagPicker.tsx`, which is CRM-local.

**F-7 — Collaboration.** Projects copied CRM's model:
- **Comments:** `project_comments` (`kind` note|message, body token text, `edited_at`, `deleted_at`).
- **References:** `project_references` (`source_kind` description|comment, `source_id`, `target_type`, `target_id`), refreshed inside the saving Command. A **DB check** lists the target types.
- **Attachments:** `project_attachments` (asset id, unique per record).
- **Uploads:** through `assetsLibraryPort.upload` as private, with `attachment-active-content.ts` copied deliberately.
- **Asset protection:** `project-asset-references.ts`, registered ungated, protects attached assets from deletion.
- **Mentions:** `mention-service.ts` (`newlyMentioned(prev, next)`, notify after commit, never the author, only readers who may see the record).
- **Read permissions:** `owner-read-permissions.ts` maps each referenced kind to the reader permission that gates it.
- **Shared UI in admin-kit:** `ReferenceField` (TipTap), `ReferenceText`, `CommentThread`, `AttachmentUploader`, `RecordHistory`.

**F-8 — The reference grammar** (`packages/contracts/src/record-references.ts`):
- `RECORD_REFERENCE_TYPES = ['product','order','admin_user','quote_request','task']`. Neither **`opportunity`** nor **`project`** is in it.
- The token regex is built from that array, so **extending it makes every module's extractor recognise the new tokens.**
- The CRM (`crm_opportunity_references_target_type_check`) and Projects (`project_references_target_type_check`) check constraints list the same five types.
- `RECORD_DOCUMENT_KINDS = ['order','quote_request','task']` decides the groups of the `@@` list.

**F-9 — Read ports for the new reference kinds.**
- CRM `OpportunityReadPort` (`packages/contracts/src/crm.ts:1590`) has `findById`, `findByDocument` and `listOpenForOrganization`. It is tenant-scoped by the caller's EntityManager, **checks no permission**, and has **no `findByIds` and no `search`**.
- Projects `ProjectReadPort` (`packages/contracts/src/projects.ts:1118`) has `findById` and `findByRecord`, both through `ProjectAccess.findVisible`. It has **no `findByIds` and no `search`**. Any new reader must be added to the `PROJECT_ACCESS_READERS` ledger (`project-access.ts:52`).
- Orders, quote requests, catalog and admin users have the ports the resolvers already use.
- **No published port answers "may admin X see opportunity Y".** CRM has an internal `admin-reach.ts` (`AdminTenantScopePort` + `crm:read`).

**F-10 — Custom fields.** Adding an entity type takes:
- the Zod enum in `packages/contracts/src/custom-fields.ts`;
- a `SUPPORTED_ENTITIES` entry (`ownerModuleId`, `listFilter`, `orgOwned`) in `custom-field-registry.ts`;
- a `host-storage-binding.ts` row `{table, column}`;
- i18n in `custom_fields`;
- the three tests that enumerate the types;
- a `custom_field_values jsonb` column on the host;
- `CustomFieldValuePort.validateAndMerge` in the host's Command and `customFieldListFilter.condition` on its list.

**There is no DB check on `entity_type`.** `custom_fields` is `nonDeactivatable`.

**F-11 — Saved views** (feature 147):
- Nothing is generic on the server. Each module owns a `@GlobalEntity` table (owner, name, shared, filters json ≤ 8 KB, sort, visibleColumns), unique on `(owner, lower(name))`.
- Each module also owns its service (actor `{adminId, isPlatformAdmin}`) and its routes (`…/list-views`).
- The shared contract is `saved-list-views.ts`; the shared UI is `SavedViewsControl`.
- The UI has no rename.

**F-12 — Admin preferences** (feature 164): `ADMIN_PREFERENCE_KEYS` is a **closed set** in `packages/contracts/src/admin-preferences.ts`.
- Storage is the `admin_users` table `admin_user_preferences` (pk admin, key), with no check, so a new key needs no migration.
- A key is added in the contract (keys, patch, read, defaults), in admin-kit `lib/admin-preferences/store.ts` (`KEYS` + switch) and in `use-admin-preference.ts`.
- `listPageSizes` is the model for a per-list map.
- Modules cannot contribute keys.

**F-13 — Scheduled work.**
- CRM `event-reminder-worker.ts` (every 60 s) and Projects `stage-alert-worker.ts` (every 15 min) share a shape:
  - a Job Scheduler that carries no data;
  - `concurrency: 1`;
  - started only where `processRunsWorkers && moduleQueueRedis`;
  - attached with `ctx.worker`.
- Each tick runs: presence check → a `scheduled-work-probe.ts` `anyRowExists` probe outside any scope → `enterSystemScope(reason)`. The probe exists so that a tick with no work writes no `tenant.escape_hatch` audit row. It is a copy per module, and `backend/test/unit/tenancy/scheduled-work-probes.test.ts` keeps the copies identical.
- Claims: Projects inserts a delivery row (`on conflict do nothing`); CRM uses `for update skip locked` plus an outcome column.
- **E-mail:**
  - The sending module declares `transactionalEmails` in its manifest.
  - It registers defaults (`simpleEmailBodyTree`) through `emailDefaultsPort` in an ungated `onBoot`.
  - It sends through `transactionalEmailSenderAccessor()`; the send returns `{sent:false, reason}` instead of throwing.
  - The language is the admin's `preferredLanguage`.
  - `transactional_emails` is `nonDeactivatable`.
- **Time zones:**
  - Projects alerts use their own setting, `projects.alerts_time_zone` (default `Europe/Warsaw`, with a validator).
  - The reporting time zone moved to `analytics.reporting_time_zone`, read through `reportingTimeZonePort`. `analytics` is switchable, and its fallback is `UTC`.

**F-14 — Notifications.**
- The port is `adminNotificationRecordPort.record({audience, targetAdminUserId, kind, subjectType, subjectId, title, titleMessage, linkPath})`.
- It fails closed when its module is off, so callers check presence first.
- Kinds are named `<module>.<record>.<event>`.
- Sentences name a record by its number.
- **Gap:** `task-service.ts` `#assigneeMaySee` answers `true` for a context-less Task **without checking the recipient holds `tasks:read`**.

**F-15 — Admin zones.**
- `order.detail.after`, `quote_request.detail.after`, `opportunity.detail.after` and `task.detail.after` exist.
- There is no `project.detail.*` zone.
- Projects contributes `ProjectPanel` to each through `zoneComponent(...)` in its admin `index.ts` (weight 650, gated on its read permission). The host names no contributor.

**F-16 — Issue #450, measured.**
- **Partial failure:**
  - `taskWritePort.createMany` validates, then runs one Command per Task, each committing alone (`T/backend/services/task-write-port.ts:77-95`).
  - On a failure Projects records `tasks_materialize_failed`.
  - `retry()` (`projects/…/stage-task-service.ts:212-240`) creates **all** definitions again, so the Tasks committed before the failure are duplicated.
- **Project deletion** calls `deleteInContext` only when Tasks is present.
- **Stage deletion** never calls Tasks. With Tasks on, it is refused when the Stage has Tasks. With Tasks off, it succeeds and leaves dangling `context_group_id`s.
- **No descriptor method separates "gone" from "invisible".** Under the system actor, Projects' `visibleContextIds` happens to be an existence check (`project-access.ts:424-436`), but no contract says so.
- `tasks` has no worker today.

**F-17 — Demo.**
- The `tasks` module seeds nothing itself.
- `demoProjectTasksStep` inserts 12 Tasks with raw SQL into `tasks`, including `assigned_admin_user_id` and literal statuses.
- `demo-shop.test.ts` asserts `tasks: 12`.

---

## Decisions

### R-1 — Statuses: CRM's workflow model with a three-valued category, and codes that stay in `tasks.status`

**Decision.** Add two `@GlobalEntity` tables, modelled on CRM:
- `task_statuses`: `code` (immutable, snake_case), `name` json `{en, pl}`, `default_name`, `category` (`open` | `done` | `cancelled`), `is_initial` (a partial unique index allows one), `weight`, `color`.
- `task_status_transitions`: `(from_code, to_code)`, unique, with `from <> to`.

`tasks.status` keeps holding a **code by value**:
- The migration drops `tasks_status_check` and seeds `todo` (initial), `in_progress`, `done` and `cancelled` with all twelve moves allowed, so **no Task row changes** (FR-014, SC-008).
- A pure `TaskStatusGraph` (copied from `OpportunityStatusGraph`, with CRM's rule names adapted) asserts the FR-013 rules at the end of every configuration Command.
- Transitions are edited as an add/remove delta.

Enforcement lives in one `TaskTransitionService`, used by the detail screen, the board and `PATCH`:
- An unknown target gives 422 `TASK_STATUS_UNKNOWN`.
- A forbidden move gives 409 `TASK_TRANSITION_FORBIDDEN` with `allowedTargets`.
- The service then takes a pessimistic re-read. When the caller's `fromStatus` no longer matches, it gives 409 `TASK_TRANSITION_CONFLICT`.
- Entering a `done`-category status sets `completed_at`; leaving one clears it.

**Closed means category `done` or `cancelled`** (FR-017). `listOpenInContext` and *My Tasks* use the category, and `TaskSummary` gains `status: {code, name, color, category}` plus `closed: boolean`. Projects' gate needs no change of meaning. Its local `CLOSED` set (`stage-task-service.ts:82`) is replaced by `summary.closed`.

**Removing a status in use reassigns its Tasks instead of refusing** (spec FR-016). This differs from CRM and Orders:
- One configuration Command takes a `replacementCode` that must be reachable.
- It updates the Tasks in one statement and writes one `tasks.task.status_change` audit row per moved Task with `reason: 'status_removed'`, so each Task's history shows the move.
- At most `TASK_STATUS_REASSIGN_MAX = 5 000` Tasks can be moved at once; above that it gives 409 `TASK_STATUS_IN_USE_TOO_MANY`, which tells the operator to move some first. The bound keeps the Command inside one transaction of known size.
- The audit rows are written through the platform's audit-writer inside that Command, not as nested Commands. Whether `CommandBus` lets a Command write extra audit rows is checked first in the Foundational phase; the fallback is one Command per Task in batches of 500 under the same lock.

*Rejected:*
- Refusing like CRM: the spec asks for reassignment.
- A status FK to `task_statuses.id`: codes by value are what CRM, Orders and the existing column already use, and they avoid rewriting every row.
- Per-Project workflows: out of scope.

### R-2 — Several assignees: a join table, migrated from the column

**Decision.** `task_assignees` holds `(task_id → tasks on delete cascade, admin_user_id, assigned_at, assigned_by_admin_user_id)` with primary key `(task_id, admin_user_id)` and an index on `admin_user_id`. The migration copies every non-null `assigned_admin_user_id` and then drops the column and its index. A Task may have at most `TASK_ASSIGNEES_MAX = 20` assignees.

**Contracts:**
- `CreateTaskBody.assigneeIds`.
- `PATCH` takes `assigneeIds` (replace) or `addAssigneeIds` / `removeAssigneeIds`.
- `TaskSummary.assignees: TaskAssignee[]`.
- `NewContextTask.assigneeIds`.
- The list filter `assignee` becomes repeatable (`me`, `none` or a uuid; any-of).

**Commands:**
- `tasks.task.assign` becomes `tasks.task.assignees_change` with `{added, removed}`.
- The event `tasks.task.assigned.v1` is **replaced** by `tasks.task.assignees_changed.v1 {taskId, added, removed}`, and `tasks.task.created.v1` carries `assigneeIds`. Nothing subscribes (F-3), but the events are published contract, so the change is a breaking `@endora-commerce/contracts` change. Its changeset follows `specs/conventions/release-intent.md`.

**Notifications:** each newly added assignee other than the actor is notified once, after commit. It is the `#tellAssignee` path, with the F-14 gap fixed: the recipient must hold `tasks:read` (`permissionService.listPermissions`), and for a Task with a context the descriptor's `canSeeAs` must also answer yes.

*Rejected:*
- A `uuid[]` column: it cannot be indexed for "Tasks of X" as cheaply and has no per-assignee timestamp.
- Keeping `assignedAdminUserId` on the port as an alias: Projects is the only caller and changes in the same merge request.

### R-3 — Draft and private: two flags folded into the one visibility predicate

**Decision.** Add `is_draft boolean` and `is_private boolean` to `tasks`.

`TaskVisibility` gains the caller's admin id and whether they hold `tasks:see_private` (permission code, owner ruling Q1 = B). `taskVisibilitySql` adds one conjunct:
```
(t.created_by_admin_user_id = :me
  or (not t.is_draft and (not t.is_private or :seePrivate)))
```
**Drafts are visible to their Creator only, even to holders of `tasks:see_private`** (spec FR-037). The system actor stays unrestricted, and sweeps exclude drafts by their own predicate.

Every read already goes through this one service: lists, counts, the board, `findById`/`findByIds`/`search` of the read port (so CRM's and Projects' references to a private Task resolve as *unavailable*), global search, the panels and the reminders.

**Database checks:**
- `not (is_private and context_type is not null)`: FR-038, a private Task is never in a Project.
- `not (is_draft and source_key is not null)`: Stage Tasks are never drafts.

The services refuse to give a private Task any assignee other than its Creator (422 `TASK_PRIVATE_ASSIGNEE`).

**What a holder of `tasks:see_private` may do with someone else's private Task:** read it and delete it. Every other write gives 403 `TASK_PRIVATE_READ_ONLY`. The routes enforce this through one `TaskAccess.assertMayChange(task)`, which also carries the 163 rule: `canChangeTasks` of the context.

**Publishing** is the Command `tasks.task.publish`. It is one-way and allowed for the Creator only. It sends the notifications a new Task sends, and only then emits `tasks.task.created.v1`: for other modules a draft does not exist yet.

*Rejected:*
- A `visibility` enum: draft and private are independent (spec Assumptions).
- Filtering private Tasks in each consumer: the single predicate is the 163 design (F-1).

### R-4 — Rich description: the shared `record-rich-text` grammar, no schema change

**Decision.**
- **Storage:** the description stays one `text` column. It is now written in the Markdown subset of `packages/contracts/src/record-rich-text.ts` plus reference tokens, which is CRM's and Projects' format. The 20 000-character limit is unchanged.
- **Editor and rendering:** admin-kit `ReferenceField` replaces the `Textarea`, and `ReferenceText` renders the description.
- **Existing Tasks:** existing plain descriptions read as paragraphs. Any literal `**`, `_` or `~~` they contain would now render as formatting. The integration test samples the existing demo descriptions and confirms they contain none. No data migration.

*Rejected:*
- HTML with a sanitiser: it is a second rich-text format, and the platform rejected HTML for record text in feature 143.
- Puck: built for page building.

### R-5 — References and mentions: a `task_references` table and two new kinds platform-wide (issue #446)

**Decision.**
- **Tasks side:**
  - A `task_references` table (`task_id`, `source_kind` description|comment, `source_id`, `target_type`, `target_id`), refreshed inside the Command that saves the text, as `project_references` is.
  - A `TaskReferenceService` that resolves them per reader through the owners' ports with the owners' read permissions. It copies Projects' `reference-service.ts` and `owner-read-permissions.ts`.
- **The grammar gains `opportunity` and `project`.**
  - `RECORD_REFERENCE_TYPES` and `RECORD_DOCUMENT_KINDS` both gain them, so `@@` offers Orders · Quote Requests · Tasks · Opportunities · Projects.
  - Per F-8 the token regex is shared, so CRM's and Projects' extractors would start recognising the new tokens and violate their check constraints. **CRM and Projects therefore adopt the two kinds in the same feature**:
    - one migration each widens the check;
    - their resolvers gain two entries;
    - their document lookups gain two groups, each offered only when the owner is present and the caller holds its permission.
  - This follows the owner's 2026-10-26 ruling to keep one reference standard everywhere (`specs/163-projects-and-tasks/` FR-044).
- **New read-port methods.**
  - `OpportunityReadPort` gains `findByIds(ids)` and `search({q, limit})`. They are tenant-scoped like `findById`. The caller checks `crm:read`, as `owner-read-permissions.ts` already does for every kind.
  - `ProjectReadPort` gains `findByIds(ids)` and `search({q, limit})` through `ProjectAccess`. The implementation file is added to `PROJECT_ACCESS_READERS`.
- **Mentions** copy `mention-service.ts`:
  - **Who can be mentioned:** active admins with `tasks:read` who may see the Task. That is `canSeeAs` for a Task with a context. A private Task has nobody: its mention list is empty, and the Creator's own mention is never notified.
  - **Notification:** newly mentioned people are notified once, after commit, as `tasks.task.mention`. The notification names the Task by number.

*Rejected:*
- Keeping the two kinds Tasks-only through a second grammar: two token grammars in one editor.
- A Tasks-only check constraint while CRM and Projects keep five types: F-8 makes that a crash on paste.

### R-6 — Comments: notes only, Projects' table shape without `kind`

**Decision.**
- **Table:** `task_comments` (`task_id` cascade, `body` 1–20 000 characters of rich text, `author_admin_user_id`, `edited_at`, `deleted_at`, `created_at`), indexed on `(task_id, created_at)`.
- **Commands:** `tasks.comment.add`, `tasks.comment.update` and `tasks.comment.delete` (soft, so the thread shows "deleted"). Only the author may edit or delete a comment.
- **UI:** the kit's `CommentThread` with `kind: 'note'`.
- **Notifications after commit:**
  - Every assignee and the Creator, except the author, is notified once as `tasks.task.comment`.
  - Each newly mentioned person is notified as `tasks.task.mention`.
  - Nobody gets both for one comment: the mention wins.

*Rejected:* a message thread with unread tracking (spec Assumptions).

### R-7 — Attachments: Projects' model, third copy of the active-content guard

**Decision.**
- **Table:** `task_attachments` (`task_id` cascade, `asset_id`, `added_by_admin_user_id`, `created_at`), unique `(task_id, asset_id)`.
- **Upload:** through `assetsLibraryPort.upload` as private. The size limit is `TASK_ATTACHMENT_MAX_BYTES = 25 MB`, and the library's own policy also applies.
- **Active content:** `attachment-active-content.ts` is copied, as CRM and Projects deliberately did.
- **Deletion protection:** `task-asset-references.ts` is registered ungated, so the asset library refuses to delete an attached asset even while Tasks is off.
- **UI:** the kit's `AttachmentUploader`.
- **Dependency:** `assets_library` is `nonDeactivatable`, so it is a normal dependency.

### R-8 — Custom fields: `task` as a host type owned by `tasks`

**Decision.**
- **Registration (F-10):**
  - `'task'` is added to the custom-fields entity-type enum.
  - The `SUPPORTED_ENTITIES.task` entry is `{ownerModuleId: 'tasks', listFilter: true, orgOwned: false}`. A Task has no Organization, as `category` and `organization` do not.
  - The host-storage binding is `{table: 'tasks', column: 'custom_field_values'}`.
  - `custom_fields` i18n is added.
  - The three enumerating tests are updated.
- **Host side:**
  - `tasks.custom_field_values jsonb not null default '{}'`.
  - `validateAndMerge('task', …)` runs inside the create and update Commands.
  - The list and the board pass `customFieldFilters` through `customFieldListFilter.condition('task', …)`.
  - The card fields accept `custom:<key>`.
- **Dependency:** `custom_fields` is `nonDeactivatable`, so it is added to `dependencies`.

### R-9 — Priorities: a configured list, held by code on the Task

**Decision.**
- **Table:** a `@GlobalEntity` `task_priorities` (`code` immutable, `name` json, `default_name`, `color`, `weight`). Lower weight is more urgent.
- **Seed:** `urgent` 10, `high` 20, `normal` 30, `low` 40.
- **On the Task:** `tasks.priority_code text null`, held by value like the status.
- **Sorting:** by `weight` through a join; a Task with no priority sorts last.
- **Removal:** removing a priority in use takes `replacementCode | null` and writes per-Task audit rows, with R-1's bound and fallback.
- This is the owner's "configurable list", built in and not a custom field, per the spec's Assumptions: a custom field cannot order the board or sort the list.

### R-10 — Tags: CRM's model, its UI promoted to admin-kit

**Decision.**
- **Tables:** `task_tags` (`@GlobalEntity`, name ≤ 64, unique on `lower(name)`, colour) and `task_tag_assignments` (`task_id`, `tag_id`) with a composite primary key, cascading on both sides.
- **Per Task:** at most 50 tags (FR-010), set by replacing the whole set.
- **Filter:** AND semantics, as in CRM (F-6).
- **Deletion:** deleting a tag cascades, and the tag's audit row records `usageCount`. No per-Task row is written: an operator removing a vocabulary entry is not an edit of each Task. This is the CRM precedent, recorded as the reading of FR-011.
- **Permissions:** creating a tag needs `tasks:configure` (US9 scenario 4).
- **UI:** CRM's `TagChips`, `TagMultiSelect` and `useTagOptions` move into admin-kit `components/tags/` with the options source injected, and CRM moves onto them. This is the second consumer, so it is promoted (Constitution IX), following the 163 precedent (R-17 there).

### R-11 — Board: CRM's endpoint shape, per-column first page, lanes extended through the list

**Decision.**
- **Endpoint:** `GET /tasks/board` takes the list's filters.
  - It returns `{columns: [{status, count, items, hasMore}]}`, with the columns in weight order.
  - One grouped count runs over the visible set.
  - Then one sequential list query per column fetches the first `perColumn` cards (default 25, at most 50), as CRM does (F-5).
  - Further cards come from `GET /tasks?status=<code>&…`.
- **A move** goes through `POST /tasks/:id/status {to, from}` (R-1).
- **UI:**
  - `KanbanBoard`.
  - `MoveToMenu`, promoted to admin-kit `components/kanban/MoveToMenu.tsx`, with CRM moved onto it (IX).
  - `canDrop` is computed from the workflow's transitions and the caller's right to change the Task.
- **Card fields:** a `tasks.board_card_fields` json setting, defaulting to `builtin:number`, `builtin:assignees`, `builtin:due`, `builtin:priority`, `builtin:tags`, with at most 6. It has the CRM-style catalogue and editor, owned by the `tasks` module, on the workflow page.
- **Board-only filters** are not needed: the board uses the list's filters, custom-field filters included.

*Rejected:* one request per column from the browser, which multiplies the visibility pre-filter (F-1) by the number of columns.

### R-12 — List: keyset paging on any sort

**Decision.**
- **Sort:** `sort` ∈ `created` (default) | `number` | `title` | `due` | `priority` | `status` | `updated`, plus `dir`.
- **Cursor:** base64url json `{k: <sort key value as text>, i: id}`. For `priority` and `status` the key is the joined weight, and nulls are represented explicitly so that "last" is stable.
- **Filters** (FR-020; US3 scenario 4):
  - `status[]`, `statusCategory[]`, `assignee[]`, `creator`
  - `priority[]` (including `none`), `tagId[]`
  - `dueFrom`, `dueTo`, `overdue`
  - `linkedKind` + `linkedId`, `contextType` + `contextId`
  - `parentId`, `isSubtask`, `hasSubtasks`
  - `draft`, `private`
  - `customFieldFilters`, `q`
- **Row additions:** each row also carries `subtasks: {closed, total}`, counted among the sub-tasks the reader may see (FR-028). This is a lateral count under the same visibility predicate.
- **Performance:** checked by extending the 163 perf test to 5 000 Tasks with 3 tags and 2 assignees each (SC-002).

### R-13 — Saved filters: Tasks' own table on the feature-147 model

**Decision.**
- **Table:** `task_list_saved_views`, `@GlobalEntity`, with the columns of `quote_request_list_saved_views`.
- **Routes:** `GET`/`POST /tasks/list-views` and `PATCH`/`DELETE /tasks/list-views/:id`, gated on `tasks:read`.
- **Contract:** `saved-list-views.ts` gains the Task create and update schemas.
- **One view for both screens:** a view stores filters and sort, and both the list and the board apply it.
- **UI:** `SavedViewsControl`.
- **Stale values:** a saved value that no longer exists (a tag, priority, status or person) is dropped on apply and the UI says which. The list endpoint ignores unknown codes instead of answering 422.

### R-14 — List or board, remembered: a new admin preference key

**Decision.**
- **Contract:** `listViewModes: Record<adminListId, 'list' | 'board'>` is added to `ADMIN_PREFERENCE_KEYS`. It merges per list like `listPageSizes`: setting `null` deletes an entry.
- **Admin-kit:** `store.ts` and `use-admin-preference.ts` gain the key, plus a hook `useListViewModePreference(listId)`.
- **Tasks:** uses the list ids `tasks` and `tasks-mine`.
- **Scope:** the key is generic, so CRM could adopt it later. That is not part of this feature.
- **Migration:** none (F-12).

*Rejected:* `localStorage`, because FR-018 requires the choice to follow the user across devices.

### R-15 — Sub-tasks and related Tasks

**Decision.**
- **Sub-tasks:** `tasks.parent_task_id uuid null references tasks(id) on delete set null`, which gives FR-029: deleting a parent makes its children top-level.
- **Parent changes** run under `pg_advisory_xact_lock(hashtext('tasks.hierarchy'))`, then a recursive CTE refuses:
  - a cycle (422 `TASK_PARENT_CYCLE`);
  - a resulting depth above `TASK_HIERARCHY_DEPTH_MAX = 5` (422 `TASK_HIERARCHY_TOO_DEEP`).

  Parent changes are rare, so one global lock is cheaper to reason about than per-row locks on two branches.
- **Related Tasks:** `task_relations (task_a_id, task_b_id)` with `a < b`, unique, cascading on both sides, through Commands `tasks.task.relate` and `tasks.task.unrelate`.
- **Closing a parent with open sub-tasks:** the transition answer carries `openSubtasks` for the warning (FR-028) and is not refused.
- **Visibility:** each Task's own, so a hidden parent shows as unavailable and hidden sub-tasks are never counted.

### R-16 — Links to Opportunities, Orders and Quote Requests: a link table, no visibility effect (Q2 = A)

**Decision.**
- **Table:** `task_record_links` (`task_id` cascade, `record_kind` opportunity|order|quote_request, `record_id`, `linked_by_admin_user_id`, `created_at`), unique `(task_id, record_kind, record_id)`, indexed on `(record_kind, record_id)`.
- **Validation when linking:**
  - The owner must be present.
  - The caller must hold the owner's read permission (`crm:read`, `orders:read`, `rfqs:handle`).
  - The record must be findable through its port. Otherwise the link is refused with 422 `TASK_LINK_INVALID`.
- **Rendering:** labels are resolved per reader through the same owner ports as references (R-5). A reader who cannot see the record, a module that is off and a deleted record all show as *unavailable*.
- **Commands:** `tasks.task.link` and `tasks.task.unlink`.
- **Panels:** `tasks` contributes a `TasksPanel` to `order.detail.after`, `quote_request.detail.after` and `opportunity.detail.after` (F-15), gated on `tasks:read`.
  - The panel reads `GET /tasks?linkedKind=&linkedId=`.
  - It offers *Add task*, which goes to `/tasks/new?link=<kind>:<id>`.
  - Host modules name nothing.
- **Projects stay the 163 context** (one, visibility-bearing). A Task "linked to a Project" is a Task in that Project's context, and the Task editor offers the Project and Stage picker through the context descriptor's lookups.
- **Dependency edges:** `degrades-without` on `crm` (`opportunityReadPort`), `quote_requests` (`quoteRequestReadPort`) and `projects` (`projectReadPort`, for references). `orders` and `catalog` are non-deactivatable, so they are `dependencies`.

### R-17 — Reminders: CRM's 60-second sweep, delivery rows per recipient

**Decision.**
- **Due moment:** `tasks.due_at timestamptz null` is added beside `due_on`.
  - When the user gives a time, the browser sends an ISO instant and the server stores `due_at` and derives `due_on` in the Tasks time zone.
  - Without a time only `due_on` is stored, and the Task becomes overdue at the start of the next day in that time zone.
  - The time zone is a new setting, `tasks.time_zone` (default `Europe/Warsaw`, validated by a copy of Projects' `alerts-time-zone-validator.ts`). `analytics.reporting_time_zone` is not used, because `analytics` is switchable and its fallback is `UTC` (F-13).
- **Tables:**
  - `task_reminders`: `task_id` cascade, `created_by_admin_user_id`, `mode` absolute|relative, `remind_at timestamptz`, `offset_minutes int null`, `recipient_admin_user_ids uuid[]` (1–21 entries), `created_at`.
  - `task_reminder_deliveries` (`reminder_id`, `admin_user_id`, `delivered_at`), unique per pair.
- **Relative reminders:**
  - `remind_at` is recomputed inside the Command that changes the due moment.
  - Removing the due date deletes those reminders, with an audit row that the Task's history shows.
- **The sweep:**
  - Queue `tasks-reminders`, Job Scheduler every 60 s, `ctx.worker`, `concurrency: 1`.
  - It uses the presence check and the `scheduled-work-probe.ts` copy (F-13), plus the copy-drift test.
  - It runs under `enterSystemScope('tasks: deliver due reminders')`.
  - It selects reminders with `remind_at <= now()` that still have recipients with no delivery row.
  - For each recipient it checks four things:
    - the Task is open and not a draft;
    - the recipient is active and holds `tasks:read`;
    - the recipient may see the Task: `canSeeAs` for a Task with a context, and Creator or `tasks:see_private` for a private one;
    - Tasks is present.
  - It then writes the delivery row and the bell entry (`tasks.task.reminder`) **in one transaction**. The unique key makes the bell exactly-once.
  - The e-mail (`tasks_task_reminder`) is sent after commit with `messageId = tasks_task_reminder:<deliveryId>`.
- **The e-mail is at most once:** a crash between the commit and the send loses it, while the bell stays.
  - The spec's SC-004 ("exactly once") is achievable for the bell and not for an e-mail without an outbox. It is amended accordingly; see `plan.md` *Amendments from planning*.
  - CRM's outcome-column retry pattern was rejected: it trades the loss for possible duplicates, and a duplicate reminder e-mail is worse than a missing one when the bell entry exists.
- **Reminders after downtime or while Tasks was off:** the backlog is drained once, and each delivery row is written once.
  - A reminder that fell due less than `TASK_REMINDER_GRACE = 24 h` earlier is delivered.
  - An older one gets a delivery row with `outcome = 'expired'` and nothing is sent.
  - This one rule reconciles spec US7 scenario 2 (deliver after downtime) with scenario 6 (nothing accumulates while Tasks is off), which otherwise contradict each other for a long switch-off. It is recorded in `plan.md` *Amendments from planning*.

### R-18 — Daily digest: a subscription table, sent by the same worker

**Decision.**
- **Table:** `task_digest_subscriptions` (`admin_user_id` primary key, `hour smallint 0–23`, `last_sent_on date null`, `updated_at`), `@GlobalEntity`.
  - It is not stored in admin preferences, because the worker must find subscribers by SQL and preferences are keyed per admin.
  - Off means no row (owner ruling Q3 = A).
- **Endpoints:** `GET`/`PUT`/`DELETE /tasks/me/digest`.
- **The sweep** runs in the same `tasks-reminders` worker, at most every 15 minutes:
  - It claims subscribers with `update … set last_sent_on = :today where hour <= :localHour and (last_sent_on is null or last_sent_on < :today) … returning`, under `skip locked`, so a day's digest is claimed once even across DST changes.
  - For each subscriber it lists their open, published Tasks with `due_on <= :today` or `due_at <= end of today`, filtered by the same four checks as reminders.
  - It sends one bell entry (`tasks.digest.daily`) and one e-mail (`tasks_daily_digest`) only when the list is not empty.
- **E-mail content:** the list goes in as one preformatted variable (`taskList`, plus `taskCount`), because `simpleEmailBodyTree` has no loops. Whether the template engine supports a repeated block is checked during implementation; the variable is the fallback.

### R-19 — Issue #450: a source key for idempotent creation, an existence question for the clean-up

**Decision.**
1. **Idempotent creation.**
   - `tasks.source_key text null` gets a unique partial index on `(context_type, context_id, source_key) where source_key is not null`.
   - `NewContextTask.sourceKey?` is a string of at most 100 characters. Projects passes the Stage Task's id.
   - `createMany` skips a key that already exists in that context and returns its id among `ids`, so a retry creates only what is missing. The unique index also closes the race between two retries: a unique violation counts as "already created".
   - This replaces the "one transaction" alternative named in the issue. That alternative would hold one transaction across up to 100 Commands and their notifications.
2. **Clean-up of orphans.**
   - `TaskContextDescriptor` gains an optional `existingContexts(ids): Promise<Map<contextId, Set<groupId>>>`. Its stated contract: which of these contexts still exist, and which groups each has, **regardless of who may see them**. It is called only under the system actor.
   - Projects implements it with one query over `projects` and `project_stages`, through `ProjectAccess` in system mode. The file joins `PROJECT_ACCESS_READERS`.
   - A `tasks-maintenance` pass in the same worker runs every 15 minutes, gated on presence and on the probe "any Task has a context".
   - For each **present** contributor that implements the method, it walks distinct `(context_type, context_id)` pairs in batches of 500:
     - it deletes the Tasks of contexts that no longer exist, through `tasks.task.delete` as the system with `reason: 'context_gone'`;
     - it clears `context_group_id` of Tasks whose group is gone, through `tasks.task.update` with `reason: 'context_group_gone'`.
   - **Absent owners are never asked.** `registry.present()` excludes them, so a Project whose module is off is never treated as deleted (FR-040).
   - A pass at most every 15 minutes meets "within one hour" (SC-006) with margin.
   - *Rejected:* a pass triggered only when Tasks switches back on, because the flip happens in a process that runs no workers (module-activation convention, item 2).

### R-20 — Permissions and settings

**New permissions:**
- `tasks:configure` (requires `tasks:read`) covers the workflow, tags, priorities, the card fields and the time zone.
- `tasks:see_private` (requires `tasks:read`) covers reading and deleting other users' private Tasks (Q1 = B).

**New settings:**
- `tasks.board_card_fields` (json)
- `tasks.time_zone` (string)

**New error codes**, declared in the manifest and in i18n, each added with its first raise site:
- `TASK_STATUS_UNKNOWN`, `TASK_TRANSITION_FORBIDDEN`, `TASK_TRANSITION_CONFLICT`
- `TASK_WORKFLOW_INVALID`, `TASK_STATUS_IN_USE_TOO_MANY`
- `TASK_PRIORITY_UNKNOWN`
- `TASK_TAG_NAME_TAKEN`, `TASK_TAG_UNKNOWN`
- `TASK_PRIVATE_ASSIGNEE`, `TASK_PRIVATE_READ_ONLY`, `TASK_ALREADY_PUBLISHED` (settled at T078 in place of `TASK_DRAFT_ONLY_CREATOR`: somebody else's draft is 404 for them)
- `TASK_PARENT_CYCLE`, `TASK_HIERARCHY_TOO_DEEP`
- `TASK_LINK_INVALID`
- `TASK_ATTACHMENT_REFUSED`
- `TASK_REMINDER_INVALID`
- `TASK_VIEW_NAME_TAKEN`

### R-21 — Composition and tenancy

**Tenancy classification:**
- Every new table hanging off a Task is `@RuleScoped` and read only through `TaskVisibility`: assignees, tag assignments, comments, references, attachments, links, relations, reminders and deliveries. Feature 163's F-2 forbids transitive children under a rule-scoped parent.
- `task_statuses`, `task_status_transitions`, `task_priorities` and `task_tags` are `@GlobalEntity` configuration.
- `task_list_saved_views` and `task_digest_subscriptions` are `@GlobalEntity` per-admin rows, as in feature 147.

**Seam test:** a test like `project-access-seam.test.ts` fails if a route or service under `T/backend/` reads a Task-owned table without going through `TaskVisibility` or `TaskAccess`.

**Composition** stays in the one `T/backend/index.ts` (`check:port-dependencies` reads only that file).

**Manifest:**
- `dependencies` gains `custom_fields`, `assets_library`, `transactional_emails`, `orders` and `catalog`, all non-deactivatable.
- `degrades-without` edges are added on `crm`, `quote_requests` and `projects`, each with its `whenAbsent`.
- One `contributes-to` edge is added, on the asset library's asset-reference registry (R-7).
- Custom fields need no edge: the registry is central (F-10), so `custom_fields` names `tasks`, not the other way round.

**Cycles:** `projects` already declares a `degrades-without` edge on `tasks`. Non-binding edges do not enter the `dependencies` graph that orders migrations, so there is no cycle.

### R-22 — Admin UI

**Screens:**
- `/tasks`: list and board, toggled.
- `/tasks/mine`: list and board, toggled, plus a *Daily digest* control.
- `/tasks/new`: takes `?link=`, `?parent=` and `?context=`.
- `/tasks/:id`: the reworked detail screen.
- `/tasks/settings/workflow`: statuses, the graph and the card fields.
- `/tasks/settings/tags`
- `/tasks/settings/priorities`
- `/tasks/settings/general`: the time zone.

**Command palette:** three actions are added, *Task workflow*, *Task tags* and *Task priorities* (Constitution XVI).

**Promoted to admin-kit:** `MoveToMenu` and the tag components, with CRM moved onto them. Everything else listed in F-7 is already in the kit.

**Accessibility:**
- The board has a keyboard move, through `MoveToMenu`.
- The status picker offers only the permitted transitions.
- The `ux-laws` rules apply to every new screen, and the `endora-commerce-designer` agent reviews the board and the detail page before release.

### R-23 — Demo data

`demoProjectTasksStep` writes assignees into `task_assignees` instead of the dropped column. Its statuses stay the seeded codes. A new `demoTasksStep`, in the `tasks` module's own demo, adds 10 Tasks without a Project, covering:
- two tags and a priority;
- a parent with three sub-tasks;
- two comments with references;
- a link to a demo Order;
- one private Task and one draft for the demo admin.

`demo-shop.test.ts` counts move accordingly.

**Settled at T088:** the step is not in the `tasks` module — a standalone Task names `admin_users`' rows, so it is a demo-composition step, `packages/demo-composition/src/tasks.ts`, as the Project Tasks are (`tasks` keeps `demo: false`). The Order link is made only where the demo organisation has an Order; the demo seeds none, so the demo shop has no link row. `demoProjectTasksStep` also writes each Stage Task's `source_key` (R-19).

## Implementation rulings

Decided while implementing (2026-10-28 – 2026-10-29), each recorded under its task in `tasks.md` with the test that holds it. The user-visible ones are also listed in `spec.md` *Amendments*.

| Ruling | Where it was settled | What it replaces |
| --- | --- | --- |
| Publishing somebody else's draft is **404 `TASK_NOT_FOUND`**, identical to a missing Task; publishing a published Task is **409 `TASK_ALREADY_PUBLISHED`**. | T076/T078 | "403 `TASK_DRAFT_ONLY_CREATOR`" (R-20), unreachable without first revealing the draft (SC-005); the code left `TASKS_ERROR_CODES`. |
| **A draft emits no event** — `created`, `assignees_changed`, `status_changed`, `deleted` — while it is one; `tasks.task.created.v1` is emitted at publication with the assignees it has then. Audit rows are written as for any Task. | T078 | R-3 said a draft does not exist for other modules; the events were not named. |
| ***My Tasks* excludes drafts**; the Creator uses the list's `draft=true` filter. | T018, re-checked at T078 | — (admin-api §1 already implied it). |
| **`DELETE /tasks/:id` → 200 `{data: {subtasksDetached}}`**, the former sub-tasks the caller may see. | T062 | "204 … also reports" (admin-api §1). |
| A Stage retry's **`created` counts the Stage's Tasks after it ran**, earlier attempts' included (`createMany` answers their ids). No contract change. | T086 | — |
| **A Task's priority is checked inside its Command**: `createTaskCommand` and `changeTaskPriorityCommand` hold the priority row `FOR SHARE` and answer 422 `TASK_PRIORITY_UNKNOWN` when it is gone (issue #507). | Phase 12 (T082 note) | A check before the Command only. |
| **The maintenance pass runs one Command per Task** — `deleteTaskCommand(id, auditLog, {reason: 'context_gone', onlyIn})` or `ungroupTaskCommand` (`reason: 'context_group_gone'`) — each re-checking under its own lock. | T087 | `recordReassignments` inside one Command (R-19). |
| **Priorities reuse the status error codes**: a taken code and a missing replacement are 422 `TASK_WORKFLOW_INVALID` with `rule` `priority_code_taken` / `priority_replacement_required`; the bound is 409 `TASK_STATUS_IN_USE_TOO_MANY` with `details.code: 'priority'`. | T082 | New codes per refusal. |
| **Board card fields and the time zone are written through the settings module's audited write** (`setValueForAllChannels`), CRM's precedent, not Tasks Commands. | T055, T071 | `tasks.board.card_fields` / `tasks.time_zone.change` Commands (data-model §7). |
| **A reminder's bell entry is written with `adminNotificationRecordPort.recordWithin(em, input)`**, co-transactionally with the delivery row: the bell exactly once, the e-mail at most once (SC-004 amended). | T072 (orchestrator ruling 3) | The de-duplication fallback of the plan. |
| **Assignees added in one Command get distinct `assigned_at`**, each row stamped 1 ms after the previous in input order, so the read order (`assigned_at`, then `admin_user_id` — the same in the Command, `task-service.ts` and `comment-service.ts`) is the order they were given. **Kept, re-judged at T096:** the order is already deterministic without the stamp (the `admin_user_id` tie-break), but it would then be the ids' order rather than the order a user chose; a position column is a schema change for a display order; the stamps are at most 20 ms apart (≤ 20 assignees) and never collide with a later Command's. Nothing reads `assigned_at` as a business time finer than a second. | T016, re-checked at T096 | — |

