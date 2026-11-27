# Contract: Admin surfaces

## 1. Routes and screens (`packages/modules/tasks/src/admin/`)

| Route | Screen | Permission | Notes |
| --- | --- | --- | --- |
| `/tasks` | `TasksPage` | `tasks:read` | List or board, the choice kept under `listViewModes.tasks`. Filters live in the URL, and saved views and custom-field filters are available. **Replaces** `TasksList`. |
| `/tasks/mine` | `MyTasksPage` | `tasks:read` | List or board, the choice kept under `listViewModes['tasks-mine']`. Has a *Daily digest* control (on/off and hour). |
| `/tasks/new` | `TaskCreate` | `tasks:write` | Takes `?link=<kind>:<id>`, `?parent=<taskId>` and `?context=<type>:<id>[:<group>]`. Offers *Save as draft* and *Private*. |
| `/tasks/:id` | `TaskDetail` | `tasks:read` | Laid out in §2. |
| `/tasks/settings/workflow` | `TaskWorkflowPage` | `tasks:configure` | Statuses table and dialog, the `StatusTransitionGraph` and the `BoardCardFieldsEditor`. |
| `/tasks/settings/tags` | `TaskTagsPage` | `tasks:configure` | — |
| `/tasks/settings/priorities` | `TaskPrioritiesPage` | `tasks:configure` | — |
| `/tasks/settings/general` | `TaskGeneralSettingsPage` | `tasks:configure` | Time zone. |

**Navigation.** The sidebar keeps the `work` section and its two existing entries, and gains *Task settings* (`tasks:configure`).

## 2. `TaskDetail` layout

**Header:**
- `PageHeader`: number and title.
- The status control, which offers only the permitted next statuses.
- A *Draft* badge with *Publish* for the Creator, and a *Private* badge.

**Main column:**
- The description, shown with `ReferenceText` and edited with `ReferenceField`.
- Sub-tasks: a progress line, the list, *Add sub-task* and *Make sub-task of…*.
- Comments: `CommentThread`, notes only.
- Attachments: `AttachmentUploader`.
- History: `RecordHistory`, with the extended fields.

**Side column:**
- Assignees: a multi-select.
- Due, with an optional time, and start date.
- Priority.
- Tags: `TagMultiSelect`, promoted to the kit.
- Reminders.
- Context: the 163 card with the Project and Stage picker.
- Linked records.
- Related Tasks.
- Custom fields: `CustomFieldValuesPanel` with `entityType="task"`.

**Below:** `<AdminZone name="task.detail.after">`, unchanged.

**Read-only rendering.** When `permissions.canChange` is false, every control renders read-only. That covers a context that refuses changes and a private Task read through `tasks:see_private`.

## 3. Zones `tasks` contributes

| Zone | Component | Weight | Permission |
| --- | --- | --- | --- |
| `order.detail.after` | `zones/OrderTasksPanel` → `TasksPanel kind="order"` | 660 | `tasks:read` |
| `quote_request.detail.after` | `zones/QuoteRequestTasksPanel` | 660 | `tasks:read` |
| `opportunity.detail.after` | `zones/OpportunityTasksPanel` | 660 | `tasks:read` |

`TasksPanel` shows the visible Tasks linked to the record, with their status, assignees and due date, and an *Add task* button (`tasks:write`). It renders nothing while Tasks is off, because the zone gate follows presence.

## 4. Command palette (Principle XVI)

The three existing actions are unchanged. Three are added:

| id | Route | Permission | Keywords (en / pl) |
| --- | --- | --- | --- |
| `open-task-workflow` | `/tasks/settings/workflow` | `tasks:configure` | task statuses, workflow, transitions / statusy zadań, przejścia |
| `open-task-tags` | `/tasks/settings/tags` | `tasks:configure` | task tags, labels / tagi zadań, etykiety |
| `open-task-priorities` | `/tasks/settings/priorities` | `tasks:configure` | task priorities / priorytety zadań |

## 5. Permissions

| Code | Label | Requires |
| --- | --- | --- |
| `tasks:read` | View tasks | — (existing) |
| `tasks:write` | Create and edit tasks | `tasks:read` (existing) |
| `tasks:configure` | Configure tasks | `tasks:read` |
| `tasks:see_private` | See private tasks | `tasks:read` |

## 6. Components promoted to admin-kit (Principle IX)

| Component | From | To | Consumers after |
| --- | --- | --- | --- |
| `TagChips`, `TagMultiSelect`, `useTagOptions` (options source injected) | `crm/src/admin/components/TagPicker.tsx` | `admin-kit/src/components/tags/` | crm, tasks |
| `MoveToMenu` (generic `targets {code, name, color}`) | `crm/src/admin/components/MoveToMenu.tsx` | `admin-kit/src/components/kanban/MoveToMenu.tsx` | crm, tasks |

**Reference editor (admin-kit `components/references/`).** It gains document groups for
`opportunity` and `project`, and `ReferenceText` gains link targets for both. Each module's
lookup decides which groups it offers.

## 7. Off state (Constitution XVII)

While `tasks` is off:
- No route, sidebar entry or palette action of the module is shown.
- The three zones render nothing.
- References to Tasks render as unavailable in CRM and Projects (163 behaviour).
- Reminders and the digest do not run.
- When Tasks comes back on, a reminder that fell due less than `TASK_REMINDER_GRACE` (24 h) earlier is delivered once, and an older one is recorded as expired and never sent (R-17).
- Only the current day's digest is sent: there is no catch-up.
- No row is dropped.

The off-state tests are extended with:
- the three zones;
- the configuration screens;
- the worker probe;
- an Opportunity, an Order and a Quote Request screen with Tasks off.
