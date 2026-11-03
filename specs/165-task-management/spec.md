# Feature Specification: Task management — growing the Tasks module

**Feature Branch**: `165-task-management` (spec directory `specs/165-task-management/`)
**Created**: 2026-10-28
**Status**: Implemented (2026-10-29) — owner's rulings of 2026-10-28 recorded in *Clarifications*; planning amendments and implementation rulings marked *(Planning amendment)* / *(Implementation ruling)* where they apply and listed in *Amendments*
**Input**: Owner's requirements (in Polish) for the Tasks module (`tasks`, *Zadania*): assign
one or more Admin UI users to a Task; Task as a Custom Fields entity type; a due date;
reminders; attachments; a WYSIWYG description; notes/comments with `@` references to people,
Sales Opportunities, Quote Requests, Products, Projects, Orders and other Tasks; sub-tasks;
operator-defined statuses with permitted transitions, as for Opportunities and Orders; tags,
many per Task; a list and a board view to choose from, as for Opportunities in CRM; links to
an Opportunity, an Order, a Quote Request, another Task and a Project; private and draft
Tasks; filtering the list and the board and saving filters for later; configurable
priorities. ClickUp's Tasks are the functional reference. The module `tasks` already exists
(`specs/163-projects-and-tasks/`) and is extended, not replaced. GitHub issues #446 (resolve
references in a Task's description) and #450 (idempotent Stage Task retry, clean-up of Tasks
orphaned while Tasks was off) are delivered as part of this feature; issue #480 tracks it.
Example scenarios: Tasks defined in a Project Stage that must be done for the Project to
succeed; a sales rep plans their own Tasks, sees them in *My Tasks*, and receives a
notification or e-mail with the list of Tasks due today.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Task** | A unit of work in the `tasks` module. Polish UI label: *Zadanie*. |
| **Assignee** | An Admin UI user responsible for a Task. A Task has zero, one or many. |
| **Creator** | The Admin UI user who created the Task. |
| **Status** | An operator-defined state of a Task (*To do*, *In review*, …). Each Status belongs to one **category**: *open*, *done* or *cancelled*. |
| **Status workflow** | The Statuses plus the permitted moves between them. One workflow for every Task on the platform. |
| **Closed Task** | A Task in a Status of category *done* or *cancelled*; every other Task is **open**. |
| **Priority** | An operator-defined, ordered level of urgency (*Urgent*, *High*, *Normal*, *Low* by default). |
| **Tag** | An operator-defined coloured label; a Task carries any number of them. |
| **Sub-task** | A Task whose **parent** is another Task. |
| **Related Task** | A Task linked to another as related, with no parent/child meaning. |
| **Linked record** | An Opportunity, an Order or a Quote Request a Task is linked to. |
| **Context** | The record that *owns* a Task and decides who may see it — today only a Project (and one of its Stages), as established in feature 163. |
| **Comment** | A note added to a Task by a user, in time order, with references. |
| **Reference** | A person or a record named inside a text (description, comment) with the reference trigger, rendered as a link for readers who may see it. |
| **Reminder** | A moment at which chosen people are notified about a Task. |
| **Draft** | A Task not published yet: visible only to its Creator, and nobody is notified about it. |
| **Private Task** | A Task visible only to its Creator. |
| **Saved filter** | A named set of list/board filters kept for later by a user, optionally shared. |
| **Daily digest** | A once-a-day message to a user listing their open Tasks due today and overdue. |

## Current state (feature 163, merged in #477)

Measured on `origin/master` at `4e4cf7f83`:

- A Task has a number (`TSK-…`), a title, a plain-text description, **one** assignee, a due
  date, and one of **four fixed** statuses (*To do*, *In progress*, *Done*, *Cancelled*) with no
  transition rules. *Done* and *Cancelled* are closed.
- A Task may belong to one context (a Project and a Stage). Its visibility follows the context;
  a Task with no context is visible to every holder of *View tasks*.
- Screens: Tasks list (filters: status, assignee, overdue, search), *My Tasks*, New Task, Task
  detail with history. The assignee is notified in the Admin UI bell on assignment.
- Projects create Stage Tasks when a Project enters a Stage and refuse to leave a gated Stage
  while any of its Tasks is open. CRM and Projects can reference a Task with `@@`.
- A Task's description is stored with reference tokens but shown as plain text, references
  unresolved (issue #446).
- A Stage Task retry after a partial failure can create duplicates, and Tasks of a Project or
  Stage deleted while Tasks was off are orphaned (issue #450).
- Not present: several assignees, comments, attachments, rich text, sub-tasks, tags, priorities,
  custom fields, configurable statuses, a board, saved filters, reminders, a digest, links to
  Opportunities, Orders and Quote Requests, drafts, private Tasks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A Task as a full work item (Priority: P1)

A user opens a Task and finds everything needed to do it: a formatted description, several
assignees, a due date (optionally with a time), a priority, tags, its custom fields and
attachments. References in the description lead to the people and records they name.

**Why this priority**: every other story builds on a richer Task; it is the core of the request
and of ClickUp's Task model.

**Independent Test**: create a Task with two assignees, a due date with time, priority *High*,
two tags, a description with bold text, a bullet list and references to an Order and a person,
one custom field value and a PDF attachment; reopen it as each assignee and see all of it, with
the references as links.

**Acceptance Scenarios**:

1. **Given** the Task editor, **When** a user writes the description, **Then** they can use
   bold, italic, strikethrough, links, bulleted and numbered lists, and references — the same
   editor and the same formatting as an Opportunity's description.
2. **Given** a description referencing a person, an Order, a Quote Request, a Product, an
   Opportunity, a Project or a Task, **When** the Task is shown, **Then** each reference renders
   as a named link for a reader who may see the record, and as *unavailable* — revealing
   nothing about it — for a reader who may not, or when it no longer exists or its module is
   off (issue #446).
3. **Given** a Task, **When** a user adds a second and a third assignee, **Then** all three are
   shown, each new assignee — other than the user doing it — is notified once with a link, and
   the Task appears in each assignee's *My Tasks*.
4. **Given** a due date, **When** the user also sets a time, **Then** the Task is overdue from
   that time; without a time it is overdue from the next day, as today.
5. **Given** a Task, **When** a user sets a Priority and adds tags, **Then** they are shown on
   the Task, in the list and on the board card, and the Task can be filtered and sorted by them.
6. **Given** an operator defined custom fields for Tasks, **When** a user edits a Task, **Then**
   the fields are shown and saved like an Opportunity's custom fields, and the fields marked as
   list filters can filter the Task list and the board.
7. **Given** a Task, **When** a file is attached, **Then** it is listed with name, size,
   uploader and time, downloadable by anyone who may see the Task, removable by a user who may
   edit it, and the asset library refuses to delete it while the Task uses it.
8. **Given** a description mentioning a person newly, **When** the Task is saved, **Then** that
   person receives exactly one notification naming the Task by number — never the text —
   unless they are the author or may not see the Task.

---

### User Story 2 — Operator-defined statuses and transitions (Priority: P1)

An operator defines the Statuses of Tasks — name, colour, category, order, which one a new Task
starts in — and which moves between them are allowed, on a screen like the CRM workflow and
Order statuses screens. Users can only move a Task along a permitted transition.

**Why this priority**: the board's columns are the Statuses, the Projects completion gate needs
to know which Statuses are closed, and the owner asked for the same mechanism as Opportunities
and Orders.

**Independent Test**: add a Status *In review* (open) between *In progress* and *Done*, allow
*In progress → In review → Done* and remove *In progress → Done*; confirm a Task in
*In progress* cannot go straight to *Done* and the refusal names the permitted next Statuses.

**Acceptance Scenarios**:

1. **Given** the module is installed or upgraded, **When** the workflow is first shown, **Then**
   it holds *To do* (initial, open), *In progress* (open), *Done* (done) and *Cancelled*
   (cancelled), every move between them permitted, and every existing Task keeps its Status.
2. **Given** the workflow screen, **When** an operator adds, renames (per language), recolours,
   reorders or removes a Status or a transition, **Then** the change is saved and audited; the
   graph editor is the one used for Orders and Opportunities.
3. **Given** a workflow, **When** it is saved, **Then** it is refused unless exactly one Status
   is initial and open, at least one Status is *done*, and at least one is *cancelled*.
4. **Given** a Status that Tasks are in, **When** an operator removes it, **Then** they must
   choose a Status those Tasks move to; the moves are recorded in each Task's history.
5. **Given** a Task, **When** a user changes its Status to one not permitted from the current
   one, **Then** the change is refused, naming the permitted next Statuses; the status picker
   and the board offer only permitted Statuses.
6. **Given** a Task entering a *done* Status, **When** it is saved, **Then** its completion time
   is recorded; leaving it clears it. A Project Stage's completion gate treats every *done* and
   *cancelled* Status as closed.

---

### User Story 3 — List and board, filtered and saved (Priority: P1)

A user sees Tasks either as a list or as a board with one column per Status, switches between
them, filters both the same way, and saves a filter set to reuse — for themselves or shared.

**Why this priority**: explicitly requested; the board is how Tasks are worked day to day, and
saved filters make *My Tasks*-like views for teams.

**Independent Test**: filter Tasks by tag *Installation*, priority *High* and assignee *me*;
switch to the board and see the same filter applied; save it as *My installs*; reload the
Admin UI on another device and apply *My installs* from the saved list.

**Acceptance Scenarios**:

1. **Given** the Tasks screen, **When** a user switches between *List* and *Board*, **Then** the
   current filters carry over and the choice is remembered for that user across devices.
2. **Given** the board, **When** it is shown, **Then** each Status is a column in workflow
   order and each card shows the Task's number, title, assignees, due date (overdue marked),
   priority and tags; the custom fields shown on cards are configurable like CRM's board.
3. **Given** the board, **When** a user drags a card to another column — or uses the keyboard
   *Move to…* menu — **Then** the Task changes Status if the transition is permitted and the
   user may edit the Task, and is refused with the reason otherwise.
4. **Given** the list or the board, **When** a user filters, **Then** they can combine: Status,
   Status category (open/closed), assignee (me, nobody, chosen people), creator, priority, tag
   (all of the chosen), due date range, overdue, linked record or Project, has / is a sub-task,
   drafts, private, custom-field filters, and a text search by number or title.
5. **Given** a set of filters, **When** a user saves it with a name, **Then** it is kept as
   theirs, optionally shared with everyone who may view Tasks; saved filters apply to both the
   list and the board; only the owner (or a platform administrator) may delete one.
6. **Given** *My Tasks*, **When** it is opened, **Then** it shows the user's open Tasks — as an
   assignee — in list or board form with the same filters, the soonest due first.
   *(Implementation ruling)*: drafts are not in *My Tasks*; their Creator finds them with the
   list's *drafts* filter (FR-037: a draft is not yet assigned work).

---

### User Story 4 — Comments with references (Priority: P2)

Users discuss a Task in a comment thread, naming people and records with the reference
triggers, as they do on an Opportunity.

**Why this priority**: collaboration on a Task; requested explicitly, but a Task is useful
without it.

**Independent Test**: as one assignee, post a comment mentioning the other assignee and
referencing an Opportunity and a Project; as the mentioned user, open the notification, land
on the Task and see the references as links.

**Acceptance Scenarios**:

1. **Given** a Task, **When** a user who may see it adds a comment, **Then** it is listed in
   time order with author and time, using the same editor and formatting as the description.
2. **Given** a comment, **When** its author edits or deletes it, **Then** the change is kept in
   the Task's history; nobody else may edit or delete it.
3. **Given** the comment editor, **When** the user types the reference triggers, **Then** they
   can pick a person, an Opportunity, a Quote Request, a Product, a Project, an Order or a Task,
   with the same keyboard behaviour as on an Opportunity, and only kinds of record they may
   read — from modules that are on — are offered.
4. **Given** a new comment, **When** it is posted, **Then** every assignee and the Creator,
   except the author, are notified once with a link to the Task, and every newly mentioned
   person is notified as in User Story 1 scenario 8 — never twice for the same comment.

---

### User Story 5 — Sub-tasks and related Tasks (Priority: P2)

A user breaks a Task into sub-tasks and links related Tasks, and sees the progress of the
sub-tasks on the parent.

**Why this priority**: requested; it turns a Task into a small plan.

**Independent Test**: create a Task with three sub-tasks, close two; see *2 of 3 done* on the
parent, in the list and on its board card; link a third Task as related and see the link on
both Tasks.

**Acceptance Scenarios**:

1. **Given** a Task, **When** a user adds a sub-task — new, or an existing Task made a child —
   **Then** the sub-task names its parent with a link, and the parent lists its sub-tasks with
   Status, assignees and due date.
2. **Given** a parent, **When** its sub-tasks' Statuses change, **Then** the parent shows how
   many are closed out of how many.
3. **Given** a Task, **When** a user tries to make it a sub-task of itself or of one of its own
   descendants, **Then** it is refused.
4. **Given** a Task, **When** a user links another Task as related, **Then** the link is shown
   on both Tasks and can be removed from either.
5. **Given** a parent with open sub-tasks, **When** it is moved to a *done* Status, **Then** the
   move is allowed and the user is warned how many sub-tasks are still open; sub-tasks are not
   closed automatically.
6. **Given** a parent, **When** it is deleted, **Then** the user is told how many sub-tasks it
   has and its sub-tasks become top-level Tasks; they are not deleted.
7. **Given** a sub-task the reader may not see, **When** the parent is shown, **Then** it is
   counted in no number and listed nowhere for that reader.

---

### User Story 6 — Links to Opportunities, Orders, Quote Requests and Projects (Priority: P2)

A user links a Task to the Opportunity, Order or Quote Request it is about, or places it in a
Project, and sees the Task from the record's side.

**Why this priority**: requested; it connects Tasks to the sales work they serve. Feature 163
deferred exactly this ("attaching to an Opportunity, an Order or a Quote Request is later
work").

**Independent Test**: from an Opportunity, create a Task linked to it; see the Task in the
Opportunity's *Tasks* panel and the Opportunity named on the Task; link the same Task also to
an Order and see it from the Order.

**Acceptance Scenarios**:

1. **Given** a Task, **When** a user links it to one or more Opportunities, Orders or Quote
   Requests, **Then** each link is shown on the Task as a named link — or *unavailable* for a
   reader who may not see the record — and can be removed.
2. **Given** an Opportunity, an Order or a Quote Request, **When** it is shown to a user who may
   view Tasks, **Then** a *Tasks* panel lists the Tasks linked to it that the user may see, with
   Status, assignees and due date, and lets a user who may create Tasks add one already linked.
3. **Given** a Task, **When** a user places it in a Project and Stage, **Then** it behaves as in
   feature 163: the Project decides who may see it, and the Stage's completion gate counts it.
4. **Given** a linked record's module (CRM, Quote Requests) is switched off, **When** the Task
   is shown, **Then** the link shows as unavailable, nothing is deleted, and it reappears when
   the module is back on.
5. **Given** a link, **When** it is added or removed, **Then** it is recorded in the Task's
   history.

A link does not change who may see the Task (owner ruling Q2 = A): the Task stays visible
to every holder of *View tasks*, subject to its Project context and the draft and private rules.

---

### User Story 7 — Reminders and the daily digest (Priority: P2)

A user sets a reminder on a Task to be told about it at a chosen moment, and a sales rep gets,
each working morning, a notification and an e-mail with their Tasks due today and overdue.

**Why this priority**: named in the owner's example scenario; Tasks without reminders are easy
to forget.

**Independent Test**: set a reminder for 10:00 tomorrow for yourself and another assignee;
at 10:00 both receive a bell notification and an e-mail with a link. Turn the daily digest on,
have two Tasks due today and one overdue; the next morning receive one e-mail and one
notification listing the three.

**Acceptance Scenarios**:

1. **Given** a Task, **When** a user adds a reminder at a date and time — or relative to the due
   date (e.g. one day before) — and chooses recipients among themselves and the assignees,
   **Then** each recipient receives at that moment one Admin UI notification and one e-mail
   naming the Task with a link.
2. **Given** a reminder, **When** its moment passes while the platform was down, **Then** it is
   delivered once when the platform is back, never twice. *(Planning amendment)*: this holds
   for a reminder less than 24 hours past its moment; an older one is recorded as expired and
   not sent. The same 24-hour grace reconciles this scenario with scenario 6, which otherwise
   contradict each other for a long switch-off.
3. **Given** a reminder relative to the due date, **When** the due date changes, **Then** the
   reminder moves with it; when the due date is removed, the reminder is removed and its
   creator is told on the Task.
4. **Given** a reminder whose Task is closed, deleted, or no longer visible to a recipient,
   **When** its moment comes, **Then** nothing is sent to that recipient.
5. **Given** a user's own settings, **When** they turn on the daily digest and choose an hour,
   **Then** each day at that hour in the Tasks time zone they receive one notification and
   one e-mail listing their open Tasks due that day and overdue; on a day with none, nothing
   is sent. *(Planning amendment)*: the time zone is the Tasks module's own operator setting
   (default *Europe/Warsaw*), not "the platform's time zone" — the platform has none that is
   always present. It also decides when a date-only due date becomes overdue.
6. **Given** the Tasks module is switched off, **When** a reminder or a digest is due, **Then**
   nothing is sent and nothing accumulates to be sent later. *(Planning amendment)*: when
   Tasks is back on, a reminder whose moment passed less than 24 hours earlier is delivered
   once (scenario 2); an older one is not; only the current day's digest is sent.

---

### User Story 8 — Drafts and private Tasks (Priority: P3)

A user prepares a Task as a draft before publishing it, or keeps a Task private for their own
use.

**Why this priority**: requested; it serves personal planning, but shared Tasks work without
it.

**Independent Test**: create a draft with an assignee; confirm the assignee neither sees it nor
is notified; publish it and confirm the assignee is notified and sees it. Create a private Task;
confirm no other user without *See private tasks* finds it in the list, the board, search,
references or by its address.

**Acceptance Scenarios**:

1. **Given** a new Task, **When** a user saves it as a draft, **Then** only its Creator sees it,
   it is marked *Draft*, nobody is notified, no reminder fires, and it counts towards no
   Project completion gate.
2. **Given** a draft, **When** its Creator publishes it, **Then** it becomes a normal Task and
   its assignees and mentioned people are notified as for a new Task; a published Task cannot
   return to draft. *(Implementation ruling)*: for anybody but its Creator a draft does not
   exist, so their attempt to publish it is answered "not found", exactly as for a Task that
   does not exist; publishing a Task that is already published is refused as such. Other
   modules learn of a draft only when it is published.
3. **Given** a Task, **When** its Creator marks it private, **Then** it is visible to the
   Creator and to holders of *See private tasks* only (owner ruling Q1 = B), cannot be
   placed in a Project, and has no assignee other than the Creator.
4. **Given** a private Task, **When** another user references it, lists Tasks, searches, opens
   its address or reads a record it is linked to, **Then** the Task does not exist for them.

---

### User Story 9 — Tags and Priorities configured by the operator (Priority: P3)

An operator maintains the list of Tags and the list of Priorities.

**Why this priority**: small configuration screens that User Stories 1 and 3 rely on; defaults
make the module usable before anyone opens them.

**Independent Test**: add a tag *Installation* (green) and a Priority *Blocker* above *Urgent*;
use both on a Task; rename the tag and see the new name on the Task.

**Acceptance Scenarios**:

1. **Given** the Tags screen, **When** an operator adds, renames, recolours or deletes a Tag,
   **Then** the change is saved and audited; names are unique regardless of letter case;
   deleting a Tag in use asks for confirmation and removes it from those Tasks.
2. **Given** the Priorities screen, **When** an operator adds, renames (per language),
   recolours, reorders or removes a Priority, **Then** sorting by Priority follows that order;
   removing one in use asks which Priority — or none — those Tasks get.
3. **Given** a fresh installation or an upgrade, **When** Priorities are first shown, **Then**
   they are *Urgent*, *High*, *Normal*, *Low*, and every existing Task has no Priority.
4. **Given** a user with permission to edit Tasks but not to configure them, **When** they edit a
   Task, **Then** they can choose among existing Tags but cannot create one.

---

### User Story 10 — Stage Tasks stay consistent (Priority: P3)

Issue #450: Stage Tasks are never duplicated by a retry, and Tasks never stay orphaned after
their Project or Stage was deleted while Tasks was off.

**Why this priority**: robustness of feature 163; invisible until it goes wrong.

**Independent Test**: make Stage Task creation fail after two of five Tasks; retry; exactly
five Tasks exist. Switch Tasks off, delete a Project with Tasks and a Stage of another, switch
Tasks back on; the deleted Project's Tasks are gone and the deleted Stage's Tasks remain in
their Project without a Stage.

**Acceptance Scenarios**:

1. **Given** a Stage whose Task creation failed part way, **When** it is retried any number of
   times, **Then** every predefined Stage Task exists exactly once.
2. **Given** Tasks was off while a Project was deleted, **When** Tasks is back on, **Then**
   within one hour the Tasks of that Project are deleted, recorded in the audit log.
3. **Given** Tasks was off while a Stage was deleted, **When** Tasks is back on, **Then** within
   one hour its Tasks stay in their Project with no Stage.
4. **Given** the Projects module is off, **When** the clean-up runs, **Then** it removes nothing
   of Projects' Tasks — an absent owner is not a deleted context.

---

### Edge Cases

- An assignee is deactivated: they stay on the Task marked inactive, receive no reminder,
  digest or notification, and can be removed; they cannot be newly added.
- An assignee loses the right to see a Task (Project visibility changed): they stay listed
  but are not notified, and the Task is not in their *My Tasks*.
- A Task in a Project is assigned to someone who may not see the Project: refused, naming the
  person, and the assignee picker does not offer them. *(Implementation ruling, #506: feature
  163 accepted such an assignment and only did not notify; the owner chose the refusal on
  2026-10-29.)*
- Two users change the same Task at once: the later save does not silently undo the earlier
  one's other fields; a Status change on the board against a Task changed meanwhile is
  re-checked against the workflow.
- A workflow change removes a transition while a user has the board open: their next drag
  along it is refused with the reason.
- A board column with many Tasks: it loads progressively and states its total.
- A Tag, a Priority or a Status is renamed: every Task, saved filter and board shows the new
  name; a saved filter naming a deleted Tag, Priority, Status or person still opens, ignoring
  that value and saying so.
- A reference or a link to a record deleted later: rendered *unavailable*.
- Attachments: the same size and file-type limits as Opportunity and Project attachments; active
  content (HTML, SVG, scripts) is refused.
- A sub-task hierarchy deeper than five levels is refused.
- Daylight-saving changes: a reminder fires once at its local wall-clock time; a digest is sent
  once per day.
- Tasks created by Projects (Stage Tasks) are never drafts or private.
- The Tasks module is switched off: every Task surface — lists, boards, panels on other records,
  references' targets, reminders, digest — disappears, nothing is deleted, and it all comes back
  when switched on (Constitution XVII).

## Requirements *(mandatory)*

### Functional Requirements

**The Task**

- **FR-001**: A Task MUST hold zero or more assignees, each an active Admin UI user when added;
  every place that showed one assignee MUST show all of them. Existing Tasks keep their single
  assignee.
- **FR-002**: A Task MUST hold an optional due date with an optional time of day, and an
  optional start date. Overdue means open and past the due moment.
- **FR-003**: A Task's description MUST be edited with the platform's rich-text editor used for
  Opportunities and Projects (bold, italic, strikethrough, links, lists, references) and stored
  in the same safe text format; existing plain descriptions MUST read unchanged.
- **FR-004**: References in a Task's description and comments MUST be resolved per reader with
  the same rules as CRM and Projects — reader's permissions, owner module present, record
  exists — and rendered unavailable otherwise, leaking nothing (issue #446).
- **FR-005**: The reference picker MUST offer people (Admin UI users), Opportunities, Quote
  Requests, Products, Projects, Orders and Tasks, limited to kinds the user may read and whose
  modules are on. Opportunities and Projects MUST become referenceable kinds of the shared
  reference grammar. *(Planning amendment)*: to keep one grammar, they are referenceable in
  CRM's and Projects' texts too — an Opportunity's description and notes and a Project's
  description, notes and messages — not only in Tasks, per the owner's 2026-10-26
  standardisation ruling.
- **FR-006**: A person newly mentioned in a saved description or comment MUST be notified once,
  naming the Task by number and never the text, unless they are the author or may not see the
  Task.
- **FR-007**: Task MUST be an entity type for Custom Fields, following the Tasks module on/off;
  its fields MUST be editable on the Task and usable as list and board filters and as board
  card fields.
- **FR-008**: A Task MUST accept attachments stored in the asset library, with the same limits,
  refusal of active content and protection from deletion as Project attachments.
- **FR-009**: A Task MUST have an optional Priority from the operator's list (FR-024).
- **FR-010**: A Task MUST carry any number of Tags (up to 50).
- **FR-011**: Every change to a Task — fields, assignees, Status, Tags, Priority, links,
  parent, attachments, comments edited or deleted, publication, privacy — MUST be recorded in
  its history with author and time, through the platform's audited write path.
  *(Planning amendment)*: an operator deleting a Tag records one audit entry on the Tag, with
  how many Tasks carried it, not one entry per Task (CRM's precedent). Removing a Status or a
  Priority in use does record one entry per Task moved.

**Statuses and workflow**

- **FR-012**: Operators holding the new *Configure tasks* permission MUST be able to define
  Statuses (localized name, colour, category *open*/*done*/*cancelled*, order, initial flag)
  and permitted transitions, with the shared status-graph editor.
- **FR-013**: A workflow MUST have exactly one initial Status of category *open*, at least one
  *done* and at least one *cancelled* Status.
- **FR-014**: The upgrade MUST seed *To do* (initial), *In progress*, *Done*, *Cancelled* with
  every transition permitted, and keep every existing Task's Status.
- **FR-015**: A Status change not permitted by the workflow MUST be refused with the permitted
  next Statuses named. Creating a Task MUST start it in the initial Status.
- **FR-016**: Removing a Status in use MUST require a replacement Status for its Tasks.
- **FR-017**: Closed MUST mean category *done* or *cancelled* everywhere — *My Tasks*, overdue,
  the digest, sub-task progress, and the Projects completion gate.

**List, board, filters**

- **FR-018**: The Tasks screen and *My Tasks* MUST offer a list and a board; the choice MUST be
  remembered per user across devices.
- **FR-019**: The board MUST show one column per Status in workflow order and move a Task on
  drop or through a keyboard-operable *Move to…* menu, subject to FR-015 and edit permission.
- **FR-020**: The list and the board MUST share the filters listed in User Story 3 scenario 4,
  and the list MUST sort by number, title, due date, Priority, Status and last change.
- **FR-021**: Users MUST be able to save, apply and delete named filter sets, private or shared
  with everyone who may view Tasks, applying to both list and board, following the saved-views
  rules of Orders and Quote Requests.
- **FR-022**: Which custom fields a board card shows MUST be an operator setting, as in CRM.

**Tags and Priorities**

- **FR-023**: Holders of *Configure tasks* MUST manage Tags (name unique case-insensitively, up
  to 64 characters, colour); deleting a Tag in use MUST remove it from its Tasks after
  confirmation.
- **FR-024**: Holders of *Configure tasks* MUST manage Priorities (localized name, colour,
  order); the upgrade seeds *Urgent*, *High*, *Normal*, *Low*; removing one in use MUST ask for
  a replacement or none.

**Comments**

- **FR-025**: Users who may see a Task MUST be able to comment on it; only the author may edit
  or delete their comment; comments use the description's editor and references.
- **FR-026**: A new comment MUST notify the Task's assignees and Creator, except the author.

**Sub-tasks and related Tasks**

- **FR-027**: A Task MUST have at most one parent; cycles MUST be refused; nesting deeper than
  five levels MUST be refused.
- **FR-028**: A parent MUST show its sub-tasks and *closed of total* among those the reader may
  see; closing a parent with open sub-tasks MUST warn but not refuse.
- **FR-029**: Deleting a parent MUST make its sub-tasks top-level, not delete them.
- **FR-030**: Users MUST be able to link and unlink related Tasks, shown on both sides.

**Links and context**

- **FR-031**: A Task MUST be linkable to any number of Opportunities, Orders and Quote
  Requests, in addition to at most one Project context as in feature 163. A link MUST NOT
  change who may see the Task (Q2 = A).
- **FR-032**: Opportunity, Order and Quote Request screens MUST show a *Tasks* panel of the
  Tasks linked to them that the reader may see, with *Add task* creating one already linked;
  the panel exists only while Tasks is on.
- **FR-033**: A link to a record of a module that is off MUST show as unavailable and survive
  until the module is back.

**Reminders and digest**

- **FR-034**: A user who may edit a Task MUST be able to add reminders at an absolute moment or
  relative to the due moment, for recipients among themselves and the assignees; each
  recipient MUST get one Admin UI notification and one e-mail at that moment.
- **FR-035**: Reminders MUST be delivered at most once and at least once, including after
  downtime; none MUST go to a recipient who may not see the Task or whose Task is closed,
  deleted, a draft, or whose module is off.
- **FR-036**: Each user MUST be able to turn a daily digest on or off and choose its hour;
  it MUST list their open assigned Tasks due that day or overdue, as one notification and one
  e-mail, sent only on days with at least one such Task. The digest is off by default.

**Drafts and privacy**

- **FR-037**: A Task MAY be created as a draft: visible only to its Creator, no notifications,
  no reminders, not counted by any completion gate; publishing is one-way and notifies as for a
  new Task.
- **FR-038**: A Task MAY be private: visible only to its Creator and to holders of *See
  private tasks* (Q1 = B), assignable only to the Creator, not placeable in a Project;
  private Tasks MUST be absent from every list, board, search, reference, panel, count and
  address for anyone else.

**Stage Task robustness (issue #450)**

- **FR-039**: Creating a Stage's predefined Tasks MUST be idempotent: retries create each
  missing one once and no duplicates.
- **FR-040**: Tasks whose Project or Stage was deleted while Tasks was off MUST be cleaned up
  within one hour of Tasks being on: a deleted Project's Tasks deleted, a deleted Stage's Tasks
  ungrouped. A context whose owner module is off MUST never be treated as deleted.

**Permissions, activation, discoverability**

- **FR-041**: A new permission *Configure tasks* MUST gate the workflow, Tags, Priorities and
  board card settings; a new permission *See private tasks* MUST let its holder see other
  users' private Tasks (read only, plus deleting them); *View tasks* and *Create and edit
  tasks* keep their meaning.
- **FR-042**: Every new screen MUST be reachable from the command palette (Constitution XVI),
  and every surface — including panels on other modules' records, reminders and the digest —
  MUST disappear while Tasks is off and return intact when it is on (Constitution XVII).
- **FR-043**: Every user-facing text MUST exist in English and Polish; the module's
  documentation page MUST be updated for users and developers in both languages.
- **FR-044**: Nothing of Tasks MUST be visible on the storefront.
- **FR-045**: Projects' Stage Tasks and other modules using Tasks through its published ports
  MUST keep working unchanged in behaviour.

### Key Entities

- **Task**: number, title, rich description, Status, Priority, due moment, start date,
  completion time, Creator, draft flag, private flag, parent Task, Project context (from 163),
  custom field values.
- **Task assignee**: a Task ↔ Admin UI user pair.
- **Task Status / Status transition**: the operator's workflow; a Status has a category.
- **Priority**: ordered operator-defined level.
- **Tag / Task tag**: operator-defined label and its assignment to Tasks.
- **Task link**: a Task ↔ Opportunity / Order / Quote Request pair; a related-Task pair.
- **Task comment**: author, rich text, time, edited/deleted marks.
- **Task attachment**: a Task ↔ asset library file.
- **Task reference**: the references extracted from a description or comment, for resolution
  and mention notifications.
- **Reminder**: Task, moment (absolute or relative to due), recipients, delivered state.
- **Saved filter**: owner, name, shared flag, filters.
- **User preference**: view mode (list/board), digest on/off and hour — per Admin UI user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user creates a Task with assignees, due date, priority and a tag in under one
  minute.
- **SC-002**: Switching between list and board keeps the same Tasks and filters in 100 % of
  cases; a board of 500 visible Tasks shows its first cards within 2 seconds.
- **SC-003**: 100 % of Status changes that the workflow does not permit are refused, from every
  entry point (Task screen, board, bulk, other modules).
- **SC-004**: 100 % of reminders are delivered within 2 minutes of their moment while the
  platform runs, and once after downtime of less than 24 hours. *(Planning amendment)*: the
  Admin UI notification is delivered **exactly once**; the e-mail **at most once** — a failure
  between recording the delivery and sending the e-mail loses the e-mail, never duplicates it
  (an e-mail outbox is out of scope).
- **SC-005**: No private Task (to anyone without *See private tasks*), draft, or Task in a
  Project the reader may not see is revealed through any list, board, search, reference,
  panel, count, notification or address — verified by an off-state and a visibility test per
  surface.
- **SC-006**: Retrying Stage Task creation any number of times yields each predefined Task
  exactly once; orphaned Tasks are cleaned up within one hour of Tasks being switched on.
- **SC-007**: A sales rep who turned on the digest receives one message per day with Tasks due,
  and none on days without.
- **SC-008**: Existing Tasks, Stage Tasks and the Projects completion gate behave identically
  before and after the upgrade with the default workflow.

## Assumptions

- **Priority is a built-in field with an operator-configured list**, not a predefined custom
  field: it must sort the list, order the board card and feed the digest, which custom fields do
  not do. The owner allowed either.
- **One workflow for all Tasks.** Per-Project or per-team workflows (ClickUp's per-List
  statuses) are out of scope.
- "People" referenceable with `@` are Admin UI users, as on Opportunities and Projects; CRM
  contacts and storefront customers are not.
- Saved filters follow feature 147's model (owner + shared flag); renaming and default views
  stay out of scope as there.
- The digest is off by default (Q3 = A).
- Reminders and the digest use the existing Admin UI notifications and transactional e-mail;
  the platform has no per-user notification preferences, so the digest setting is the Tasks
  module's own per-user preference. Its hour is in the Tasks time zone, an operator setting of
  the module (*Planning amendment*, see US7 scenario 5).
- Attachment limits are those of Project attachments (25 MB per file, plus the asset library's
  own policy).
- Links to Opportunities, Orders and Quote Requests are added by users; nothing links Tasks
  automatically.
- Comments are notes only — there is no separate unread-tracked message thread as on Projects.
- Drafts and private Tasks are independent: a Task may be both.
- Demo data gains a few Tasks with tags, priorities, sub-tasks and comments.

## Out of scope

Time tracking and estimates; Task dependencies (*blocked by*) with scheduling; recurring Tasks;
checklists inside a Task; watchers/followers beyond assignees and Creator; per-List or
per-Project workflows; Gantt, calendar and timeline views; bulk editing beyond moving Status on
the board; Task templates outside Projects; storefront or customer-facing Tasks; webhooks;
automations ("when Status becomes X, do Y"); e-mail-to-Task; guest users.

## Dependencies

- **Projects** (`projects`) — optional; context owner, Stage Tasks, completion gate (#450).
- **CRM** (`crm`), **Quote Requests** (`quote_requests`) — optional; linked records, *Tasks*
  panel, referenceable kinds.
- **Orders** (`orders`), **Catalog** — always present; linked records / referenceable kinds.
- **Custom Fields**, **Asset library**, **Admin users**, **Admin notifications**, transactional
  **E-mail**, **Settings**, **Audit logs** — platform services used as they are.

## Clarifications

### Session 2026-10-28 — owner's rulings

- Q1: Who may see a private Task? → A: **B** — its Creator, and holders of a new permission
  *See private tasks* (e.g. when the Creator leaves the company). Recorded in FR-038 and
  FR-041; nobody else, whatever their other permissions.
- Q2: Does linking a Task to an Opportunity, Order or Quote Request restrict who sees it? →
  A: **A** — no, a link is only a reference: the Task stays visible to every holder of *View
  tasks* (subject to its Project context, draft and private rules), and a linked record the
  reader may not see shows as unavailable. Recorded in FR-031 and User Story 6.
- Q3: Daily digest default → A: **A** — off until each user turns it on and chooses an hour
  (FR-036).

## Amendments

### Planning amendments (2026-10-28, `plan.md` *Amendments from planning*)

Facts measured while planning, not owner rulings; each is marked where it applies.

- **SC-004** — the notification exactly once, the e-mail at most once.
- **US7 scenarios 2 and 6** — reconciled by one rule: a reminder less than 24 hours past its
  moment is delivered once; an older one is recorded as expired and not sent.
- **The time zone** — the digest hour and date-only due dates use the Tasks module's own time
  zone setting (default *Europe/Warsaw*) instead of "the platform's time zone".
- **FR-011** — deleting a Tag is recorded once, on the Tag.
- **FR-005** — Opportunities and Projects are referenceable in CRM and Projects too.

### Implementation rulings (2026-10-28 – 2026-10-29)

Decided while implementing, each recorded under its task in `tasks.md`; the technical detail
is in `research.md` *Implementation rulings*. The user-visible ones:

- Another user's draft does not exist for them, publishing it included (US8 scenario 2); a
  draft tells nobody, other modules included, until it is published.
- *My Tasks* shows no drafts; their Creator finds them with the *drafts* filter (US3
  scenario 6).
- Deleting a parent answers how many sub-tasks it had that the user may see, which became
  top-level Tasks (US5 scenario 6).
- Retrying a Stage's Task creation reports how many Tasks the Stage has afterwards, those of
  earlier attempts included (US10 scenario 1).
- A Project or Stage deleted while Tasks was off is cleaned up within fifteen minutes of Tasks
  being on — inside FR-040's hour.

