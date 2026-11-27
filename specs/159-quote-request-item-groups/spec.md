# Feature Specification: Named, reorderable line-item groups on quote requests that carry over to orders

**Feature Branch**: `feat/159-quote-request-item-groups` (spec directory `specs/159-quote-request-item-groups/`)
**Created**: 2026-10-20
**Status**: Ready for implementation — owner decisions D1–D5 are fixed and the owner answered Q-A and
Q-B on 2026-10-20 (*Clarifications*): no order PDF in this feature (D4 amended); a grouping-only save
is an ordinary revision. D6 (2026-10-21) allows one product on several lines, in different groups.
**Input**: GitHub issue #375, *"Quote requests: group line items into named, reorderable groups that
carry over to orders"* — when an admin builds a quote request in the Admin UI they can group its
line items into named groups, each with its own summary; groups can be created, named, renamed,
deleted and reordered, and line items moved between and within them by drag and drop; groups are
printed on the quote PDF and shown in the quote preview on the platform (Admin UI and storefront);
an order generated from a quote keeps its groups; an admin creating an order in the Admin UI can
group its lines the same way; customers only see groups, they never edit them.

## Background

A sales representative preparing a long offer — a fit-out, a project bill of materials, a
multi-site supply — wants to present it the way the customer thinks about it: *Ground floor*,
*First floor*, *Optional extras*. Today a quote request is one flat list of lines, and so is the
order it becomes, the quote PDF (`specs/153-quote-request-pdf-template/`) and every screen that
shows either. The lines do not even have a stored order of their own: they are listed in whatever
order the database returns them.

## Vocabulary

- **Document** — a quote request or an order.
- **Group** — a named, ordered section of a document's lines, created by an administrator. Groups
  are **presentation only**: they never change a price, a discount or a total.
- **Other items** — the section holding the lines that belong to no group. It is always printed
  last, it has no name of its own (the platform's translated label is used), and it cannot be
  renamed, moved or deleted. On the customer's side it is headed *Other items*; on the admin
  editing screens *Ungrouped*.
- **Group summary** — the totals of one group, computed from that group's lines by the same rule
  the document's own totals use (item count, net, VAT, gross, and — where the document shows one —
  discount).
- **Grouping** — the set of a document's groups, their order, which lines each holds and the order
  of lines within each section.
- **Carry-over** — copying a quote request's grouping onto the order placed from it.

## Clarifications

### Owner decisions, 2026-10-20 (given with the task)

- **D1 — Groups are optional; ungrouped lines are allowed beside them.** Lines in no group appear
  in their own section after every group. A document with no group looks exactly as it does today.
- **D2 — Deleting a group never deletes lines.** Its lines move to the ungrouped section. A group
  emptied by moving its lines out stays until the administrator deletes it; **empty groups are
  omitted on the PDF and on the storefront**.
- **D3 — Groups are presentation only.** No effect on prices, discounts or document totals. A
  group's summary (net, gross, discount, item count, and whatever document-level totals apply per
  line) is computed from its lines.
- **D4 — Visibility** (as amended by the owner's answer to Q-A). Groups are shown read-only in the
  storefront quote view **and** the storefront order detail, and on the **quote request PDF**
  (document templates). There is **no order PDF** in this feature — the order confirmation e-mail
  suffices today. Groups are **not** carried to invoices.
- **D5 — Carry-over and order creation.** Converting a quote to an order copies its groups (names,
  order, membership). Admin order creation supports creating groups too. Whether order groups stay
  editable after placement is the architect's call (recommended: editable while the order's lines
  are editable, read-only otherwise).

### Decided in design (architect, 2026-10-20; rationale in `research.md`)

- **Order groups are read-only once the order is placed** (D5). Order lines cannot be edited after
  placement anywhere in the platform today, so "editable while the lines are" means "set at
  creation, then fixed". A later feature that makes order lines editable inherits the rule
  (research R-18).
- **Quote groups are editable exactly when the quote's lines are** — in *Created from admin* and
  *Pending*, from the same *Modify* screen and saved by the same *Save revision* — and read-only in
  every other state (research R-12).
- **A customer's resubmission does not copy groups**; a reorder and an order cloned back into a
  quote do not either. Each starts a new document whose grouping is the representative's to make
  (research R-24).

### Owner decision, 2026-10-21

- **D6 — One product on several lines, in different groups.** The same product and variant may be
  placed on several lines of one document, in different groups or twice in one — *5 pcs of X in
  Hall A and 3 pcs of X in Hall B* — through the whole chain: creating and modifying a quote, what
  the customer sees, the quote PDF, the conversion to an order, the admin order creation and every
  order screen. It replaces the earlier rule that an admin-created order refuses one product in two
  groups. Each line is priced at its own quantity, as separate basket lines already are; a quote's
  lines carry their own agreed prices anyway. An administrator can make such a line from an
  existing one with *Split line* (research N-31 … N-34).

### Owner answers, 2026-10-20

- **Q-A — The order PDF.** D4 originally placed groups on "the order PDF", but no *Order* document
  type exists in the platform (only the quote, the invoice and the comparison are registered). →
  **No order PDF**: it is not built in this feature, and groups appear on the quote request PDF only.
  The order confirmation e-mail suffices today. D4 above is amended to match.
- **Q-B — Does a change of grouping alone ask the customer to accept the quote again?** → **Yes.**
  A save of the *Modify* screen that only regroups (renames a group, moves lines between groups,
  reorders) is a revision like any other save: the customer is notified and accepts it again. The
  silent-save alternative is recorded as rejected in research R-9.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Group the lines of a quote request while preparing it (Priority: P1) 🎯 MVP

A sales representative opens a quote request's *Modify* tab (or *Create quote request*), adds a
group *Ground floor*, a group *First floor* and a group *Options*, drags lines into them, reorders
lines inside a group, drags *Options* below the others, renames *First floor* to *Floor 1*, and
watches each group's summary — item count, net, VAT, gross and, where list prices are known,
discount — update as lines move. They save the revision.

**Why this priority**: this is the request; everything else displays or copies what it produces.

**Independent Test**: on a 9-line quote create three groups, place 3 lines in each by drag and drop,
reorder one group, save, reload: the same groups, order, membership and line order are shown, each
group's summary equals the sum of its lines, and the quote's totals are unchanged to the cent.

**Acceptance Scenarios**:

1. **Given** a quote in *Pending* with no group, **When** the representative opens *Modify*, **Then**
   the lines are listed as today, with an *Add group* control and no section heading.
2. **Given** they add a group, **Then** it is created with an editable name field focused, appears
   above the *Ungrouped* section, and is empty with a visible drop area.
3. **Given** a line, **When** it is dragged onto a group, or moved with the keyboard, or moved with
   the line's *Move to group* menu, **Then** it lands in that group at the chosen place and the move
   is announced to assistive technology.
4. **Given** a group, **When** it is dragged above another group (or moved with the keyboard or its
   *Move up* / *Move down* buttons), **Then** the groups' order changes and *Ungrouped* stays last.
5. **Given** a group holding lines, **When** the representative deletes it, **Then** its lines move to
   *Ungrouped* in their order and no line is deleted (D2).
6. **Given** an emptied group, **Then** it stays on the screen until deleted (D2).
7. **Given** a group, **Then** its summary shows the number of lines and the net, VAT and gross of
   its priced lines by the same rule as the quote's totals; a group with an unpriced line shows no
   money total, exactly as the quote does (D3).
8. **Given** they save, **Then** the grouping is stored with the revision, the quote's totals,
   prices and discounts are unchanged, and the change is recorded in the audit log.
9. **Given** the quote is *Approved*, *Completed*, *Canceled* or *Expired*, **Then** the groups are
   shown read-only and no grouping control is offered.
10. **Given** *Create quote request*, **Then** the same controls are offered and the quote is created
    with its groups.

---

### User Story 2 — The customer sees the groups on the storefront and accepts the quote (Priority: P1)

A buyer opens the quote on the storefront and sees its lines under the representative's group
headings, in order, each group with its own summary, then *Other items*; they accept the revision
as before. The admin quote screen shows the same grouping read-only on its *Overview* tab, and the
*History* tab says when and how the grouping changed.

**Why this priority**: D4 — a grouping the customer cannot see is not worth making.

**Independent Test**: after US1, open the quote on the storefront: three headed sections in the
saved order, each with its summary, then *Other items*; an empty group is not shown; accepting
works; the admin *History* lists the grouping changes of the revision.

**Acceptance Scenarios**:

1. **Given** a quote with groups, **When** the customer opens it on the storefront, **Then** each
   non-empty group is a headed section in the representative's order with its lines in order and its
   summary (item count, net, VAT, gross — the totals the page already shows for the whole quote),
   followed by *Other items* when any line is ungrouped.
2. **Given** a quote with no group, **Then** the storefront page is unchanged.
3. **Given** a group with no lines, **Then** the customer never sees it (D2).
4. **Given** the storefront, **Then** the customer has no control that creates, renames, deletes or
   reorders a group, and the customer API accepts no grouping field.
5. **Given** a revision that changed the grouping, **When** the customer compares it with the
   revision they last saw, **Then** the comparison says the arrangement of the lines changed.
6. **Given** the customer accepts the revision, **Then** acceptance works exactly as today; the
   grouping never makes an acceptance fail.
7. **Given** the admin *History* tab, **Then** a revision's entry lists *group added*, *group
   removed*, *group renamed*, *line moved to another group* and *order changed* where they apply.
8. **Given** the admin *Overview* tab, **Then** the lines are shown grouped, read-only, with each
   group's summary.

---

### User Story 3 — Groups on the quote PDF (Priority: P2)

A representative exports a grouped quote to PDF (`specs/153-…`): the Line items table prints a
heading row per group, its lines, and its subtotal rows; then *Other items*; then the quote's totals
as before. Templates made before this feature print groups without being edited. An operator
designing a template can choose, in the table's *Grouping* settings, to follow the document's groups
(default), to group by a field (as before), or not to group.

**Why this priority**: D4; the PDF is the document a buyer forwards.

**Independent Test**: export the US1 quote with the built-in layout and with a template created
before this feature: both print three headed sections with subtotals in the saved order, positions
numbered 1…9 across the sections, and the same totals as the ungrouped quote; export a quote with no
group: the PDF is the same as before this feature.

**Acceptance Scenarios**:

1. **Given** a grouped quote and a table whose grouping is not configured, **Then** each non-empty
   group prints a heading row with its name and, if enabled, its item count; its lines; and one
   subtotal row per totals row of the table, evaluated over the group's lines.
2. **Given** ungrouped lines beside groups, **Then** they print last under the template's *Other
   items* heading.
3. **Given** a quote with no group, **Then** the table prints exactly as before this feature.
4. **Given** an empty group, **Then** nothing is printed for it (D2).
5. **Given** the table is set to group by a field, **Then** it groups by that field as before and the
   document's groups are not printed in that table; **given** *No grouping*, **Then** it prints flat.
6. **Given** the position column, **Then** positions run 1…n across all sections in printed order.
7. **Given** the template editor's canvas and *Preview PDF*, **Then** the sample quote has groups, so
   the operator sees the sections.

---

### User Story 4 — The order placed from a quote keeps its groups (Priority: P2)

A buyer converts an accepted, grouped quote to an order and checks out. The order has the quote's
groups — same names, same order, same lines in each, same line order — and the storefront order
detail and the admin order screen show them.

**Why this priority**: D5; the order is what is fulfilled and invoiced.

**Independent Test**: convert the US1 quote, place the order without touching the basket: the order
has three groups with the same names, order and lines; add an extra product to the basket before
checkout on a second run: that line is under *Other items*.

**Acceptance Scenarios**:

1. **Given** a basket filled from an accepted quote, **When** the order is placed, **Then** it carries
   every quote group that holds at least one of the order's lines, with the quote's names and order,
   each holding the order lines that came from that group's quote lines, in the quote's order.
2. **Given** the buyer added a line, or changed a line so that it no longer matches a quote line,
   **Then** that line is under *Other items*.
3. **Given** a quote group none of whose lines reached the order, **Then** the order has no such
   group.
4. **Given** the quote's source is not accepted for the order (another organisation, no longer
   approved, already ordered, quote requests switched off), **Then** the order is placed without
   groups exactly as it is today.
5. **Given** the representative changes the quote after the order was placed, **Then** the order's
   groups do not change.
6. **Given** the order's invoice, **Then** it is produced as today, without groups (D4).

---

### User Story 5 — Group the lines of an order created in the Admin UI (Priority: P2)

An administrator creating an order for a customer adds groups and arranges the lines with the same
controls as on a quote, sees each group's summary next to the live price summary, and creates the
order with its groups.

**Why this priority**: D5.

**Independent Test**: create an order with two groups and one ungrouped line: the order shows the two
groups and *Other items* in the chosen order, and its totals equal those of the same order created
without groups.

**Acceptance Scenarios**:

1. **Given** the order creation screen, **Then** *Add group*, rename, delete, drag and drop, keyboard
   moves and *Move to group* behave as on a quote (US1 scenarios 2–7).
2. **Given** the order is created, **Then** its groups, their order, membership and line order are
   those on the screen, written together with the order — a refused order writes no group.
3. **Given** an order's group summary, **Then** it shows the item count, net, VAT and gross of its
   lines; the order's discounts and delivery stay in the order's totals only.

---

### User Story 6 — Order groups shown read-only (Priority: P2)

A buyer opens an order on the storefront, an operator opens it in the Admin UI: both see the lines
grouped, each group with its summary, then *Other items*. Neither can change the grouping.

**Independent Test**: open the US4 and US5 orders on both surfaces.

**Acceptance Scenarios**:

1. **Given** an order with groups, **Then** the storefront order detail and the admin order screen show
   each group as a headed section with its lines and summary, then *Other items*.
2. **Given** an order without groups — every order placed before this feature among them — **Then**
   both screens are unchanged.
3. **Given** any order, **Then** no surface offers a control that changes its grouping.

---

### Edge Cases

- **A quote with one line in one group** — a valid grouping; the line prints under its heading with
  its summary; nothing prints under *Other items*.
- **Every line moved out of every group** — the groups stay on the admin screen (D2) and the
  customer, the PDF and the order see an ungrouped document identical to today's.
- **Two groups with the same name** — allowed; groups are identified by the platform, not by name.
  The admin screen does not refuse it.
- **A group name of only spaces** — refused as empty; names are trimmed; at most 120 characters.
- **More than 50 groups** — refused with a message naming the limit.
- **A line removed while editing** — it leaves its group; the group stays.
- **Group summaries and rounding** — each group's VAT is computed from its own net, so the groups'
  VAT may differ from the document's VAT by a rounding cent; the document's totals are authoritative
  and are never recomputed from the groups (D3).
- **A group of unpriced lines** — its money totals are empty, as the document's are.
- **Lines in different currencies** (not produced today) — a group's money totals are empty, as the
  document's are.
- **A concurrent edit** — two representatives saving the same quote: the second save is refused as
  today (version check); groups never make a save succeed that would otherwise be refused.
- **A customer edits their own draft before any representative revision** — no group can exist at
  that point (groups are created by representatives only, and a representative's save closes the
  customer's draft); should one exist, the customer's edit keeps every unchanged line in its group.
- **An API client that does not know groups** saves a quote's lines — every line it keeps stays in
  its group; lines it adds are ungrouped.
- **The same product twice on an admin-created order, in two groups or in one** — allowed (D6):
  each request line becomes an order line of its own, in its own group, priced at its own quantity;
  a product's minimum order quantity is still judged on its total across its lines.
- **The same product on two quote lines in two groups, both converted** — each order line keeps the
  group of the quote line it came from, whatever order the basket lists them in — even at one agreed
  price, the agreed quantity tells them apart.
- **A product on several lines changes between two revisions** — the customer's comparison and the
  admin *History* pair each line with its own (by group, then quantity) and name the group of the
  line an entry is about, so *X: 5 → 3* says which X line.
- **A customer's own draft basket** — a customer adding a product twice still gets one line of it
  (the storefront draft merges by product); customers do not group lines.
- **Quote requests switched off at checkout** — the order is placed without groups (as it is placed
  without its quote source today).
- **Document templates switched off** — PDFs are unavailable as today; groups on every screen are
  unaffected.
- **Orders placed before this feature** — no groups, lines in their stored order; nothing is
  backfilled.
- **Quote lines saved before this feature** — no position; they keep the order they are shown in
  today until the quote is next saved.

## Requirements *(mandatory)*

### Functional Requirements

#### Grouping a quote request (admin)

- **FR-001**: The admin *Modify* tab and *Create quote request* screen MUST let an administrator who
  may handle quote requests and see the quote's organisation create, name, rename and delete groups,
  while the quote's lines are editable (*Created from admin*, *Pending*).
- **FR-002**: A group name MUST be trimmed and hold 1–120 characters; names need not be unique; a
  document MUST hold at most 50 groups.
- **FR-003**: Deleting a group MUST move its lines to the ungrouped section, keeping their order, and
  MUST NOT delete any line (D2).
- **FR-004**: An administrator MUST be able to move a line into another group or the ungrouped section,
  and to a chosen position, by pointer drag and drop, by keyboard, and by a single-pointer *Move to
  group* control that needs no dragging.
- **FR-005**: An administrator MUST be able to reorder lines within a section and to reorder groups by
  pointer drag and drop, by keyboard, and by *Move up* / *Move down* controls; the ungrouped section
  MUST always be last and MUST NOT be movable, renameable or deletable.
- **FR-006**: A line added from a group's own *Add product* control MUST be added to that group; any
  other added line MUST be added to the ungrouped section.
- **FR-007**: An emptied group MUST remain until the administrator deletes it (D2); it MUST be shown on
  the admin editing screens as an empty drop area.
- **FR-008**: Each section on the admin screens MUST show its summary — item count, and net, VAT and
  gross by the rule the quote's own totals use, plus the discount against the list price where the
  admin screen shows list prices — recomputed as lines are edited and moved (D3).
- **FR-009**: The grouping MUST be saved by the same action that saves the quote's lines (*Save
  revision*, *Create*), atomically with them, under the same concurrency check, and MUST be included
  in that action's audit entry.
- **FR-010**: Groups MUST NOT change any price, discount, quantity or total of the quote (D3).
- **FR-011**: Every reading of a quote's lines — admin and customer screens, PDF, conversion, the
  published read port — MUST present them in the saved order: groups in their order, each group's lines
  in their order, then the ungrouped lines in their order.
- **FR-012**: In any state other than *Created from admin* and *Pending*, the grouping MUST be shown
  read-only and every grouping write MUST be refused as the line edit is refused today.
- **FR-013**: An admin API client that saves a quote's lines without sending a grouping MUST keep every
  line it keeps (the same pairing that keeps a line's note and reference price) in its group, and put
  lines it adds in the ungrouped section.
- **FR-014** (D6): A quote MUST accept the same product and variant on several lines, in different
  groups or in one; *Create quote request* MUST let an administrator add a product that is already a
  line, and every line MUST keep its own quantity, agreed price and price prefill. Where a line is
  paired with a stored line without an id (an API client, a customer's draft edit, a revision
  comparison), a line of the same group and then of the same quantity MUST be preferred before
  position decides.
- **FR-015** (D6): The *Modify* tab MUST offer, on every line of quantity 2 or more, a *Split line*
  action (*Podziel pozycję*) that asks for the quantity to move (1 … quantity − 1) and the group of the
  new line (default: the line's own) and creates a new line of the same product, variant, packaging
  unit, agreed price and customer's proposal, reducing the original by the quantity moved; it MUST be
  operable by keyboard alone and return focus to the control that opened it.

#### Revisions, history and the customer's acceptance

- **FR-020**: Every revision MUST record the grouping as the customer was shown it: the groups that hold
  lines, their names and order, each line's group and order.
- **FR-021**: A save that changes only the grouping MUST be a revision like any other save of the
  *Modify* screen: the customer is notified and asked to accept it (owner answer Q-B).
- **FR-022**: The admin *History* entry of a revision MUST list, where they apply: *group added*, *group
  removed*, *group renamed* (before and after), *line moved to another group* (from and to), and
  *order changed* (lines or groups reordered with no other change to them).
- **FR-023**: The customer's comparison with the last revision they saw MUST say, in one entry, that the
  arrangement of the lines changed, and MUST NOT reveal anything the customer reply does not already
  carry. An entry about a product that sits on more than one line MUST name the group of the line it
  is about (D6); the *History* line reference likewise.
- **FR-024**: Accepting or rejecting a revision MUST behave exactly as today; the grouping MUST NOT be
  a reason to refuse an acceptance.
- **FR-025**: No customer-facing operation MUST accept a grouping input; a customer's own draft edit
  MUST keep every paired line in its group (FR-013's rule) and MUST NOT create, rename, delete or
  reorder a group.
- **FR-026**: A customer's resubmission MUST NOT copy groups.

#### Showing groups

- **FR-030**: The storefront quote view MUST show each non-empty group as a headed section, in order,
  with its lines in order and its summary (item count, net, VAT, gross — computed by the rule the page
  already uses for the whole quote), followed by an *Other items* section when any line is ungrouped
  and at least one group is shown (D4).
- **FR-031**: The storefront order detail MUST show the order's groups the same way, with summaries of
  item count, net, VAT and gross (D4).
- **FR-032**: The admin quote *Overview* tab and the admin order screen MUST show the grouping
  read-only with summaries.
- **FR-033**: A document with no group (or only empty groups) MUST be shown on every surface exactly as
  before this feature (D1, D2).
- **FR-034**: Empty groups MUST NOT appear on the storefront, in a customer API reply, on a PDF, in a
  revision or on an order (D2).

#### The quote request PDF (document templates)

- **FR-040**: A document type MUST be able to declare, without changing the document-templates facility
  beyond this feature, the sections of a line collection: for each non-empty group its name, its lines
  and its totals over the collection's totals catalogue, plus the ungrouped lines.
- **FR-041**: The Line items table MUST offer, in its *Grouping* setting: *Document's groups*
  (default), *By field* (as before), *No grouping*. A table whose grouping was never configured MUST
  behave as *Document's groups*.
- **FR-042**: With *Document's groups*, when the document has at least one non-empty group, the table
  MUST print per group a heading row (the group's name, and its item count when enabled), the group's
  lines, and one subtotal row per totals row of the table evaluated over the group's totals with the
  same labels and visibility rules; then the ungrouped lines under a heading whose text is a
  per-language template setting (default *Other items* / *Pozostałe pozycje*); then the document's
  totals as before. When the document has no non-empty group the table MUST print as before this
  feature.
- **FR-043**: Positions MUST be numbered 1…n across sections in printed order.
- **FR-044**: The quote document type MUST declare its sections (FR-040); its built-in layout and sample
  data MUST show groups.
- **FR-045**: The table's grouping settings MUST be validated when a template is saved; templates saved
  before this feature MUST remain valid and render unchanged for documents without groups.

#### Carry-over to the order

- **FR-050**: An order placed from a basket whose accepted-quote source the platform vouches for MUST
  copy, in the same transaction as the order, the quote's grouping: each order line that came from a
  quote line takes that line's group and order; each quote group that holds at least one order line is
  copied with its name and relative order.
- **FR-051**: An order line that matches no quote line (added after the conversion, or changed so that
  it no longer matches) MUST be ungrouped and follow the matched lines.
- **FR-052**: When the source is not vouched, or quote requests are off, the order MUST be placed
  without groups and otherwise exactly as today.
- **FR-053**: An order's grouping MUST NOT change when its quote changes later.
- **FR-054** (D6): Order lines MUST be matched to quote lines by product, variant, agreed quantity and
  agreed price first, so a product split over several quote lines at one price keeps each line's
  group whatever the basket's order.

#### Grouping an order in the Admin UI

- **FR-060**: The admin order creation screen MUST offer the grouping controls of FR-001–FR-007 and
  FR-008's summaries (item count, net, VAT, gross per group).
- **FR-061**: The order MUST be created with the grouping on the screen in the same transaction as the
  order; a refused creation MUST write no group.
- **FR-062** (D6, superseding the earlier refusal): A creation request naming the same product and
  variant on several lines — in different groups or in one — MUST create one order line per request
  line, each in its own group and priced at its own quantity; minimums stay judged per product. The
  screen MUST let an administrator add a product that is already a line and MUST offer *Split line*
  (FR-015) on its lines.
- **FR-063**: An order's grouping MUST be read-only after placement on every surface and in every API.

#### Invoices

- **FR-070**: Invoices MUST NOT carry groups (D4).

#### Permissions, auditing, availability, languages, documentation

- **FR-080**: No new permission: grouping a quote requires the existing quote-handling permission and
  the quote's organisation visibility; grouping an order requires the existing order-write permission
  and the customer's scope.
- **FR-081**: Every administrator's grouping write MUST be part of the audited write of its document
  (quote modification, quote creation, order creation on a customer's behalf), recording the
  grouping's shape (groups and their line counts); a customer's own checkout stays unaudited as today.
- **FR-082**: A group MUST be reachable only through its document; a request for another
  organisation's document's groups MUST be answered exactly as a request for a document that does not
  exist.
- **FR-083**: While document templates are off, PDFs behave as today and groups on every screen are
  unaffected; while quote requests are off, orders keep and show their groups and new orders are placed
  without carry-over.
- **FR-084**: Every new admin, storefront, PDF and error text MUST exist in Polish and English.
- **FR-085**: Every grouping interaction MUST meet WCAG 2.2 AA: operable by keyboard, a single-pointer
  alternative to every drag, moves announced, visible focus, and no information conveyed by position
  alone.
- **FR-086**: The end-user documentation MUST describe grouping quote and order lines, what customers
  see, carry-over and the table's grouping setting, in Polish and English.
- **FR-087**: The published quote read model and the order replies MUST carry each line's group and
  order additively, so an integration that ignores them keeps working.

### Key Entities

- **Quote request line group** — belongs to one quote request: name, position among the quote's groups.
- **Quote request line** (existing) — gains its group (or none) and its position within its section.
- **Quote request revision** (existing) — each line's snapshot also records its group (id, name,
  position) and its position.
- **Order line group** — belongs to one order: name, position. Written at placement; never changed.
- **Order line** (existing) — gains its group (or none) and its position within its section.
- **Line section** (derived, not stored) — a group with its lines and summary, or the ungrouped lines.
- **Table grouping setting** (inside a document template) — *Document's groups*, *By field*, *None*;
  the *Other items* label; the item-count toggle.

## Success Criteria *(mandatory)*

- **SC-001**: A representative turns a 20-line quote into 3 named groups with every line placed, using
  only the keyboard, in under 3 minutes — and with a mouse in under 2.
- **SC-002**: For 100 % of a reference set of documents (grouped and ungrouped, priced and unpriced,
  with and without list prices), every document total is identical with and without groups.
- **SC-003**: 100 % of orders placed from an unchanged basket of a grouped, accepted quote carry the
  quote's non-empty groups with identical names, order, membership and line order.
- **SC-004**: A document without groups renders the same PDF definition, the same storefront markup and
  the same API reply (apart from the additive fields) as before this feature.
- **SC-005**: Saving a 200-line quote with 20 groups takes under 1 second at the 95th percentile;
  exporting it to PDF stays within 153's 5-second budget.
- **SC-006**: Zero automated accessibility violations on the grouping screens; every grouping action
  is completable without a pointer drag.
- **SC-007**: Zero customer-facing endpoints accept a grouping field; zero cross-organisation reads of
  groups succeed — proven by tests.

## Assumptions

- Group names are free text written by representatives for the customer to read; they are shown as
  written (no translation) on every surface and are not localised per language.
- The summary rule of each surface is the one it already uses for the whole document: the admin quote
  screens and the PDF (agreed prices, every line or none), the storefront quote page (agreed prices,
  else the customer's proposed prices), the order (stored line prices and tax rates).
- Order discounts (promotions) and delivery are order-level and are not apportioned to groups.
- The quote's PDF and the screens read the grouping at the moment they are produced;
  nothing is cached.
- The cart and the checkout do not show groups; a basket is the buyer's own.

## Out of scope

- Groups in the cart, the checkout, the quick-order and shopping-list screens, invoices (D4), returns,
  e-mails, exports and webhooks payloads beyond the additive order reply fields.
- Editing an order's grouping after placement (FR-063).
- Nested groups, group-level notes, group-level discounts or prices, collapsing groups.
- Copying groups on resubmission, reorder, or order-to-quote cloning (FR-026; research R-24).
- An order PDF of any kind — admin or customer-facing (owner answer Q-A); the order confirmation e-mail is unchanged and shows no groups.
