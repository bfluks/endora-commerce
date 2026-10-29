---
title: tasks
description: Tasks assigned to administrators, with a due date and a status, which other modules can own through a Task context
---

# `tasks`

The Tasks module keeps **tasks**: a piece of work for an administrator, with a
title, a description, an assignee, a due date and a status. It is a deliberately
small first version, meant as the base other modules build on.

## What it does

Every task has a number, such as `TSK-000042`, given when it is created and
never reused. Its status is one of four, and any status can follow any other:

| Status | Meaning |
| --- | --- |
| `todo` | Not started — every new task starts here. |
| `in_progress` | Being worked on. |
| `done` | Finished. The moment it became done is recorded, and cleared again if it leaves `done`. |
| `cancelled` | Will not be done. |

A task whose due date has passed while it is still `todo` or `in_progress` is
**overdue**.

A task can stand on its own, or belong to a record another module owns — a
project, for example. That record is the task's **context**. A task with no
context is visible to everybody allowed to see tasks. A task with a context is
visible only to the people the context's own module says may see that record:
someone who may not see a project does not see its tasks either, anywhere — not
in a list, not by its address. To them such a task does not exist.

If the module that owns a context is switched off, the tasks of that context
disappear from the Tasks module until it is switched back on; nothing is
deleted.

## In the Admin UI

Tasks are in the sidebar under **Projects & tasks**, for administrators who may
view tasks: **My tasks** (`/tasks/mine`) and **Tasks** (`/tasks`).

**The list** shows every task you may see: its number, title, status, due
date — marked *Overdue* once it has passed while the task is open — assignee,
and the record it belongs to. That record is a link while it is available to
you; one you may no longer see, or whose module is switched off, is named
*Unavailable record*, without a link. Filter the list by status, by assignee —
you, or nobody — or to overdue tasks only, and search by number or title. It
pages forward and back, fifty tasks at a time.

**My tasks** lists your own open tasks, the soonest due first and those without
a due date last, overdue ones marked.

**New task** (`/tasks/new`) asks for a title and, optionally, a description, a
due date and an assignee — chosen by name among the active administrators, or
with *Assign to me*. A task created here belongs to no record: a task of a
project is added on the project's *Tasks* tab, into one of its stages.

**A task's screen** shows its title, number and status, then:

- **Details** — the status, changed at once from its list; the description, due
  date and assignee, changed with *Edit* and saved together; *Assign to me*;
  who created the task and when, and when it was done. *Delete task* asks
  before it deletes; it is not offered for a task of a record you may not
  change — a project you may not edit — and the screen says why.
- **Belongs to** — the record the task belongs to, as its module names it: for a
  project task, the project's number and title, linked, and its stage. A note
  the record's module wrote when it created the task, such as the role
  responsible for it, is shown here too.
- **History** — every change, newest first, with who made it and when.

Other modules can add panels at the end of a task's screen. Without the
permission to create and edit tasks the screen is read-only.

**The command palette** (⌘K / CTRL+K) offers *Tasks*, *My tasks* and *New
task*, each to administrators with the permission its screen needs. The Admin
UI's **global search** finds a task by its number or its title — only among the
tasks you may see.

## Using Tasks

**Creating a task.** A task needs only a title; it can also have a
description, an assignee — any active administrator — and a due date. It gets
its number, starts as `todo`, and remembers who created it. It can be placed
in a record of another module — in this release, a stage of a project the
creator may see and edit; a task of a project always belongs to one of its
stages.

**Changing a task.** Its title, description, due date, assignee, status and
the record it belongs to can all be changed. Any status may follow any other:
moving a task to `done` records when it was done, and moving it out of `done`
clears that again.

**Assigning.** When a task is assigned to somebody other than the person
assigning it — when it is created or later — they are told in the Admin UI's
notification bell, by the task's number only, with a link to the task.
Assigning a task to yourself, or unassigning it, tells nobody. Nor is
anybody told about a task they may not see: a task of a project goes to the
bell only of somebody who may see that project. While the *Admin notifications*
module is switched off assigning works the same and nobody is told.

**My tasks** is your own open work: the tasks assigned to you that are neither
`done` nor `cancelled`, the ones due soonest first, the ones without a due date
last, overdue ones marked.

**Deleting a task** removes it for good.

Adding a task to a record, taking one out of it — to no record or to another
one — and deleting a task of a record are changes to that record's work, so
the record's module decides who may make them: for a project, somebody who may
edit the project. Moving a task between the stages of one project, and every
other change to a task, needs only the permission to change tasks.

**History.** Every change of a task — created, changed, assigned, its status
changed, deleted — is recorded with who did it and when, and the task's history
lists them, newest first. The history records the length of a description,
never its text. A project the task has left, and you may not see, is not named
in it.

## Switching it on and off

Tasks is an optional module. It is on by default and an operator switches it
off, and back on, on the **Modules** screen of the Admin UI
(`/platform/modules`).

While it is off:

- the *My tasks* and *Tasks* entries and every task screen are gone from the
  Admin UI, and so are a project's *Tasks* tab and its stage tasks, the
  command-palette actions and tasks in the global search;
- every `/api/v1/admin/tasks…` endpoint answers `503` with the code
  `MODULE_DISABLED`;
- its permissions can no longer be granted to a role;
- other modules can neither read nor create tasks: a module that offers tasks
  as part of its own screens shows them as unavailable.

Nothing is deleted. Every task stays in the database, and everything is back
exactly as it was when the module is switched on again.

## Permissions

| Code | What it allows |
| --- | --- |
| `tasks:read` | View tasks — the list, *My tasks*, a single task and its history — subject to the visibility of each task's context. |
| `tasks:write` | Create, change, assign and delete tasks. Requires `tasks:read`. |

## For developers

### The API

| Method and path | Permission | What it answers |
| --- | --- | --- |
| `GET /api/v1/admin/tasks` | `tasks:read` | A page of tasks, newest first: `{ items, nextCursor }`. Filters: `status` (repeatable), `assignee` (an administrator's id, `me` or `none`), `dueFrom`, `dueTo`, `overdue`, `contextType`, `contextId`, `q` (number or title), `cursor`, `limit` (at most 100). |
| `GET /api/v1/admin/tasks/mine` | `tasks:read` | `{ data: TaskSummary[] }` — the caller's open tasks, by due date, undated last (at most 500). |
| `POST /api/v1/admin/tasks` | `tasks:write` | `{ title, description?, assignedAdminUserId?, dueOn?, context? }` → `201` `{ data: TaskDetail }`; `422` `TASK_CONTEXT_INVALID` (also for a record its owner does not let you add to, `canChangeTasks`), `TASK_ASSIGNEE_INVALID`. |
| `GET /api/v1/admin/tasks/:id` | `tasks:read` | `{ data: TaskDetail }`, or `404` `TASK_NOT_FOUND` — for a task that does not exist and for one whose context you may not see alike. `context.canChangeTasks` is the record owner's answer for you (`false` for an unavailable record): whether you may delete the task or move it out of its record. |
| `PATCH /api/v1/admin/tasks/:id` | `tasks:write` | Any of `title`, `description`, `dueOn`, `assignedAdminUserId`, `status`, `context` → `{ data: TaskDetail }`; `422` `TASK_CONTEXT_INVALID` for putting a task into, or taking it out of, a record whose owner does not let you (`canChangeTasks`). |
| `DELETE /api/v1/admin/tasks/:id` | `tasks:write` | `204`; `403` `FORBIDDEN` for a task of a record whose owner does not let you delete it (`canChangeTasks`). |
| `GET /api/v1/admin/tasks/lookups/assignees` | `tasks:write` | `{ data: { id, name, email }[] }` — active administrators matching `q` (name or e-mail), at most 50. |
| `GET /api/v1/admin/tasks/:id/history` | `tasks:read` | The task's audit trail, newest first: `{ data, pagination, truncated }` (`RecordHistoryPage`). |

A `context` written through the API must belong to a switched-on module that
lists the record as one you may see, and — when the record has groups, such as
a project's stages — name one of them; otherwise `422` `TASK_CONTEXT_INVALID`.
A task's `context` is read as `{ type, id, groupId, available, label, href,
groupLabel }`. When the owning module no longer describes the record,
`available` is `false`, `label` reads *Unavailable record* in your language and
`href` and `groupLabel` are `null`.

The request and response shapes are the Zod schemas of
`@endora-commerce/contracts` (`tasks.ts`).

### Task contexts

The Tasks module names no other module. A module that wants tasks of its own
registers a **Task context** — a context type it owns, such as `project` —
and from then on tasks can carry that type, the id of one of its records and,
optionally, the id of a group inside the record (a project's stage).

The registry is the container entry `taskContextRegistry`
(`TaskContextRegistryPort`). It is registered ungated, so push into it from a
**contribution-only boot hook with no presence probe**, and declare the edge in
your manifest's `nonBindingDependencies` as `contributes-to`:

```ts
ctx.onBoot(() => {
  lazyPort<TaskContextRegistryPort>(ctx, 'taskContextRegistry').register({
    contextType: 'project',
    ownerModuleId: 'projects',
    allVisibleContextIds: () => /* every record id the caller may see */,
    visibleContextIds: (ids) => /* which of these ids the caller may see */,
    describe: (ids) => /* id → { label, href, groups: groupId → label } */,
    canSeeAs: (adminUserId, id) => /* may that administrator see this record? */,
    canChangeTasks: (id) => /* may the caller add, take out or delete a task of this record? */,
  });
});
```

The contract a descriptor keeps:

- **Every method runs under the caller's own tenant context.** Answer for the
  caller, exactly as your own screens would.
- `allVisibleContextIds()` is the list pre-filter: the Tasks list asks it once
  per request and narrows its query to those ids, so pages stay exact. Keep it
  cheap.
- `visibleContextIds(ids)` answers for a single task, or a few.
- `describe(ids)` is how a task shows its context: a label, an address in the
  Admin UI, and the labels of the record's groups.
- `canSeeAs(adminUserId, id)` is the one method that answers for **somebody
  else**: whether that administrator, by their own permissions and reach, may
  see the record. It is asked before an assignee is told about a task of the
  record; `false` — or an owner that is switched off — means nobody is told.
- `canChangeTasks(id)` decides whether the caller may change which tasks the
  record holds: put a task **into** it (create it there, or move it there), take
  one **out of** it (detach it with `context: null`, or move it to another
  record) or **delete** one of its tasks. Moving a task between the record's own
  groups, and editing a task where it is, are not asked. Without it a holder of
  `tasks:write` who merely sees the record could publish its tasks to everyone
  who reads tasks, or add to and remove from its work. Projects answers yes to a
  holder of `projects:write` who sees the project; `false` refuses putting in
  and taking out with `422` `TASK_CONTEXT_INVALID`, and deleting with `403`
  `FORBIDDEN`.
- `renderNote(note, language)`, optional, words the note your module left on a
  task when it created it (`contextNote` of `taskWritePort.createMany`) in the
  reader's language. Store a key rather than a sentence — Projects stores the
  responsible role — and answer the sentence here; without it the note is shown
  as stored.
- One context type has one owner; registering a second, different descriptor
  for a type already taken stops the backend at boot.
- **The policy is fail-closed.** A task whose context type nobody registered,
  or whose owner is switched off, is hidden from lists, counts and by id, and
  reappears when the owner is back. The system — a background job with no
  administrator behind it — is never narrowed.

### Reading and writing tasks from another module

Two ports, both gated — resolving either while Tasks is off throws, and the
call answers `503` `MODULE_DISABLED`. Resolve them with `lazyPort` and declare
them `degrades-without` with a `whenAbsent` sentence.

| Port | Methods |
| --- | --- |
| `taskReadPort` (`TaskReadPort`) | `findById`, `listInContext`, `listOpenInContext` (neither `done` nor `cancelled`), `countInContext` — narrowed by context visibility for an administrator, not for the system. |
| `taskWritePort` (`TaskWritePort`) | `createMany({ context, tasks })` — at most 100 tasks, one audited `tasks.task.create` command and one `tasks.task.created.v1` event per task; refused with `TASK_CONTEXT_INVALID` when no switched-on module owns the context type and with `TASK_ASSIGNEE_INVALID` when an assignee is not an active administrator, before anything is written. `deleteInContext({ contextType, contextId })` — every task of one record, one audited `tasks.task.delete` command each. |

Call `createMany` **after your own transaction has committed**: each task is
written in a transaction of its own.

`./backend` also exports **`nextTaskNumber(em)`**, the module's door to its
number sequence — the next `TSK-…` number on the caller's transaction, for code
that writes tasks without a Command, such as the demo composition; one format
and one sequence, whoever creates the task.

### Events

| Event | Payload |
| --- | --- |
| `tasks.task.created.v1` | `{ taskId, contextType, contextId, contextGroupId, assignedAdminUserId }` |
| `tasks.task.status_changed.v1` | `{ taskId, from, to, contextType, contextId, contextGroupId }` |
| `tasks.task.assigned.v1` | `{ taskId, from, to }` |
| `tasks.task.deleted.v1` | `{ taskId, contextType, contextId }` |

Each is emitted once per command, after it commits. A change of several kinds
at once — a `PATCH` with a new title, assignee and status — is one command per
kind (`tasks.task.update`, `tasks.task.assign`, `tasks.task.status_change`),
each with its own audit row and, for the last two, its own event.
