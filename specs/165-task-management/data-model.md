# Data model: Task management

All of the schema below is the `tasks` module's. It arrives in **one** migration,
`<stamp>_tasks_task_management.ts`, scaffolded with
`pnpm --filter backend run migration:new -- --module tasks --name task_management`, and it lands
in the Foundational phase so that later stories never regenerate the registries.

Two other modules get one migration each, which widens their reference check: CRM and
Projects (§6). Decisions are cited as R-n from [research.md](./research.md).

## 1. `tasks` (altered)

| Column | Change | Notes |
| --- | --- | --- |
| `status` | drop `tasks_status_check` | Holds a code from `task_statuses` (R-1). The default `'todo'` stays as the seed's initial status; the service always writes the *current* initial status. |
| `assigned_admin_user_id` | **dropped** after its values are copied to `task_assignees` | Its index is dropped too (R-2). |
| `due_at` | **new** `timestamptz null` | When set, `due_on` = `due_at`'s date in `tasks.time_zone` (R-17). |
| `start_on` | **new** `date null` | FR-002. |
| `priority_code` | **new** `text null` | By value (R-9). |
| `is_draft` | **new** `boolean not null default false` | R-3. |
| `is_private` | **new** `boolean not null default false` | R-3. |
| `parent_task_id` | **new** `uuid null references tasks(id) on delete set null` | R-15. |
| `source_key` | **new** `text null`, ≤ 100 characters | R-19. |
| `custom_field_values` | **new** `jsonb not null default '{}'` | R-8. |
| `published_at` | **new** `timestamptz null` | Set at creation for a non-draft Task and at publication for a draft. Existing rows get `created_at`. |

**New checks:**
- `tasks_private_context_check`: `not (is_private and context_type is not null)`.
- `tasks_draft_source_check`: `not (is_draft and source_key is not null)`.
- `tasks_parent_self_check`: `parent_task_id <> id`.

**New indexes:**
- `(parent_task_id)`
- `(priority_code)`
- `unique (context_type, context_id, source_key) where source_key is not null`
- `(created_by_admin_user_id) where is_draft or is_private`
- `(due_on, status)` already exists; `(due_at) where due_at is not null` is added.

## 2. New tables owned by a Task (`@RuleScoped`, read only through `TaskVisibility`)

| Table | Columns | Keys / constraints |
| --- | --- | --- |
| `task_assignees` | `task_id`, `admin_user_id`, `assigned_at`, `assigned_by_admin_user_id null` | pk `(task_id, admin_user_id)`; fk task on delete cascade; index `(admin_user_id)`. At most 20 per Task, checked by the service. |
| `task_tag_assignments` | `task_id`, `tag_id` | pk `(task_id, tag_id)`; fk task cascade, fk `task_tags` cascade; index `(tag_id)`. At most 50 per Task. |
| `task_comments` | `id`, `task_id`, `body text` (1–20 000), `author_admin_user_id`, `edited_at null`, `deleted_at null`, `created_at` | fk task cascade; index `(task_id, created_at)`. |
| `task_references` | `id`, `task_id`, `source_kind` (`description` \| `comment`), `source_id uuid null`, `target_type`, `target_id` | fk task cascade; check `target_type in ('admin_user','order','product','quote_request','task','opportunity','project')`; check `(source_kind = 'comment') = (source_id is not null)`; indexes `(task_id)`, `(target_type, target_id)`. |
| `task_attachments` | `id`, `task_id`, `asset_id`, `added_by_admin_user_id`, `created_at` | fk task cascade; unique `(task_id, asset_id)`; index `(asset_id)`. |
| `task_record_links` | `id`, `task_id`, `record_kind` (`opportunity` \| `order` \| `quote_request`), `record_id`, `linked_by_admin_user_id`, `created_at` | fk task cascade; unique `(task_id, record_kind, record_id)`; index `(record_kind, record_id)`. |
| `task_relations` | `task_a_id`, `task_b_id`, `created_by_admin_user_id`, `created_at` | pk `(task_a_id, task_b_id)`; check `task_a_id < task_b_id`; both fk cascade; index `(task_b_id)`. |
| `task_reminders` | `id`, `task_id`, `created_by_admin_user_id`, `mode` (`absolute` \| `relative`), `remind_at timestamptz`, `offset_minutes int null`, `recipient_admin_user_ids uuid[]`, `created_at` | fk task cascade; check `(mode = 'relative') = (offset_minutes is not null)`; check `cardinality(recipient_admin_user_ids) between 1 and 21`; index `(remind_at)`. At most 10 reminders per Task. |
| `task_reminder_deliveries` | `id`, `reminder_id`, `admin_user_id`, `outcome` (`delivered` \| `expired` \| `skipped`), `recorded_at` | fk reminder cascade; unique `(reminder_id, admin_user_id)`. `skipped` covers a recipient who may no longer see the Task, or a Task that is closed or a draft. |

## 3. Configuration and per-admin tables (`@GlobalEntity`)

| Table | Columns | Keys / constraints | Seed |
| --- | --- | --- | --- |
| `task_statuses` | `id`, `code` (snake_case, ≤ 64, immutable), `name jsonb` `{en, pl}`, `default_name` (≤ 120), `category` (`open` \| `done` \| `cancelled`), `is_initial`, `weight int`, `color` (`#rrggbb`), timestamps | unique `code`; partial unique index `(is_initial) where is_initial`; category check | `todo` (initial, open, 10), `in_progress` (open, 20), `done` (done, 30), `cancelled` (cancelled, 40); the colours of today's `StatusBadge` |
| `task_status_transitions` | `id`, `from_code`, `to_code`, `created_at` | unique `(from_code, to_code)`; check `from_code <> to_code`; index `(from_code)` | all 12 moves among the four |
| `task_priorities` | `id`, `code`, `name jsonb`, `default_name`, `color`, `weight`, timestamps | unique `code` | `urgent` 10, `high` 20, `normal` 30, `low` 40 |
| `task_tags` | `id`, `name` (≤ 64), `color` (default `#64748b`), timestamps | unique index on `lower(name)` | — |
| `task_list_saved_views` | `id`, `owner_admin_user_id`, `name` (≤ 160), `shared`, `filters jsonb` (≤ 8 KB), `sort jsonb null`, `visible_columns jsonb null`, timestamps | unique `(owner_admin_user_id, lower(name))` | — |
| `task_digest_subscriptions` | `admin_user_id` (pk), `hour smallint` (0–23), `last_sent_on date null`, `updated_at` | hour check | — |

A status or priority is never referenced by foreign key: Tasks hold the code (R-1, R-9).
Removing one in use runs through its reassignment Command.

## 4. Settings (in `tasks`' manifest, group `tasks`)

| Code | Type | Default | Who may change it |
| --- | --- | --- | --- |
| `tasks.enabled` | boolean | `true` | Unchanged; this is the activation control. |
| `tasks.board_card_fields` | json, string[] ≤ 6 of `builtin:<key>` / `custom:<key>` | `["builtin:number","builtin:assignees","builtin:due","builtin:priority","builtin:tags"]` | `tasks:configure` |
| `tasks.time_zone` | string (IANA) | `Europe/Warsaw` | `tasks:configure` |

## 5. Domain rules

- **Status workflow (R-1).**
  - There is exactly one initial status, and it is `open`.
  - There is at least one `done` status and at least one `cancelled` status.
  - Every transition names two existing codes.
  - Any category may have outgoing edges, which is how a Task is reopened.
  - Every configuration Command ends with `TaskStatusGraph.assertValid()`. A failure gives 422 `TASK_WORKFLOW_INVALID {rule}`.
- **Status change.**
  - The target must be reachable from the current status. The write port's `createMany` starts at the initial status, and the system actor is not exempt.
  - Entering a `done` status sets `completed_at = now()`; leaving one clears it.
  - The response carries `openSubtasks` for the UI's warning.
- **Assignees.**
  - Each assignee must be an active admin when added.
  - On a Task with a context, the descriptor's `canSeeAs` must answer yes, or the HTTP write is 422 `TASK_ASSIGNEE_INVALID` naming the person (spec *Edge Cases*; #506, option A). 163 accepted such an assignee and only did not tell them; the write port still does, since its caller owns the context.
  - On a private Task, the Creator is the only possible assignee.
- **Hierarchy (R-15).**
  - No cycles, and a depth of at most 5.
  - Changes run under one advisory lock.
  - Deleting a parent leaves its children top-level, by `set null`.
- **Draft.**
  - Visible to the Creator only.
  - Publishing is one-way and done by the Creator.
  - A draft is excluded from the gate (`listOpenInContext`), from reminders, from the digest and from notifications.
- **Private.**
  - Visible to the Creator and to holders of `tasks:see_private`, who may read and delete it only.
  - A private Task has no context.
- **Due moment.**
  - With `due_at`, the Task is overdue once `now() > due_at`.
  - With only `due_on`, it is overdue once the date in `tasks.time_zone` is later than `due_on`.
  - Only open Tasks can be overdue.
- **Relative reminders.**
  - `remind_at = due moment − offset_minutes`. A date-only due moment counts as 09:00 in `tasks.time_zone`.
  - They are recomputed in the same Command as a due-date change, and deleted when the due date is removed.

## 6. Schema changes outside `tasks`

| Module | Migration | Change |
| --- | --- | --- |
| `crm` | `<stamp>_crm_opportunity_reference_kinds.ts` | `crm_opportunity_references_target_type_check` gains `'opportunity','project'`; `down` restores the five. |
| `projects` | `<stamp>_projects_reference_kinds.ts` | `project_references_target_type_check` gains `'opportunity','project'`; `down` restores the five. |
| `custom_fields` | none | No check on `entity_type` (F-10). |
| `admin_users` | none | `admin_user_preferences` has no key check (F-12). |

## 7. Audit actions (all through `CommandBus.run`)

| Group | Actions |
| --- | --- |
| **Task** | `tasks.task.create`, `.update`, `.status_change` (`reason?`: `status_removed`), `.assignees_change`, `.tags_change`, `.priority_change`, `.parent_change`, `.relate`, `.unrelate`, `.link`, `.unlink`, `.publish`, `.privacy_change`, `.custom_fields_change`, `.delete` (`reason?`: `context_gone`) |
| **Comment** | `tasks.comment.add`, `.update`, `.delete` |
| **Attachment** | `tasks.attachment.add`, `.remove` |
| **Reminder** | `tasks.reminder.add`, `.remove`, `.removed_with_due` |
| **Configuration** | `tasks.status.create`, `.update`, `.delete`; `tasks.transitions.change`; `tasks.priority.create`, `.update`, `.delete`; `tasks.tag.create`, `.update`, `.delete`; `tasks.board_card_fields.change`; `tasks.time_zone.change` |
| **Per admin** | `tasks.view.create`, `.update`, `.delete`; `tasks.digest.subscribe`, `.unsubscribe` |
| **Bookkeeping** (`command-coverage-ignore`, with reasons, CRM precedent) | reminder delivery rows; digest `last_sent_on` claims |

The Task's history screen shows every Task action. Its `SHOWN_HISTORY_FIELDS` grows to
assignees, priority, tags, parent, links, draft/private, due time, start date and custom fields.

## 8. Events (published, `packages/contracts/src/tasks.ts`)

| Event | Payload | Change |
| --- | --- | --- |
| `tasks.task.created.v1` | `{taskId, contextType, contextId, contextGroupId, assigneeIds}` | `assignedAdminUserId` → `assigneeIds`. Emitted at publication for a draft. |
| `tasks.task.status_changed.v1` | `{taskId, from, to, toCategory, …context}` | Gains `toCategory`. `from` and `to` become codes (strings). |
| `tasks.task.assignees_changed.v1` | `{taskId, added, removed}` | **Replaces** `tasks.task.assigned.v1`, which had no subscriber (F-3). |
| `tasks.task.deleted.v1` | unchanged | — |

## 9. Volumes assumed

- About 10 000 Tasks a year.
- Up to 20 assignees and 50 tags per Task, with typical values of 1–3 and 0–5.
- Up to 10 reminders per Task.
- Up to 30 statuses and 20 priorities.
- Tags in the hundreds.
- The perf test seeds 5 000 visible Tasks (R-12).
