# Contract: Tasks admin API (additions and changes)

- **Base path:** `/api/v1/admin/tasks`.
- **Schemas:** every request and response schema lives in `packages/contracts/src/tasks.ts`. It is written in the Foundational phase, before the first route (Constitution II).
- **Errors:** they use the platform envelope `{error: {code, message, details?}}`, and each code is declared in the manifest's `errorCodes`.
- **Off state:** while `tasks` is off, every route answers 503 through `ctx.routes`.
- **Gates:** each route is guarded with `requireAdmin(code)`.
- **Tables:** in the tables below, **R** means `tasks:read`, **W** means `tasks:write` and **C** means `tasks:configure`.

**What applies to every read.**
- Every read is narrowed by `TaskVisibility`: context, draft and private (R-3).
- When a Task is hidden from the caller, the answer is 404 `TASK_NOT_FOUND`, exactly as when the Task does not exist.

**What applies to every write.**
- Every write runs `TaskAccess.assertMayChange`:
  - A holder of `tasks:see_private` working on someone else's private Task gets 403 `TASK_PRIVATE_READ_ONLY`. Only reading and deleting are allowed.
  - When the context's `canChangeTasks` answers no, the write is refused with 403.

## 1. Tasks

| Method and path | Gate | Body / query | Answer |
| --- | --- | --- | --- |
| `GET /tasks` | R | `TaskListQuery` (R-12) | `{data: TaskSummary[], nextCursor, prevCursor?}` |
| `GET /tasks/mine` | R | the same filters; `assignee=me`, `statusCategory=open` and no draft are implied | `{data: TaskSummary[]}`, ≤ 500 |
| `GET /tasks/board` | R | `TaskListQuery` without cursor and sort, plus `perColumn` (1–50, default 25) | `TaskBoard {columns: [{status, count, items: TaskSummary[], hasMore}]}` |
| `GET /tasks/:id` | R | — | `TaskDetail` |
| `POST /tasks` | W | `CreateTaskBody` | 201 `TaskDetail` |
| `PATCH /tasks/:id` | W | `UpdateTaskBody` | `TaskDetail` |
| `POST /tasks/:id/status` | W | `{to: code, from: code}` | `{task: TaskDetail, openSubtasks: number}`. 409 `TASK_TRANSITION_FORBIDDEN {allowedTargets}`, 409 `TASK_TRANSITION_CONFLICT`, 422 `TASK_STATUS_UNKNOWN` |
| `POST /tasks/:id/publish` | W (Creator) | — | `TaskDetail`. Somebody else's draft is 404 `TASK_NOT_FOUND`, as for any hidden Task; 409 `TASK_ALREADY_PUBLISHED` when the Task is not a draft (settled at T078; was written "403 `TASK_DRAFT_ONLY_CREATOR`", which no caller could reach without the draft first being revealed to them) |
| `DELETE /tasks/:id` | W, or R + `tasks:see_private` on a private Task | — | 200 `{data: {subtasksDetached}}` — the former sub-tasks the caller may see (settled at T062; was written "204 … also reports") |
| `GET /tasks/:id/history` | R | cursor | `RecordHistoryPage`; references are resolved |

**`TaskListQuery`**, in addition to the 163 fields:
- `status[]` (codes) and `statusCategory[]`
- `assignee[]` (`me` | `none` | uuid; any-of) and `creator` (`me` | uuid)
- `priority[]` (codes | `none`) and `tagId[]` (AND)
- `dueFrom`, `dueTo`, `overdue`
- `linkedKind` + `linkedId` (both or neither)
- `parentId`, `isSubtask`, `hasSubtasks`
- `draft` (only the caller's own) and `private`
- `customFieldFilters`
- `sort` (`created` | `number` | `title` | `due` | `priority` | `status` | `updated`) and `dir`

Unknown status, priority and tag ids **match nothing**; they never produce a 422 (R-13).

**`CreateTaskBody`:**
- `title`, `description` (rich text)
- `assigneeIds[]` (≤ 20)
- `dueOn` | `dueAt`, `startOn`
- `priorityCode`, `tagIds[]` (≤ 50)
- `customFields`
- `context` (163)
- `parentTaskId`
- `links[] {kind, id}` (≤ 20)
- `draft`, `private`

**`UpdateTaskBody`:** any of the fields above, partial, with at least one present. It also accepts:
- `addAssigneeIds` / `removeAssigneeIds` as an alternative to `assigneeIds` (replace);
- `parentTaskId: null` to detach a sub-task;
- `private` (Creator only).

**Assignees** (both bodies): each an active admin holding `tasks:read`, else 422 `TASK_ASSIGNEE_INVALID`. On a Task with a context, each must also pass the descriptor's `canSeeAs` — those named, and on a move to another record those the Task keeps — else 422 `TASK_ASSIGNEE_INVALID` with `details {code: 'context_hidden', name, adminUserId}` naming the first refused (spec *Edge Cases*; issue #506, owner ruling 2026-10-29, option A). `taskWritePort.createMany` asks only the first rule: its caller owns the context and names the assignees (a Project's Stage holder).

`status` is **not** accepted here; a status change goes through `/status`.

**`TaskSummary`:**
- `id`, `number`, `title`
- `status {code, name, color, category}` and `closed`
- `assignees[] {id, name, active}`
- `dueOn`, `dueAt`, `overdue`
- `priority {code, name, color} | null`, `tags[] {id, name, color}`
- `context` (163)
- `parent {id, number, available} | null`, `subtasks {closed, total}`
- `draft`, `private`
- `cardFields?` (board only)
- `createdAt`, `updatedAt`

**`TaskDetail`** is `TaskSummary` plus:
- `description` and `references[]`
- `startOn`, `customFields`
- `links[] {kind, id, available, label, url}`
- `relatedTasks[]`, `subtasks[]` (summaries)
- `attachmentsCount`, `commentsCount`, `reminders[]` (only the caller's own reminders and those that name the caller)
- `creator`, `publishedAt`
- `permissions {canChange, canDelete, canPublish}`

## 2. Collaboration

| Method and path | Gate | Notes |
| --- | --- | --- |
| `GET /tasks/:id/comments` | R | `RecordComment[]`, oldest first, references resolved |
| `POST /tasks/:id/comments` | R + may see the Task | `{body}`. Notifies (R-6) |
| `PATCH` / `DELETE /tasks/:id/comments/:commentId` | author | 403 for anyone else |
| `GET /tasks/:id/attachments` | R | — |
| `POST /tasks/:id/attachments` | W | multipart upload, or `{assetId}`. 415 `TASK_ATTACHMENT_REFUSED` |
| `DELETE /tasks/:id/attachments/:attachmentId` | W | — |
| `PUT /tasks/:id/relations/:otherId` / `DELETE …` | W on both Tasks | 204, idempotent both ways; a Task related to itself is 400 `VALIDATION_FAILED` |
| `POST /tasks/:id/links` / `DELETE /tasks/:id/links/:linkId` | W | `{kind, id}`. 422 `TASK_LINK_INVALID`. `POST` answers `{data: TaskLink}` — 201 for a new link, 200 with the existing one (idempotent, nothing recorded; settled at T066); `DELETE` 204, 404 `NOT_FOUND` for a link the Task does not have |
| `GET /tasks/:id/reminders` | R | — |
| `POST /tasks/:id/reminders` | W | `{remindAt}` or `{offsetMinutes}`, plus `recipientIds[]` drawn from the caller and the assignees. 422 `TASK_REMINDER_INVALID` |
| `DELETE /tasks/:id/reminders/:reminderId` | creator of the reminder, or W | — |

## 3. Lookups

| Method and path | Gate | Notes |
| --- | --- | --- |
| `GET /tasks/lookups/assignees?q=&taskId=&contextType=&contextId=` | W | Active admins with `tasks:read` who may see the Task — for a Task in a context, those its `canSeeAs` admits. Answers only the Creator for a private Task. `contextType`+`contextId` (both or neither, else 400) ask the same of a record before there is a Task — the create form's `?context=` — and need the caller to see it, else 422 `TASK_CONTEXT_INVALID` (#506). |
| `GET /tasks/lookups/mentionable?taskId=&q=` | R | Same rule; ≤ 20 |
| `GET /tasks/lookups/documents?q=` | W | `RecordDocumentLookupResponse` with groups order · quote_request · task · opportunity · project. A group appears only when its owner is present and the caller holds its read permission. |
| `GET /tasks/lookups/records?kind=&q=` | W | Link targets (opportunity, order, quote_request) |
| `GET /tasks/lookups/contexts?q=` | W | Project/Stage picker through each present descriptor (163) |
| `GET /tasks/custom-field-filters` | R | `listFilterable('task')` |

## 4. Configuration

| Method and path | Gate | Notes |
| --- | --- | --- |
| `GET /tasks/workflow` | R | `{statuses: TaskStatusConfig[] (with inUseCount), transitions[]}` |
| `POST /tasks/statuses` | C | `{code, name {en, pl}, category, color, weight, isInitial?}` |
| `PATCH /tasks/statuses/:code` | C | Every field except `code` |
| `DELETE /tasks/statuses/:code?replacement=` | C | `replacement` is required when the status is in use. 409 `TASK_STATUS_IN_USE_TOO_MANY` |
| `PUT /tasks/transitions` | C | `{add?: Edge[], remove?: Edge[]}`. Every write answers with the whole workflow and ends with `assertValid`, giving 422 `TASK_WORKFLOW_INVALID {rule}` on failure |
| `GET /tasks/priorities` · `POST` · `PATCH /:code` · `DELETE /:code?replacement=` | R / C | Same shape as statuses: every write answers the whole list. `replacement` may be `none`, and is required while Tasks hold the priority. A taken code and a missing replacement are 422 `TASK_WORKFLOW_INVALID {rule: priority_code_taken \| priority_replacement_required}`; an unknown replacement 422 `TASK_PRIORITY_UNKNOWN`; above `TASK_STATUS_REASSIGN_MAX` Tasks 409 `TASK_STATUS_IN_USE_TOO_MANY {code: priority}` (T082) |
| `GET /tasks/tags` · `POST` · `PATCH /:id` · `DELETE /:id` | R / C | `list` carries `usageCount`. 409 `TASK_TAG_NAME_TAKEN`. `PATCH` answers the tag, `DELETE` 204 |
| `GET` / `PUT /tasks/board/card-fields` | R / C | Validated against the catalogue and the definitions of `task` custom fields |
| `GET` / `PUT /tasks/settings/time-zone` | R / C | IANA name, validated |

## 5. Per-admin

| Method and path | Gate | Notes |
| --- | --- | --- |
| `GET` / `POST /tasks/list-views` · `PATCH` / `DELETE /tasks/list-views/:id` | R | Feature-147 semantics: owner plus `shared`; only the owner or a platform administrator may modify or delete a view. 409 `TASK_VIEW_NAME_TAKEN` |
| `GET` / `PUT` / `DELETE /tasks/me/digest` | R | `{hour}`. `DELETE` turns the digest off |

**The list/board choice** is not a Tasks route. It is the admin preference `listViewModes`, served by `admin_users` at `/api/v1/admin/me/preferences` (R-14).
