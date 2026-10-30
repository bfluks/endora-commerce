# Feature Specification: Projects, with a first version of Tasks

**Feature Branch**: `163-projects-and-tasks` (spec directory `specs/163-projects-and-tasks/`)
**Created**: 2026-10-26
**Status**: Draft — owner's rulings of 2026-10-26 recorded in *Clarifications*; ready for planning
**Input**: Owner's requirements (in Polish) for a Projects module (`projects`): a Project
gathers the Tasks, Orders, Quote Requests, Sales Opportunities and other resources of one piece
of work; Project Templates prefill a new Project; Project Roles (not RBAC roles) with
predefined *Sales Rep* and *Project Manager*; Stages with predefined Tasks, Roles, a duration,
an optional "all Tasks done before moving on" gate, and a workflow configurable like those of
Orders and Opportunities; a module setting deciding whether Projects are visible to everybody
or only to their members, plus per-Project visibility; notes, internal messages, `@`
references and attachments as on an Opportunity; a value and one or more Organizations;
Custom Fields; analytics modelled on CRM analytics with lost-Project reporting; deadline
alerts per Stage; and, on an Opportunity, a Quote Request, a Task and an Order, the Project it
belongs to. Technical requirement: a Tasks module (`tasks`) does not exist yet — build a first
version of it as the base for later growth.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Project** | A record of one piece of work done for one or more Organizations, from start to a *completed* or *lost* outcome. Polish UI label: *Projekt*. |
| **Project Template** | A reusable definition — Roles, Stages, Stage Tasks, alerts, default texts — that prefills a new Project. Polish: *Szablon Projektu*. |
| **Project Role** | A named function a person plays in a Project (*Sales Rep*, *Project Manager*, operator-defined ones). **Not** an RBAC role: it grants no permission. Polish: *Rola Projektowa*. |
| **Member** | An Admin UI user assigned to a Project under one or more Project Roles. |
| **Stage** | A named phase of a Project, with a planned duration, responsible Roles, predefined Tasks, alerts and an optional completion gate. Polish: *Etap*. |
| **Stage workflow** | The Stages of one Project (or Template) plus the permitted moves between them. |
| **Completion gate** | A per-Stage switch: while on, a Project cannot leave the Stage until every Task of that Stage is done or cancelled. |
| **Task** | A unit of work owned by the new `tasks` module: title, description, assignee, due date, status. It may belong to a Project Stage. Polish: *Zadanie*. |
| **Linked item** | An Opportunity, a Quote Request, an Order or a Task attached to a Project. |
| **Deadline alert** | A notification sent to every Member a set number of days before a Stage's deadline. |
| **Lost Project** | A Project closed with the *lost* outcome; the Stage it was in and a loss reason are recorded. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Run a Project through its Stages (Priority: P1)

A Project Manager creates a Project by hand: a title, a description, a value, the
Organization(s) it is done for, its Members with their Project Roles, and its Stages — each
with a planned duration and the Roles responsible for it. They set which moves between Stages
are allowed. They move the Project from Stage to Stage and finally close it as *completed*, or
at any point close it as *lost* with a reason.

**Why this priority**: a Project that can be created, staffed and walked is the module's
reason to exist; Templates, links, alerts and analytics all decorate it.

**Independent Test**: with the Projects module switched on — and the Tasks module **off**, to
prove a Project needs no Tasks — create a Project with two Organizations,
three Members (one of them holding two Roles), three Stages and a linear workflow; move it
through all three Stages and close it as completed; create a second one and close it as lost
in Stage 2; confirm both outcomes, the Stage-entry dates and the lost Stage are recorded.

**Acceptance Scenarios**:

1. **Given** the module is switched on, **When** a user who may create Projects saves a
   Project with a title and at least the required Organizations (see FR-004), **Then** it
   receives a human-readable number, starts in its first Stage, is *open*, and appears in the
   Projects list.
2. **Given** a Project, **When** its Stages are edited, **Then** Stages can be added, renamed,
   reordered, recoloured and removed; each has a planned duration in days, zero or more
   responsible Project Roles, and the default workflow lets each Stage move to the next one.
3. **Given** the Stage workflow, **When** the user adds or removes a permitted move (for
   example back from *Delivery* to *Design*, or skipping *Pilot*), **Then** only permitted
   moves are offered and a move that is not permitted is refused with nothing changed.
4. **Given** a Project enters a Stage, **When** the move completes, **Then** the Stage's
   start date is recorded and its deadline is that date plus its planned duration, unless the
   user set the deadline by hand.
5. **Given** a Project in a Stage from which completion is permitted (by default the last
   Stage), **When** the user closes it as completed, **Then** it is recorded as completed with
   the time it closed.
6. **Given** an open Project in any Stage, **When** the user closes it as lost, **Then** they
   must choose a loss reason (and may add a comment), and the Project is recorded as lost with
   the Stage it was in, the reason and the time.
7. **Given** a closed Project, **When** a user who may manage Projects reopens it, **Then** it
   returns to the Stage it was closed in, its outcome is cleared, and the reopening is in its
   history.
8. **Given** the same user, **When** they are a Member of Project A as *Sales Rep* and of
   Project B as *Project Manager*, **Then** each Project shows them under its own Role.

---

### User Story 2 — Tasks, inside and outside a Project (Priority: P1)

*The Projects module does not require the Tasks module (owner, 2026-10-26: "wyobrażam sobie
Projekt bez Zadań, tylko z opcją przypisywania Zapytań Ofertowych czy Zamówień"). Everything in
this story applies only while the Tasks module is on.*

The new Tasks module lets a user create a Task with a title, a description, an assignee, a due
date and a status (*To do*, *In progress*, *Done*, *Cancelled*). A Task may be placed in a
Stage of a Project. A Stage can carry the gate "all Tasks done before moving on".

**Why this priority**: Stages without Tasks are labels; the completion gate — explicitly asked
for — needs Tasks to exist. Tasks are also the requested base for the module's later growth.

**Independent Test**: create a Task in Stage 1 of a Project with the gate on; try to move the
Project to Stage 2 and be refused, naming the open Task; mark the Task done; move again and
succeed. Separately, create a Task with no Project and find it in the assignee's *My Tasks*.

**Acceptance Scenarios**:

1. **Given** the Tasks module is on, **When** a user creates a Task, **Then** it is saved with
   a number, status *To do*, and appears in the Tasks list and, if assigned, in the assignee's
   *My Tasks*. A Task needs no Project (owner ruling Q3 = A); in this feature it can be
   attached to a Project only — attaching to an Opportunity, an Order or a Quote Request is
   later work.
2. **Given** a Task is assigned or reassigned to somebody other than the person doing it,
   **When** it is saved, **Then** the new assignee is notified with a link to the Task.
3. **Given** a Stage with the completion gate on and at least one of its Tasks neither done
   nor cancelled, **When** a user tries to move the Project out of that Stage (or to close it
   as completed from that Stage), **Then** the move is refused and the open Tasks are listed.
4. **Given** the same Stage, **When** the Project is closed as *lost*, **Then** the gate does
   not apply.
5. **Given** a Stage with the gate off, **When** the Project leaves it with open Tasks,
   **Then** the move succeeds and the open Tasks stay open, still shown under that Stage.
6. **Given** a Task in a Project, **When** it is opened, **Then** it names its Project and
   Stage with a link, and is visible only to users who may see that Project.

---

### User Story 3 — Project Templates (Priority: P2)

An operator defines Project Templates — for example *Showroom fit-out* or *Annual framework
contract* — each with a default description, the Project Roles involved, its Stages with
durations, responsible Roles, predefined Tasks, deadline alerts, gates and workflow. When a
user creates a Project they may load a Template; the new Project is prefilled and remains
editable.

**Why this priority**: repeatable projects are the common case in B2B; without Templates every
Project is re-keyed.

**Independent Test**: build a Template with two Roles, three Stages, two Tasks in Stage 1 and
an alert on Stage 2; create a Project from it; confirm the Project carries all of these;
change the Template and confirm the existing Project did not change.

**Acceptance Scenarios**:

1. **Given** the Templates screen, **When** an operator creates a Template, **Then** they can
   set everything a Project's structure has — Roles, Stages, durations, responsible Roles,
   Stage Tasks (title, description, responsible Role, due offset in days from Stage start),
   gates, alerts, permitted moves — but no Organizations, Members, values or linked items.
2. **Given** a Template, **When** a Project is created from it, **Then** its Stages,
   workflow, gates, alerts and default description are copied, and the Stage Tasks of the
   **first** Stage are created as Tasks; Stage Tasks of later Stages are created when the
   Project enters that Stage.
3. **Given** a Stage Task with a responsible Role, **When** it becomes a Task, **Then** it is
   assigned to the Member holding that Role in the Project if exactly one does, and left
   unassigned (showing the Role) otherwise.
4. **Given** a Project created from a Template, **When** the Template is later edited or
   deleted, **Then** the Project is unchanged; the Project still names the Template it came
   from while the Template exists.
5. **Given** a Template, **When** an operator duplicates or archives it, **Then** the copy is
   independent, and an archived Template is no longer offered for new Projects.

---

### User Story 4 — Project Roles (Priority: P2)

An operator manages the list of Project Roles. *Sales Rep* and *Project Manager* exist from
installation; the operator can add their own (*Designer*, *Installer*, *Account Manager*).
Roles are used in Templates, in Stages and to say who does what in a Project.

**Independent Test**: add the Role *Installer*; use it in a Template's Stage; create a Project
and assign two people as Installers; confirm nothing about either person's permissions
changed.

**Acceptance Scenarios**:

1. **Given** a fresh installation, **When** the Roles screen is opened, **Then** *Sales Rep*
   and *Project Manager* are listed with names in every admin language.
2. **Given** the Roles screen, **When** an operator adds, renames or archives a Role,
   **Then** the change is available in Templates and Projects; an archived Role stays on the
   Projects that use it but is no longer offered.
3. **Given** a Project, **When** a user assigns Members, **Then** one person may hold several
   Roles in it, and one Role may be held by several people.
4. **Given** any assignment of a Project Role, **When** the person signs in, **Then** their
   permissions are exactly those of their RBAC role — a Project Role grants nothing.

---

### User Story 5 — Who sees a Project (Priority: P2)

A platform administrator chooses, in the module's settings, whether Projects are visible to
every Admin UI user who may read Projects, or only to each Project's Members. Within a single
Project, its managers can also decide who sees it.

**Why this priority**: projects carry commercial terms; some deployments run them openly,
others need them closed by default.

**Independent Test**: set the module to *Members only*; as a non-member with permission to
read Projects, confirm the Project is absent from the list, from search, from the linked
Order's screen and by direct address; add that user to the Project and confirm it appears.

**Acceptance Scenarios**:

1. **Given** the module setting *Everyone*, **When** a user who may read Projects opens the
   list, **Then** every Project within their Organization reach is listed.
2. **Given** the module setting *Members only*, **When** the same user opens the list,
   **Then** only Projects they are a Member of (or are otherwise granted, see below) are
   listed.
3. **Given** a Project's own visibility setting, **When** it differs from the module setting,
   **Then** the Project's own choice wins: *Follow the module setting*, *Everyone who may
   read Projects*, or *Members and listed people* — the last naming extra Admin UI users who
   may see the Project without being Members (owner ruling Q2 = A).
6. **Given** a user holding the permission *See every Project*, **When** they open the list,
   **Then** they see every Project within their Organization reach regardless of either
   setting; the permission never widens Organization reach.
4. **Given** a Project the user may not see, **When** they reach it by any route — direct
   address, search, the `@` list, a linked Order/Quote Request/Opportunity/Task, analytics
   drill-down, notification — **Then** it is indistinguishable from a Project that does not
   exist.
5. **Given** a user who may not see a Project, **When** they open an Order linked to it,
   **Then** the Order shows no Project panel at all.

---

### User Story 6 — Link Opportunities, Quote Requests, Orders and Tasks; see the Project from them (Priority: P2)

From a Project, a user links existing Opportunities, Quote Requests and Orders of the
Project's Organizations, and adds Tasks. From the screen of each of those records, a user sees
which Project it belongs to, if any.

**Independent Test**: link one Order, one Quote Request and one Opportunity to a Project;
open each of them and confirm a panel names the Project by number and title with a link;
unlink the Order and confirm its panel is gone.

**Acceptance Scenarios**:

1. **Given** a Project, **When** a user links an Order, a Quote Request or an Opportunity,
   **Then** only records of the Project's Organizations are offered, the record is listed on
   the Project with its number, status and amount, and one record can belong to at most one
   Project at a time.
2. **Given** a record already in another Project, **When** a user tries to link it, **Then**
   they are told which Project holds it (if they may see it) and nothing changes.
3. **Given** an Order, a Quote Request, an Opportunity or a Task in a Project, **When** its
   screen is opened by a user who may see the Project, **Then** it shows the Project's
   number, title and current Stage with a link; with no Project, nothing is shown.
4. **Given** a linked record the reader may not read (they lack permission for Orders,
   Quote Requests or Opportunities), **When** the Project is read, **Then** the record is
   listed as unavailable without its number, status or amount.
5. **Given** the CRM or Quote Requests module is switched off, **When** a Project is
   read, **Then** links to that module's records are shown as unavailable, cannot be added,
   and return unchanged when the module is switched back on.
6. **Given** a linked record no longer exists (an Opportunity deleted in CRM — Orders and
   Quote Requests cannot be deleted), **When** the Project is read, **Then** the link is shown
   as unavailable and can be removed by hand, which is recorded in the Project's history.

---

### User Story 7 — Notes, messages, references and attachments (Priority: P2)

As on an Opportunity, Members keep notes on a Project, talk to each other in an internal
message thread, reference people and records in the description, notes and messages, and
attach files.

**Independent Test**: as one Member, post a message mentioning another by `@`, reference an
Order and a Task, and attach a PDF; as the mentioned Member, confirm a notification leading to
the Project, the references rendered as named links, and the PDF downloadable.

**Acceptance Scenarios**:

1. **Given** a Project, **When** a user adds a note, **Then** it is listed with author and
   time; the author can edit or delete it; both are in history.
2. **Given** a Project, **When** a user posts a message, **Then** it joins the thread in time
   order, cannot be edited, and every Member except the author is notified with a link.
3. **Given** a text field of a Project (description, note, message), **When** the user types
   the reference trigger, **Then** they can pick a person, an Order, a Quote Request, a Task
   or a Product, with the same keyboard behaviour as on an Opportunity, and only kinds of
   records they may read are offered.
4. **Given** a saved text mentioning a person newly, **When** it is saved, **Then** that
   person receives exactly one notification naming the Project by number — never the text —
   unless they are the author or may not see the Project.
5. **Given** a reference to a record the reader may not see or that no longer exists,
   **When** the text is rendered, **Then** the reference shows as unavailable and leaks no
   detail.
6. **Given** a Project, **When** a file is attached, **Then** it is stored in the platform's
   asset library, listed with name, size, uploader and time, downloadable by anyone who may
   see the Project, and the asset library refuses to delete it while the Project uses it.
7. **Given** a text field of an Opportunity in CRM, **When** the user types `@@`, **Then**
   the same grouped list opens — the Opportunity Organization's Orders and Quote Requests, and
   Tasks — and a picked Quote Request or Task is saved, rendered and resolved exactly as in a
   Project (owner ruling 2026-10-26, FR-044).
8. **Given** a customer of any of the Project's Organizations, **When** they use the
   storefront, **Then** nothing of the Project is visible to them.

---

### User Story 8 — Deadline alerts on Stages (Priority: P3)

When defining a Stage — in a Template or directly in a Project — a user sets one or more
alerts "N days before the deadline". When the time comes, every Member of the Project is
notified that the Stage ends in N days.

**Independent Test**: give Stage 1 a deadline five days ahead and an alert at 3 days; advance
time two days; confirm each Member received exactly one notification naming the Project, the
Stage and the deadline, and nobody else did.

**Acceptance Scenarios**:

1. **Given** a Stage with an alert at N days, **When** the Project is in that Stage and the
   deadline is N days away, **Then** every Member is notified in the Admin UI and by e-mail,
   once.
2. **Given** the Project has already left the Stage, or is closed, **When** the alert time
   arrives, **Then** nothing is sent.
3. **Given** the deadline is moved after an alert was sent, **When** the new alert time
   arrives, **Then** the alert is sent once more for the new deadline.
4. **Given** a Member who can no longer see the Project (deactivated, or out of the
   Project's Organization reach), **When** an alert is sent, **Then** they are skipped.
5. **Given** a Project entering a Stage whose alert time is already past, **When** it
   enters, **Then** no backdated alert is sent.

---

### User Story 9 — Custom Fields on a Project (Priority: P3)

An operator defines their own fields for Projects on the existing Custom Fields screen; users
fill them in when creating and editing a Project.

**Acceptance Scenarios**:

1. **Given** the Projects module is on, **When** the Custom Fields screen is opened, **Then**
   *Project* is among the record types fields can be defined for.
2. **Given** a required field for Projects, **When** a Project is saved without it, **Then**
   the save is refused naming the field.
3. **Given** a Project with field values, **When** it is read, **Then** the values are shown
   to those who may see the Project and to nobody else, and changes to them are in history.
4. **Given** the Projects module is switched off, **When** the Custom Fields screen is
   opened, **Then** *Project* is not offered and its definitions cannot be changed; switching
   back on restores them unchanged.

---

### User Story 10 — Project analytics, including lost Projects (Priority: P3)

A manager opens Project analytics for a date range and sees, alongside the figures CRM
analytics shows for Opportunities, how Projects are lost.

**Independent Test**: with a known set of completed and lost Projects, open analytics for the
range and confirm every figure equals the hand-computed one.

**Acceptance Scenarios**:

1. **Given** a date range, **When** analytics load, **Then** they show: Projects opened,
   completed and lost; completion rate; average duration of completed Projects; average
   duration of lost Projects; average time spent in each Stage; average Project value; the
   most valuable open Projects; and the Project Managers with the most completed Projects.
2. **Given** lost Projects in the range, **When** the *Losses* section loads, **Then** it
   shows the number and share of Projects lost at each Stage (ranked, the most frequent
   first), the loss reasons with counts, and the total value of lost Projects.
3. **Given** Projects in several currencies, **When** money figures are shown, **Then** each
   currency is reported separately and amounts are never added across currencies.
4. **Given** Stages differ between Projects, **When** losses are grouped by Stage, **Then**
   Stages are grouped by name, and a filter by Template restricts every figure to Projects
   created from that Template.
5. **Given** a user restricted in Organization reach or in Project visibility, **When**
   analytics load, **Then** every figure is computed only over Projects that user may see.

---

### User Story 11 — Modules that can be switched off, and found (Priority: P3)

Both modules behave like every other platform module: reachable from the command palette,
switchable by an operator, and invisible when off.

**Acceptance Scenarios**:

1. **Given** the Projects module is on, **When** a user who may read Projects opens ⌘K /
   CTRL+K, **Then** they find *Projects*, *New Project*, *Project Templates* and *Project
   analytics*; the Tasks module likewise offers *Tasks*, *My Tasks* and *New Task*.
2. **Given** the Projects module is switched off, **When** anyone uses the platform, **Then**
   no Project screen, navigation entry, palette action, API, alert or Project panel on an
   Order, Quote Request, Opportunity or Task answers; switching it on restores every Project
   unchanged.
3. **Given** the Projects module is on, **When** an operator tries to switch the Tasks module
   off, **Then** it is switched off: Projects keep working with no Tasks tab, no Stage Tasks
   section, no Task references and no completion gate (see FR-040), and every Project's
   Stage Tasks and gate settings are kept.
4. **Given** the Tasks module is switched off, **When** it is switched on again, **Then**
   every Task returns unchanged, still in its Project and Stage, and gates apply again from
   the next Stage move.
5. **Given** the Tasks module is off, **When** a Project enters a Stage that has Stage Tasks,
   **Then** no Task is created, then or later; the Stage history records that its Stage Tasks
   were skipped because Tasks was off.

---

### Edge Cases

- **A Stage the Project is in is deleted** — refused; a Project must always have at least one
  Stage and exactly one current Stage while open.
- **A Stage with Tasks is deleted** — refused until its Tasks are moved to another Stage or
  out of the Project.
- **A Stage's permitted moves leave it unreachable** — allowed, and the workflow editor warns
  that the Stage cannot be reached.
- **An Organization is removed from a Project while records of it are linked** — refused
  until those records are unlinked.
- **A Member is deactivated** — they stay listed as inactive; Tasks assigned to them remain
  assigned and are flagged; they receive no further notifications.
- **A Member is removed from a Project** — their Tasks in that Project stay assigned to them
  and are flagged; under *Members only* visibility they no longer see the Project.
- **Two users move the same Project at once** — one wins; the other is told the Project
  changed and nothing is applied twice.
- **A Stage's planned duration is zero** — the deadline is the day the Project enters it.
- **A Template whose Role has been archived** — the Role is still copied to new Projects from
  that Template, shown as archived.
- **A Project is deleted** — allowed only to users who may manage Projects, and only while it
  has no linked records; its Tasks are deleted with it, its notes and messages too, and its
  attachments are released from the asset library's in-use check.
- **A Task is moved to another Project** — allowed; it leaves the old Stage and must be placed
  in a Stage of the new Project.
- **A Project's value is empty** — it counts in every analytics figure except value-based
  ones, and the screen says how many Projects had no value.
- **A Project whose Organizations the user reaches only partly** — the Project does not exist
  for them (owner ruling Q1 = C, every-Organization rule).
- **A Project with no Organization** (an internal Project) — visible only to administrators
  unrestricted in Organization reach, and then subject to the visibility rule as any other
  Project; nothing can be linked to it until an Organization is added, because every Order,
  Quote Request and Opportunity belongs to one.
- **The last Organization is removed from a Project** — allowed only when no record is linked;
  the Project becomes internal and disappears for Organization-restricted administrators,
  including Members among them, who are told so before saving.
- **A gated Stage while the Tasks module is off** — the gate is not applied; moving on with
  Tasks still open is recorded in the Stage history as "gate not applied: Tasks off".

## Requirements *(mandatory)*

### Functional Requirements

**Project**

- **FR-001**: System MUST let a permitted user create, read, edit and delete Projects with a
  title (required), a description with references, a value with its currency (optional), a
  start date, Members, Stages, the Stage workflow, Custom Field values, and the Template it was
  created from (if any).
- **FR-002**: System MUST give each Project a unique human-readable number.
- **FR-003**: System MUST keep a Project's state as *open*, *completed* or *lost*, plus its
  current Stage while open, and record the time and the user of every change of Stage and
  outcome.
- **FR-004**: A Project MUST be associated with zero or more Organizations (owner ruling
  Q1 = C). An administrator restricted to certain Organizations MUST see a Project only if
  they reach **every** one of its Organizations; a Project with no Organization MUST be
  visible only to administrators unrestricted in Organization reach. Both rules come before,
  and are never widened by, the visibility rule of FR-019.
- **FR-005**: Closing a Project as lost MUST require a loss reason from an operator-maintained
  list (seeded with *Price*, *Competitor chosen*, *Project cancelled by client*, *No decision*,
  *Other*) and MUST record the Stage it was lost in.
- **FR-006**: A permitted user MUST be able to reopen a closed Project into the Stage it was
  closed in.

**Project Roles and Members**

- **FR-007**: System MUST provide an operator-maintained list of Project Roles, seeded with
  *Sales Rep* and *Project Manager*, each with a name in every admin language, and allow
  adding, renaming and archiving Roles.
- **FR-008**: System MUST let a Project assign any active Admin UI user to one or more Roles,
  and let one Role be held by several users.
- **FR-009**: A Project Role MUST NOT grant or withdraw any permission.

**Stages and workflow**

- **FR-010**: Each Stage MUST have a name, a colour, an order, a planned duration in calendar
  days, zero or more responsible Roles, zero or more deadline alerts (whole days before the
  deadline), a completion-gate switch (off by default), and whether completing the Project
  from it is permitted (on for the last Stage by default).
- **FR-011**: Each Project and Template MUST have its own Stage workflow: a set of permitted
  moves between its Stages, defaulting to "each Stage → the next one", editable to add
  backward or skipping moves.
- **FR-012**: System MUST refuse any Stage move that the workflow does not permit, and any
  move out of a gated Stage while one of its Tasks is neither done nor cancelled, naming the
  open Tasks. Closing as lost MUST NOT be subject to the gate.
- **FR-013**: On entering a Stage, System MUST record its start date and compute its deadline
  as start date plus planned duration, unless a deadline was set by hand for that Stage.
- **FR-014**: Other modules and deployments MUST be able to register logic that runs before a
  Stage move (and may refuse it with a reason) or after it (and cannot undo it), on the same
  principle as the Opportunity workflow.

**Templates**

- **FR-015**: System MUST let an operator create, edit, duplicate and archive Project
  Templates holding a default description, Roles, Stages (with every attribute of FR-010),
  Stage Tasks (title, description, responsible Role, due offset in days from Stage start), and
  the Stage workflow.
- **FR-016**: Creating a Project from a Template MUST copy its structure into the Project;
  later changes to the Template MUST NOT change existing Projects.
- **FR-017**: Stage Tasks MUST become Tasks when the Project enters their Stage (the first
  Stage's on creation), assigned per User Story 3 scenario 3, with a due date of Stage start
  plus their offset. Re-entering a Stage MUST NOT create its Stage Tasks again.

**Visibility**

- **FR-018**: The Projects module MUST have a setting *Project visibility* with values
  *Everyone who may read Projects* and *Members only* (default: *Members only*).
- **FR-019**: Each Project MUST have its own visibility (owner ruling Q2 = A): *Follow the
  module setting* (default), *Everyone who may read Projects*, or *Members and listed people*
  (Members plus named Admin UI users). Holders of the permission *See every Project* MUST see
  every Project regardless of both settings, within their Organization reach (FR-004).
- **FR-020**: Every read of a Project — list, detail, search, `@` list, Project panels on
  other records, Tasks of the Project, analytics, notifications — MUST apply the Organization
  reach and the visibility rule, and a Project outside them MUST be indistinguishable from one
  that does not exist.

**Linked items**

- **FR-021**: System MUST let a user link to a Project, and unlink, existing Orders, Quote
  Requests and Opportunities belonging to the Project's Organizations; a record MUST belong to
  at most one Project at a time.
- **FR-022**: The screens of an Order, a Quote Request, an Opportunity and a Task MUST show the
  Project the record belongs to (number, title, current Stage, link) to a user who may see that
  Project, and nothing otherwise.
- **FR-023**: A linked record MUST be shown with its number, status and amount only to a user
  who may read records of its kind; otherwise as unavailable.
- **FR-024**: When the CRM or Quote Requests module is off, its links MUST be kept,
  shown as unavailable and not addable; the Project MUST keep working.

**Collaboration**

- **FR-025**: System MUST provide notes (editable and deletable by their author) and an
  append-only internal message thread on each Project; a new message MUST notify every Member
  except its author.
- **FR-026**: The description, notes and messages MUST support references to people, Orders,
  Quote Requests, Tasks and Products, inserted and rendered as on an Opportunity, with a newly
  mentioned person notified once under the rules of the Opportunity mentions.
- **FR-027**: System MUST let users attach files to a Project through the platform's asset
  library, with the library refusing deletion of a file a Project uses.
- **FR-028**: Every change to a Project — fields, Members, Stages, workflow, moves, outcome,
  links, notes, attachments, Custom Field values — MUST be recorded in the Project's history
  through the platform's uniform audited write path, with who and when.

**Tasks module (first version)**

- **FR-029**: The Tasks module MUST let a permitted user create, read, edit and delete Tasks
  with a number, title (required), description, one assignee (optional), due date (optional),
  status (*To do*, *In progress*, *Done*, *Cancelled*), creator, and the time it was completed.
- **FR-030**: The Tasks module MUST provide a Tasks list (filter by status, assignee, due date,
  Project) and a *My Tasks* view of the signed-in user's open Tasks ordered by due date, with
  overdue Tasks marked. A Task with no Project MUST be visible to every user who may read
  Tasks; a Task in a Project, only under FR-031.
- **FR-031**: A Task MUST be attachable to at most one Project and, within it, to exactly one
  of its Stages. A Task in a Project MUST be visible only to users who may see that Project.
- **FR-032**: Assigning a Task to someone other than the acting user MUST notify the assignee.
- **FR-033**: The Tasks module MUST expose a documented interface through which other modules
  create Tasks, read them, change their status and are told when a Task changes status, so
  that Projects — and later other modules — use Tasks without reaching into its internals.
- **FR-034**: Task changes MUST be recorded through the platform's uniform audited write path.

**Alerts**

- **FR-035**: For each deadline alert of the current Stage of an open Project, System MUST
  notify every active Member who may see the Project, once, in the Admin UI and by e-mail, on
  the day the deadline is that many days away; a moved deadline re-arms the alert; no alert is
  sent backdated or for a Stage the Project has left.

**Custom Fields**

- **FR-036**: *Project* MUST be a record type of the Custom Fields module, with values
  validated on save, shown under the Project's visibility, and carried in history: the
  Project's history shows each changed field — custom fields and the Project value — with its
  value before and after the change, while the platform audit log names the changed fields only
  and holds none of their values (owner decision 2026-10-27, issue #470 decision A; T144 F4,
  T145).

**Analytics**

- **FR-037**: System MUST provide Project analytics for a date range with the figures of User
  Story 10 scenarios 1 and 2, filterable by Template, Organization and Project Manager, each
  figure computed only over Projects the viewer may see, and money figures per currency. The
  range's days are counted in the reporting time zone — a setting the Analytics module owns
  (`analytics.reporting_time_zone`), default `UTC` — and in `UTC` while Analytics is off; Projects
  degrades, never fails, without it (owner decisions 2026-10-27, issue #465; T146).
- **FR-038**: Each analytics figure MUST state the period and the number of Projects it was
  computed from, and any Projects excluded (for example for missing value).

**Platform conformity**

- **FR-039**: Both modules MUST be switchable by an operator; when off, they behave as if not
  installed (no screens, navigation, palette actions, API, workers, alerts, panels on other
  records), and switching them on restores every record unchanged.
- **FR-040**: The Projects module MUST NOT require any of the switchable Tasks, CRM, Quote
  Requests or Admin notifications modules (Orders and the asset library cannot be switched off,
  so depending on them costs an operator nothing). While the Tasks module is off, Projects MUST offer no
  Tasks, no Stage Tasks section and no Task references, MUST NOT apply completion gates, and
  MUST NOT create Stage Tasks; Stage Task definitions and gate settings MUST be kept and
  apply again once Tasks is on. A Project MUST be fully usable with nothing but its own
  fields, Members, Stages, notes, messages and links to Quote Requests or Orders.
- **FR-041**: Both modules MUST be reachable from the command palette and from the
  navigation, gated by their own permissions: read, manage (create/edit/move/close), configure
  (Roles, Templates, loss reasons, settings), *See every Project* and view analytics for
  Projects; read and manage
  for Tasks.
- **FR-042**: Every user-facing string of both modules MUST exist in English and Polish, and
  both modules MUST ship user and developer documentation in English and Polish.
- **FR-043**: Nothing of a Project or a Task MUST be visible on the storefront.
- **FR-044**: The reference facility MUST be one standard across Projects and CRM: in an
  Opportunity's description, notes and messages `@@` MUST open the same grouped document list
  (Orders · Quote Requests · Tasks, each group only for a present module and a user who may
  read it) and MUST store, render and resolve Quote Request and Task references as Projects
  do. Existing CRM texts and their references MUST be unchanged. This supersedes
  `specs/143-crm-sales-opportunities/spec.md` User Story 18 scenario 2 for `@@`.

### Key Entities

- **Project**: number, title, description, value + currency, start date, state (open /
  completed / lost), current Stage, closed time, loss reason + comment + lost Stage, source
  Template, own visibility, Custom Field values. Related to one or more Organizations.
- **Project Member**: a Project, an Admin UI user, one or more Project Roles.
- **Project Role**: name per language, archived flag, seeded *Sales Rep* and *Project
  Manager*. Platform-wide list.
- **Project Stage**: belongs to one Project; name, colour, order, planned duration, start date,
  deadline (computed or manual), responsible Roles, completion gate, completion permitted,
  alert offsets.
- **Stage move permission**: from-Stage → to-Stage within one Project or Template.
- **Stage history entry**: Project, from Stage, to Stage, user, time.
- **Project Template**: name, default description, archived flag; its Roles, Template Stages,
  Template Stage Tasks and move permissions.
- **Loss reason**: name per language, archived flag; operator-maintained.
- **Project link**: Project ↔ one Order, Quote Request or Opportunity (each record in at most
  one Project).
- **Project note / Project message / Project attachment**: as their Opportunity counterparts.
- **Deadline alert record**: Project Stage, offset, the deadline it was sent for, time sent.
- **Task** (Tasks module): number, title, description, assignee, due date, status, creator,
  completed time, optional Project + Stage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a Project from a Template with three Stages and assign three
  Members in under 3 minutes, without re-entering anything the Template holds.
- **SC-002**: 100 % of Stage moves the workflow does not permit, and of moves out of a gated
  Stage with open Tasks, are refused with nothing changed.
- **SC-003**: Under *Members only* visibility, a non-member reaches no detail of the Project
  by any of the routes listed in FR-020, verified per route by an automated test.
- **SC-004**: Every deadline alert is delivered to each eligible Member exactly once, on its
  due day, and never for a Stage the Project has left — verified over a simulated 60-day
  timeline.
- **SC-005**: Every analytics figure, including losses per Stage and the value of lost
  Projects, equals the hand-computed value on a seeded data set of at least 50 Projects.
- **SC-006**: From an Order, a Quote Request, an Opportunity or a Task, a user who may see its
  Project reaches the Project in one click.
- **SC-007**: Switching either module off and on again leaves every one of its records
  unchanged, and while off the rest of the platform behaves as without the module.
- **SC-008**: The Projects list of 1 000 Projects opens and filters in under 2 seconds for a
  user who may see all of them.

## Clarifications

### Session 2026-10-26 — owner's rulings

- Q: Organizations of a Project and Organization reach → A: **C** — Organizations are
  optional, so internal Projects exist; a Project without one is visible only to
  administrators unrestricted in Organization reach; otherwise an administrator must reach
  every Organization of the Project (FR-004).
- Q: Per-Project visibility → A: **A** — *Follow the module setting* / *Everyone who may read
  Projects* / *Members and listed people*, plus a *See every Project* permission that bypasses
  both settings but never Organization reach (FR-019).
- Q: Scope of the first Tasks module → A: **A** — Tasks exist without a Project, with their own
  list and *My Tasks*; in this feature a Task attaches only to a Project (FR-029 – FR-031).
- Owner, unprompted: **Projects do not require Tasks** — a Project with no Tasks, only linked
  Quote Requests or Orders, is a normal use. The Tasks module is therefore optional for
  Projects, and the completion gate and Stage Tasks are inert while it is off (FR-040).

### Session 2026-10-26 (after planning) — owner's ruling

- Q: In Projects `@@` opens one list of documents (Orders · Quote Requests · Tasks) while CRM
  kept `@@` = Orders — keep them different? → A: **No — standardise**: CRM does what Projects
  does (owner: "ustandaryzujmy to i róbmy tak, jak planujemy to robić w Projektach również w
  CRM"). Recorded as FR-044 and User Story 7 scenario 7.

### Amendments from planning (2026-10-26)

Facts measured during `/speckit.plan` (`research.md` F-1, F-9, R-21), not owner rulings:

- Orders, the asset library and Custom Fields cannot be switched off, so the "when Orders / the
  asset library is off" cases were removed from User Story 6, FR-024, FR-027 and FR-040.
- Orders and Quote Requests cannot be deleted and CRM emits no event when an Opportunity is
  deleted; User Story 6 scenario 6 now says a vanished record's link shows as unavailable
  instead of disappearing.

## Assumptions

- The Opportunity module (`specs/143-crm-sales-opportunities/`) is the model for notes,
  messages, `@` references, attachments, history, the transition-hook principle and the
  analytics screen; Projects reuse the same behaviour rather than inventing a second one. The
  exact trigger for referencing a Quote Request and a Task is settled at planning, consistent
  with `@` (people), `@@` (Orders) and `@@@` (Products) of CRM.
- *Project Manager*, listed by the owner as a new actor, is a Project Role, not a new RBAC
  role; operators grant Project permissions to existing or new RBAC roles as they do today.
- Project value is entered by hand; it is not computed from linked Orders or Quote Requests in
  this feature.
- A Stage's duration is in calendar days; working-day calendars are out of scope.
- Deadline alerts go to Members only, not to holders of a Role who are not Members.
- Alerts use the existing Admin UI notifications and transactional e-mail; a user's own
  notification preferences, where the platform has them, apply.
- No customer-facing (storefront) surface, no webhooks for Projects, no board/Gantt view, no
  time tracking, no Task dependencies, sub-tasks, recurring Tasks or Task comments in this
  feature — all candidates for later work on the Tasks module.
- Linking a record to a Project does not change the record's status; Projects have no status
  mapping to Orders or Opportunities.
- Existing Orders, Quote Requests and Opportunities are not linked to Projects automatically.
- Demo data gains a few Projects from one Template, in several Stages, one completed and one
  lost, so the screens and analytics have something to show.

## Dependencies

- **Tasks** (`tasks`) — new in this feature; optional for Projects (FR-040).
- **CRM** (`crm`), **Quote Requests** (`quote_requests`) — optional; provide linkable records
  and show the Project panel.
- **Orders** (`orders`) — always present (not switchable); linkable records, Project panel.
- **Asset library** (`assets_library`) — always present; stores attachments.
- **Custom Fields** (`custom_fields`) — always present; provides operator-defined fields.
- **Organizations** (`organizations`), **Admin users**, **Admin notifications**, **Settings**,
  transactional **E-mail** — platform services used as they are.
