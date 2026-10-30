# Quickstart: proving Task management

## Preconditions

```bash
pnpm run build:packages
pnpm run dev:infra:test            # Postgres, Redis, Meilisearch for integration tests
pnpm run setup                     # db:fresh, then module:install --all (runs the seeds)
```

## 1. The failing test that opens each story (Constitution III)

| Story | First failing test | What it proves |
| --- | --- | --- |
| Foundational | `backend/test/integration/tasks/migration.test.ts` (extended) | The upgrade from the 163 schema keeps every Task's status and assignee: the assignee lands in `task_assignees`, the four statuses and twelve moves are seeded, the priorities are seeded, and `down` restores the 163 shape. |
| Foundational | `backend/test/integration/tasks/visibility-seam.test.ts` (new) | No route or service reads a Task-owned table outside `TaskVisibility` / `TaskAccess`. |
| US1 | `backend/test/integration/tasks/task-fields.test.ts` | Several assignees, each notified once; due date with a time and overdue; priority; tags; custom fields; rich description round-trip; references resolved per reader, with an Order the reader cannot read shown unavailable (#446); a mention notified once. |
| US1 | `backend/test/integration/tasks/attachments.test.ts` | Upload, active content refused (415), the asset library refuses to delete an attached asset, also while Tasks is off. |
| US2 | `backend/test/integration/tasks/workflow.test.ts` | Graph rules (422 per rule), a forbidden move (409 with `allowedTargets`), a concurrent move (409 conflict), a removal reassigning 3 Tasks with 3 history rows, and Projects' completion gate with a custom `done`-category status. |
| US3 | `backend/test/contract/tasks/board.contract.test.ts` | Columns in weight order, counts equal to the list totals under the same filters, `hasMore`, and the board and the list agreeing for every filter in US3 scenario 4. |
| US3 | `backend/test/integration/tasks/saved-views.test.ts`, `admin/test/modules/tasks/TasksPage.view-mode.test.tsx` | View ownership and sharing; the mode follows the user through the preference API. |
| US4 | `backend/test/integration/tasks/comments.test.ts` | Author-only edit and delete; who is notified; mention and comment notifications de-duplicated; references to an Opportunity and a Project resolved. |
| US5 | `backend/test/integration/tasks/hierarchy.test.ts` | Cycle and depth refused; deleting a parent detaches its children; progress counts only visible sub-tasks; related Tasks on both sides. |
| US6 | `backend/test/integration/tasks/record-links.test.ts`, `admin/test/modules/tasks/TasksPanel.test.tsx` | Linking validated against the owner ports; a link does not narrow visibility (Q2 = A); a record of a module that is off shows unavailable; the panel on Order, Quote Request and Opportunity. |
| US7 | `backend/test/integration/tasks/reminders.test.ts` | Clock-controlled: absolute and relative reminders; a due-date change moves a relative one; one bell per recipient across two concurrent ticks; grace and expiry; a recipient without visibility is skipped. |
| US7 | `backend/test/integration/tasks/digest.test.ts` | Once per day across a DST change in `Europe/Warsaw`; nothing sent on an empty day; drafts and Tasks the recipient may not see excluded. |
| US8 | `backend/test/integration/tasks/draft-private.test.ts` | A private Task is absent for another admin from the list, board, `/mine`, search, read port, references, lookups, panels and address; a holder of `tasks:see_private` reads and deletes it and gets 403 on any other write; a draft is invisible to everyone else and publishing notifies. |
| US9 | `backend/test/integration/tasks/tags-priorities.test.ts` | Case-insensitive tag uniqueness; delete cascades; priority removal with replacement; `tasks:write` without `tasks:configure` cannot create a tag. |
| US10 | `backend/test/integration/projects/stage-tasks.test.ts` (extended), `backend/test/integration/tasks/maintenance.test.ts` | A failure after 2 of 5 Tasks, then 3 retries, leaves exactly 5 Tasks. With Tasks off: delete a Project, delete a Stage, switch back on, run a pass; the Tasks are deleted or ungrouped. With Projects off, a pass deletes nothing. |
| Cross-cutting | `backend/test/integration/tasks/off-state.test.ts` (extended), `admin/test/modules/tasks/off-state.test.tsx` | Every new route answers 503; zones, palette actions and workers are inert; nothing is lost. |
| Cross-cutting | `backend/test/perf/tasks/context-visibility.perf.test.ts` (extended) | 5 000 Tasks: list page and board under 2 s (SC-002). |

## 2. Manual walk (browser, demo shop)

1. As an operator, open *Task settings → Workflow*. Add *In review* (open). Allow *In progress → In review → Done* and remove *In progress → Done*.
2. Create a Task with two assignees, a due date at 10:00 tomorrow, priority *High*, tags *Installation* and *Urgent*, a description with a list, an `@` mention and an `@@` Opportunity, and a PDF. Add a reminder one hour before the due time for you and one assignee.
3. Log in as the assignee. Check the bell (assignment, mention), *My Tasks*, and that the Opportunity reference is a link.
4. Switch `/tasks` to *Board*. Drag the card *In progress → Done* and see it refused with the reason. Use *Move to… → In review*. Reload on another browser: the board is still chosen.
5. Filter by tag and priority, save the filter as *My installs*, shared. As another admin, apply it.
6. Add three sub-tasks and close two; the parent shows *2 of 3*.
7. Open the linked Opportunity; its *Tasks* panel lists the Task. Use *Add task* from an Order.
8. Create a private Task and a draft. As another admin without *See private tasks*, confirm both are invisible everywhere, including by URL. Grant *See private tasks* and confirm the private Task is read-only.
9. Turn on the daily digest for the current hour and wait for the 15-minute pass.
10. Switch Tasks off on `/platform/modules`. The Opportunity, Order and Quote Request screens show no panel and the bell gets nothing. Switch it back on: everything is back.

## 3. Verification set before the merge request

```bash
pnpm run build:packages
pnpm -r run typecheck && pnpm -r run lint
pnpm --filter backend run test:unit:fast
pnpm --filter backend exec vitest run test/integration/tasks test/contract/tasks test/integration/projects test/integration/crm
pnpm --filter '!backend' run test          # admin-kit, contracts, modules' co-located tests
pnpm run check:naming && pnpm run check:language
pnpm --filter backend run composer:generate && pnpm --filter backend run manifests:generate && pnpm install --lockfile-only
git status   # the generated artefacts are committed
```

Before finishing:
- Grep `backend/test/**` and `admin/test/**` for the moved CRM component paths and for `assignedAdminUserId` (task) and `TASK_STATUSES`.
