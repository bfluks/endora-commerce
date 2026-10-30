---
'@endora-commerce/mod-tasks': minor
---

A new module package, `@endora-commerce/mod-tasks` (module id `tasks`): Tasks for
administrators — a number (`TSK-…`), a title, a description, an assignee, a due date and one of
four statuses — standing on their own or belonging to a record another module owns.

- **Activation.** `tasks.enabled` (on by default, switchable on `/platform/modules`). Off is
  non-destructive: every route answers `503` `MODULE_DISABLED`, every screen, palette action and
  search hit is gone, other modules can neither read nor create Tasks, and everything is back as
  it was when it is switched on again.
- **Migration.** `tasks_init` — the `tasks` table and its number sequence.
- **Permissions.** `tasks:read`, and `tasks:write`, which requires it.
- **Admin API** under `/api/v1/admin/tasks`: the list (status, assignee, due dates, overdue,
  context, search), *My tasks*, a Task's create, read, update and delete, its change history, and
  the assignee lookup. A Task whose context the caller may not see answers exactly as a missing
  one.
- **Admin UI.** *My tasks* (`/tasks/mine`), the Tasks list, *New task* and a Task's screen, in the
  sidebar's *Projects & tasks* section; three palette actions (`open-tasks`, `open-my-tasks`,
  `new-task`); Tasks in admin global search, by number or title. A Task's screen mounts the
  `task.detail.after` zone for other modules' panels. English and Polish.
- **Assignment.** Assigning a Task to somebody else notifies them through the bell
  (`admin_notifications`, optional) — and only when they may see the Task's context.
- **For other modules.** `taskContextRegistry`, an ungated contribution seam through which a
  module owns a Task context type and decides who sees its Tasks (fail-closed: a context nobody
  present owns hides its Tasks) and who may put a Task into one of its records, take one out or
  delete one (`canChangeTasks`; a refused delete is `403` `FORBIDDEN`, and a Task's detail carries
  the answer as `context.canChangeTasks`, so its screen offers no Delete it would refuse); `taskReadPort` and `taskWritePort`, gated; the events
  `tasks.task.created.v1`, `tasks.task.status_changed.v1`, `tasks.task.assigned.v1` and
  `tasks.task.deleted.v1`; and `nextTaskNumber(em)` on `./backend`, the door to the `TSK-…`
  number sequence.
- **Dependencies.** Binding on `_i18n`, `admin_users`, `audit_logs`, `auth` and `settings`;
  degrades without `admin_notifications`.

Its contract — the API schemas, `TaskReadPort`, `TaskWritePort` and `TaskContextRegistryPort` —
is in `@endora-commerce/contracts` (see that package's entry).
