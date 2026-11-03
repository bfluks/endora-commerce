# Research: Named, reorderable line-item groups on quote requests that carry over to orders

**Feature**: `specs/159-quote-request-item-groups/` | **Date**: 2026-10-20
**Builds on**: `specs/146-quote-request-pricing-history/` (line pairing, revisions, history),
`specs/153-quote-request-pdf-template/` (the Line items table), `specs/155-catalog-order-constraints/`
(quote-seeded basket lines), `specs/143-crm-sales-opportunities/` (the vouched quote source at
placement).

Every decision is stated as **decision → rationale → alternatives rejected**. Facts are cited to files
in this checkout. Abbreviations: `QR` = `packages/modules/quote_requests`, `OR` =
`packages/modules/orders`, `DT` = `packages/modules/document_templates`, `CT` =
`packages/contracts/src`, `AK` = `packages/admin-kit/src`, `SF` = `storefront`.

---

## Part 1 — Facts

### R-1 — How a quote's lines are stored, ordered, rewritten and revised today

- `QR/src/backend/entities/quote-request-item.entity.ts` — `@GlobalEntity()`, no position column.
- **There is no stored line order.** Reads order by `createdAt, id` (`rfq-admin-service.ts` `modify`,
  `rfq-service.ts` `patchDraft`, `document/document-service.ts`), by `createdAt` only
  (`quote-request-read-port.ts` `listItems`), or **not at all**: `RfqService.serializeFull` — the
  admin and customer replies — calls `em.find(QuoteRequestItem, { quoteRequestId })` with no
  `orderBy`, and `rfq-admin-service.ts` `modify` reads the rewritten lines for the revision snapshot
  the same way. All lines of one rewrite are created in one loop, so `createdAt` ties are possible
  and `id` is random: the displayed order is not guaranteed today. Groups need a stored order; adding
  it fixes this latent defect as a side effect (R-6).
- **Both line writes delete and recreate every line.** `RfqAdminService.modify` and
  `RfqService.patchDraft` call `em.removeAndFlush(existing)` and create the body's lines afresh; what a
  line carries that the body does not restate survives through `pairLines`
  (`services/line-carry-over.ts`: by id for admins, then product/variant/packaging, then order).
- **Every `modify` is a revision.** It bumps `currentRevisionNumber`, sets
  `awaitingCustomerRevisionAcceptance = true`, records a `QuoteRequestRevision` whose `itemsSnapshot`
  (jsonb, `QuoteRequestRevisionLine[]`) is built from the rewritten lines, appends a `modified` event
  with a diff, enqueues the customer notification and emits `rfq.modified.v1`. `createOnBehalf`
  records revision 1.
- **A customer can edit only a draft no administrator has revised** (`services/draft-guard.ts`
  `assertDraftOpenForCustomer`): an admin `modify` closes it for good.
- **Acceptance pins the revision number** (`respondToRevision`): `expectedRevisionNumber` must equal
  `currentRevisionNumber`.
- **The customer reply is an allow-list** (`services/customer-projection.ts`: `CUSTOMER_ITEM_KEYS`,
  `CUSTOMER_PAYLOAD_KEYS`, `CUSTOMER_DIFF_KEYS`) — 146's threat-model T7.
- **Admin history** is projected on read from events and revision snapshots
  (`services/history/history-projection.ts`, `history-diff.ts`), change kinds declared in
  `CT/quote-requests.ts` `quoteRequestHistoryChangeSchema`.
- **Totals** are computed by each surface: admin `RfqDetail.tsx` (agreed prices, every line or none,
  flat `taxRate`), storefront `SF/app/(account)/quote-requests/[id]/page.tsx` (agreed, else desired,
  every line or none), PDF `QR/src/backend/document/quote-lines.ts` `quoteSummary` (agreed, every line
  or none, discount against the stored reference price — admin-only data).
- **Audit**: `quote_requests` is not yet migrated to the Command Bus for its line writes;
  `modify`/`createOnBehalf` audit co-transactionally through `recordAuditFromContext`
  (`#audit`, actions `quote_request.modify`, `quote_request.create_on_behalf`). Its newer writes are
  Commands (`commands/document-template-commands.ts`, `negotiation-policy-commands.ts`).

### R-2 — How an order gets its lines, and whether they change afterwards

- `OR/src/backend/entities/order-item.entity.ts` — `@GlobalEntity()`, no position; `lineTotal` is
  **gross** (`unitPrice × quantity × (1 + taxRate)`, `order-service.ts` `placeOrder`), `taxRate` per
  line.
- **Order lines are never edited after placement.** The admin routes (`OR/src/backend/routes.ts`)
  change status, payment status, custom fields and comments; none touches `order_items`.
- **Every order is placed by `OrderService.placeOrder` from a basket.** The quote conversion
  (`QR/…/rfq-service.ts` `convertToOrder`) seeds the basket through
  `CartWritePort.replaceItemsForCustomer(…, { sourceQuoteRequestId })`; the admin creation
  (`OR/…/order-creation-admin-service.ts`) seeds it through `CartWritePort.addItems(…, {
  replaceExisting: true })`, then calls `placeOrder`.
- **The quote source is vouched inside the placement transaction** (`order-service.ts`
  `#vouchedQuoteRequestSource` → `#assessQuoteRequestSource`): it already reads the quote **and its
  lines** through `quoteRequestReadPort.findById` / `listItems` and judges the claim with
  `OR/src/backend/domain/quote-request-source.ts`. The edge is `degrades-without`
  (`OR/src/manifest.ts`).
- **The basket merges repeated lines** of one `(product, variant, unit)` (`carts/…/cart-service.ts`
  `#writeLine`); the admin creation screen offers each product once (`OrderCreatePage.tsx`
  `appendLines`, "skipping any already a line") and sends no variant. *(As of 2026-10-21 the admin
  creation seeds with `keepRepeatedLines` and the screen offers a product again — N-31.)*
- **Invoices** read orders through the order read port and are out of scope (D4).

### R-3 — What the document-templates facility can print today

- The Line items table (`DT/src/backend/rendering/items-table.ts`) already groups **by a field's
  value** (`grouping: { field, emptyLabel, subtotalField, subtotalLabel }`, `CT/document-templates.ts`
  `itemsTableGroupingSchema`), with one subtotal of one field; groups are keyed by the formatted value,
  so two groups with one name would merge.
- `DocumentCollectionDeclaration` (`CT/document-templates.ts`) offers `fields`, `items`,
  `summaryFields`, `summary` — no notion of sections.
- The quote's built-in layout stores `grouping: null` (`QR/src/backend/document/built-in-layout.ts`),
  and so does every template an operator started from it; the editor's *No grouping* choice writes
  `null` (`DT/src/admin/blocks/items-table/GroupingField.tsx`).
- **No order document type exists.** Registrations: `quote_requests.quote_request`, invoices,
  comparisons (`grep -rl DocumentTypeRegistration packages/modules`). `orders` produces no PDF of its
  own; `OR/src/backend/routes.ts` only streams the invoice's.

### R-4 — Drag-and-drop primitives in the tree

- `@dnd-kit/core` ^6.3.1 is a dependency of `admin` and a peer of `admin-kit`; **`@dnd-kit/sortable`
  is not installed**. Its one consumer is `AK/components/kanban/KanbanBoard.tsx`, whose header states
  that cards have **no order inside a lane** and that "a consumer that needs ordered lanes needs a
  different primitive, or this one extended with that dependency and its justification".
- `AK/components/reorder/useReorderList.ts` — the shared ordered-list primitive (feature 067):
  native HTML5 pointer drag, ARIA grab-mode keyboard map, `moveBy` for `TouchReorderButtons`,
  announcements through `ReorderAnnouncer`, all copy as props. One flat list; used by
  `product_feeds` and the Line items table's column editor.

---

## Part 2 — Decisions

### R-5 — Storage: a group table per document module, a nullable group reference and a position on the line

**Decision**: `quote_requests` owns a new table `quote_request_item_groups` (`id`, `quote_request_id`
→ `quote_requests` on delete cascade, `name`, `position`, timestamps) and adds
`quote_request_items.group_id` (→ `quote_request_item_groups` **on delete set null**) and
`quote_request_items.position`. `orders` owns `order_item_groups` (`id`, `order_id` → `orders` on
delete cascade, `name`, `position`, `created_at`) and adds `order_items.group_id` (on delete set null)
and `order_items.position`. Full shapes in `data-model.md`.

**Rationale**: a group has an identity that outlives renames and is referenced by lines and by
revision snapshots — a row. `on delete set null` makes D2 ("deleting a group never deletes lines")
true at the database level, not only in a service. Each module owns the grouping of its own document
(Principle I) — no shared table, no cross-module FK.

**Alternatives rejected**:
- *A jsonb `item_groups` array on the parent row plus an unenforced `group_id` on lines* — no
  referential integrity, and a rename becomes a whole-array rewrite that races the line rewrite.
- *A `group_name` text column on each line* — two groups sharing a name merge; a rename touches every
  line; an empty group (D2) cannot exist.
- *One generic `document_line_groups` table owned by a platform or a new module* — a new module owning
  no domain (Principle I: justify by domain ownership), and a foreign key from two modules' lines into
  it would bind both to its presence.

### R-6 — Position semantics, and no backfill

**Decision**: `position` is the line's 0-based order **within its section** (its group, or the
ungrouped section); groups have their own `position`. The display order is: groups by `position`,
each group's lines by `(position, created_at, id)`, then ungrouped lines by `(position, created_at,
id)`. The column is `integer not null default 0` and **nothing is backfilled**: legacy rows all read
`0`, so the tie-break on `(created_at, id)` gives exactly today's best-effort order, and the next save
of a quote writes real positions. Every read path adopts the one ordering through a shared helper
(`CT/line-groups.ts` `arrangeLineGroups`, `contracts/line-groups.md` §3).

**Rationale**: a per-section position keeps a group reorder a write of group rows only, and matches how
the editor sends lines. Adding a `not null` column with a constant default is metadata-only in
PostgreSQL ≥ 11 — no table rewrite of `order_items`, which holds every order line ever placed.

**Alternatives rejected**: *a document-wide position* — every group reorder rewrites every line, and
an order's ungrouped tail has no stable meaning; *a nullable position* — every reader must special-case
`null`; *a backfill by `row_number()`* — a long `UPDATE` over `order_items` for an order the new
default already gives.

### R-7 — Tenancy classification of the new entities

**Decision**: `QuoteRequestItemGroup` is `@TransitivelyScoped('QuoteRequest', 'quoteRequestId')` and
`OrderItemGroup` is `@TransitivelyScoped('Order', 'orderId')`
(`@endora-commerce/platform/tenancy`). Every read and write also goes through the parent first
(`findVisibleForAdmin` / `findVisibleForCustomer`, the order access service), so an out-of-scope group
is unreachable twice over and answers like a missing document (404).

**Rationale**: Principle XI asks every *new* entity for its honest classification; a group has no
tenant column and belongs to exactly one org-scoped parent — the definition of transitive. The
lines themselves stay `@GlobalEntity` (unchanged; reclassifying them is not this feature's change).

**Alternatives rejected**: *`@GlobalEntity` to match the lines* — would add a new entity outside the
guard's defence in depth for no gain; *an `organization_id` column on the group* — a second copy of the
parent's tenant that can disagree with it.

### R-8 — Quote groups travel with the line edit, in one request

**Decision**: the grouping is part of the existing admin writes: `PATCH /api/v1/admin/quote-requests/:id`
(`adminPatchQuoteRequestSchema`) and `POST /api/v1/admin/quote-requests` gain an optional `groups`
array and an optional `groupKey` per line (`contracts/quote-requests-api.md` §1–§2). Groups are
upserted (an `id` keeps a group's identity across a rename), missing ones deleted, and the lines'
`group_id`/`position` written in the same row lock and transaction as the line rewrite.

**Rationale**: the lines are deleted and recreated on every save (R-1), so membership can only be
written atomically with them; one *Save revision* button is how the *Modify* screen already works;
the version check and the audit entry already cover the request.

**Alternatives rejected**: *a separate `PUT /admin/quote-requests/:id/groups`* — two saves for one edit,
a window in which lines exist without their groups, and two concurrency checks to reconcile; *a
separate Command per group operation (create, rename, move…)* — dozens of round trips per edit
session and a revision model that would not know when the layout the customer sees changed.

### R-9 — A grouping-only save (owner question Q-B)

**Decision (owner ruling, 2026-10-20 — answer to Q-B, confirming the recommendation)**: a save whose only change is the grouping is a revision
like every other `modify`: revision number bumped, snapshot recorded, `modified` event with the
grouping changes, customer notified, acceptance requested.

**Rationale**: one path, no new state; the customer accepts exactly the document they see; the history
shows when the layout changed. D3 says groups do not change prices — not that the customer may not be
told the document changed.

**Alternative rejected by the owner's ruling**: *layout-only saves are silent*. In
`modify`, when the body's lines pair one-to-one with the stored lines and every paired line keeps its
quantity, agreed price, note and variant, and the header note, validity and custom fields are
unchanged, write the grouping without bumping the revision, without notifying, without touching
`awaitingCustomerRevisionAcceptance`; still bump `version` (it is a row write) and audit it as
`quote_request.regroup`. Cost: one predicate in `modify` (pure, unit-tested), a new audit action, a
history entry kind *layout changed* projected from a new `regrouped` event type (one migration widening
the event-type check, as 153 did for `pdf-sent`), and a revision snapshot that no longer describes what
the customer sees — so the storefront comparison would have to read the live grouping. Not built; the
owner chose one save path in which the customer accepts exactly the document they see.

### R-10 — What a revision records

**Decision**: each `QuoteRequestRevisionLine` in `itemsSnapshot` gains optional keys `position`,
`groupId`, `groupName`, `groupPosition` (absent on snapshots written before this feature, read as
ungrouped). No new column on `quote_request_revisions`.

**Rationale**: a revision records what the customer was shown, and D2 says empty groups are never shown,
so the groups that hold lines — derivable from the lines — are exactly the ones to record. The
snapshot is jsonb and its readers already treat absent keys as unknown (146 R6 did the same for
packaging).

**Alternatives rejected**: *a `groups_snapshot` jsonb column* — a migration to record empty groups
nobody is shown.

### R-11 — History and comparison entries

**Decision**: `quoteRequestHistoryChangeSchema` gains `group_added { group }`, `group_removed { group }`,
`group_renamed { groupId, before, after }`, `line_group { line, before, after }` (group names or
`null` for ungrouped) and `line_order` (no payload). Groups pair across snapshots by `groupId`; lines by
the existing `pairLines` rule. `line_order` is emitted once when the order of groups, or of lines
within an unchanged section, differs and nothing else explains it. The customer's `RfqDiffEntry`
(`rfq-revision-service.ts`) gains one kind, `grouping`, with no other key — it passes the
`CUSTOMER_DIFF_KEYS` allow-list unchanged and names no group the customer was not shown.

**Rationale**: the admin history is the representatives' audit trail (146 FR-010) and is detailed;
the customer's comparison is a notice, and a per-line list of moves would bury the price changes it
exists to show.

### R-12 — When quote groups are editable

**Decision**: exactly when `modify` accepts the quote (`Created from admin`, `Pending`) — the guard is
`modify`'s own. In every other state the screens show the grouping read-only.

**Rationale**: an *Approved* quote is a commitment the buyer has accepted; its document should not
change under them, even in presentation. Tying grouping to line editability is the owner's stated
recommendation (D5) and needs no new state check.

### R-13 — The customer's paths

**Decision**: no customer schema gains a grouping key (`createQuoteRequestSchema`,
`patchQuoteRequestSchema` are `.strict()`, so a sent key is refused). `patchDraft` keeps a paired
line's `group_id` and gives it the body's relative order within its section; new lines are
ungrouped. In practice no group exists while a customer may edit (R-1: a representative's save closes
the draft), so this is defence in depth.

### R-14 — Admin API clients that do not know groups

**Decision**: a `PATCH` that carries `items` but no `groups` keeps the grouping: each paired line keeps
its group (the pairing already used for notes and references, R-1), positions follow the body order
within each section, new lines are ungrouped, groups are not deleted. A `PATCH` carrying `groups`
must carry `items` (schema refinement, 400). A `PATCH` with neither leaves the grouping untouched.

**Rationale**: integrations and overlay modules may write quotes through this route; an additive field
must not silently ungroup a quote they touch.

### R-15 — Group summaries: computed by each surface, by its own totals rule, from one shared arrangement

**Decision**: summaries are **not stored and not in any API reply**. `CT/line-groups.ts` exports the
pure `arrangeLineGroups(groups, lines, { includeEmptyGroups })` → ordered sections; each surface sums a
section's lines with the function it already uses for the whole document (admin quote screens, PDF
`quoteSummary` applied to the section's lines, storefront page, order totals per line).

**Rationale**: D3 — "computed from its items"; the totals rules differ by surface already (R-1), and a
group summary must agree with the document total next to it on the same surface. A stored summary would
be a cache to invalidate on every price edit.

**Alternatives rejected**: *a server-computed `groupSummaries` on the reply* — a second statement of
each surface's rule, which would disagree with the storefront's desired-price fallback.

**Rounding**: a section's VAT is computed from the section's net (the PDF's rule) or summed per line
(the order's), so the sections' VAT may differ from the document's by a cent. The document total is
authoritative and never recomputed from sections (spec *Edge Cases*).

### R-16 — Carry-over at placement, through the existing read port

**Decision**: `QuoteRequestLineRecord` (`CT/quote-requests.ts`) gains optional `position` and
`group: { id, name, position } | null`, and `listItems` answers lines in display order. In
`placeOrder`, the vouched assessment (R-2) already holds the quote's lines; when the source is accepted,
a pure function `OR/src/backend/domain/quote-line-groups.ts` `carryQuoteGrouping(quoteLines,
orderLines)` assigns each order line (in basket order) the first unclaimed quote line with the same
product, variant and unit price, else the first with the same product and variant; matched lines take
that line's group and order; unmatched lines are ungrouped after them; quote groups that received a line
are created as `order_item_groups` in their quote order (positions renumbered). All of it inside the
placement transaction, before `order.created.v1` is collected.

**Rationale**: no new port method, no new edge — the read and the edge (`degrades-without`) already
exist; the vouching rule decides *whether* the order is the quote's, so the grouping follows exactly the
orders that carry `source_quote_request_id`. Optional record fields keep every structural stub of the
port compiling (the convention of 146 and 155 on this interface).

**Alternatives rejected**: *a `listItemGroups` port method* — a second round trip for data derivable
from the lines (empty groups are not carried, D2); *carrying groups on the basket* — `carts` would hold
presentation data of another module's document, and a basket is the buyer's to edit; *an
`order.created.v1` subscriber in `quote_requests` writing the order's groups* — `quote_requests` would
write `orders`' tables (Principle I) after the commit, so an order would exist without its groups.

### R-17 — Admin order creation: the grouping enters placement as an internal option

**Decision**: `adminCreateOrderRequestSchema` gains `groups` (no `id`: a new document) and a per-line
`groupKey`; `OrderCreationAdminService.create` validates it (FR-062 as first written: one
product+variant in one group only — **superseded by D6 on 2026-10-21, see N-31**), then passes a `lineGrouping` to `placeOrder` through its options — like `origin`, not on
`OrderPlacementPort`. `placeOrder` maps order lines to the request's lines by `(productId, variantId)`.
The admin preview schema is untouched (`adminCreateOrderItemSchema` stays; the create schema uses an
extension).

**Rationale**: one transaction (FR-061); the one placement implementation stays the only writer of
order lines.

**Alternatives rejected**: *a follow-up write after `placeOrder` returns* — an order would exist without
its groups if that write failed, and the write would need its own audit.

### R-18 — Order groups are read-only after placement (D5)

**Decision**: no write path exists for an order's grouping after placement; no admin control offers one.

**Rationale**: D5's recommendation reduces to this, because order lines are never editable after
placement (R-2). A later feature that makes order lines editable can add grouping writes beside them.

**Alternatives rejected**: *a presentation-only regroup endpoint on orders* — a write path no line edit
accompanies; the customer's confirmation, the invoice and any delivered paperwork would silently diverge from
what was agreed.

### R-19 — The PDF: sections on collections, and a grouping mode on the table

**Decision**:
1. `DocumentCollectionDeclaration` gains optional `sections?(data): readonly DocumentItemSection[]` —
   `{ key, kind: 'group' | 'ungrouped', label, itemIndexes, summary }` — the host's partition of its own
   `items(data)` (which it already returns in display order), with each section's totals over the
   collection's summary catalogue. Only non-empty sections.
2. `itemsTableGroupingSchema` becomes a union: the existing field shape (no `by`, or `by: 'field'`);
   `{ by: 'sections', otherItemsLabel, showItemCount }`; `{ by: 'none' }`. **`null` or absent means
   `sections`** with defaults.
3. In `sections` mode, when the document has at least one `group` section, the renderer prints per
   section a heading row, the section's rows, and the table's **own totals rows** evaluated over the
   section's `summary` (same labels and rules); then the document totals as before. With no `group`
   section it prints flat — byte-for-byte the pre-feature definition (SC-004).
4. The facility validates the partition at render (every index once, in order); a malformed partition is
   logged and the table prints flat — never a failed document.
5. Route 2 (`documentTypeDetail`) adds `sampleSections` so the canvas shows them; the editor's
   `GroupingField` offers the three modes.

**Rationale**: reuses the 153 machinery (D3 of 153: "the general machinery belongs to the facility");
existing templates (`grouping: null`, R-3) print groups without being edited, while a document without
groups is unchanged; the totals rows a template already chose are, by construction, "whatever
document-level totals apply" (D3 of this feature).

**Alternatives rejected**: *group by a `groupName` field with the existing field grouping* — merges
same-named groups, prints ungrouped lines under `emptyLabel` *first or wherever they first appear*, and
offers one subtotal field instead of the document's totals; *a quote-owned block printing groups* — not
reusable by any other document type that later declares groups (an order PDF, should one ever be
built), and two table renderers to keep in step; *opt-in only (`null` = flat)* — every
existing quote template would print a grouped quote flat until edited, which reads as the feature not
working.

**Changed meaning, stated**: an operator who chose *No grouping* before this feature stored `null`,
which now means *Document's groups*. It changes nothing for an ungrouped document; for a grouped one it
prints the groups the representative made — the intended outcome. The changeset says so.

### R-20 — The order PDF (owner question Q-A) — not built

**Decision (owner ruling, 2026-10-20 — answer to Q-A)**: **no order PDF** in this feature. D4 is
amended: groups appear on the quote request PDF only; the order confirmation e-mail suffices today.
Order groups are shown on the storefront order detail and the admin order screen only.

**Alternative rejected by the owner's ruling**: a minimal `orders.order` document type (built-in
`en-US`/`pl-PL` layout, `default_only` selection, three blocks, a `lines` collection with sections, an
admin `GET /api/v1/admin/orders/:id/pdf` route behind `orders:read`, and the `contributes-to` /
`refuses-without` pair toward `document_templates` that `quote_requests` declares for 153). It was the
smallest way to make the original D4 true, since no order document type exists (R-3).

**Consequence kept in the design**: the facility's `sections` (R-19) are generic, so a later order
document type gets grouped tables by declaring `sections` on its collection — no facility change.

### R-21 — Drag and drop: an admin-kit grouped-reorder primitive on the existing idiom, no new dependency

**Decision**: add to `@endora-commerce/admin-kit/components`:
- `useGroupedReorder` (`AK/components/reorder/useGroupedReorder.ts`) — the multi-section sibling of
  `useReorderList`: one model of sections (groups + the fixed ungrouped section) and items; native HTML5
  pointer drag for lines (drop on a line = insert before it; drop on a section's drop area = append) and
  for group headers; the ARIA grab-mode keyboard map (Space/Enter lift, ↑/↓ move — crossing a section
  boundary moves the line into the neighbouring section — Escape cancel); `moveLine(id, sectionKey,
  index)` and `moveGroup(key, delta)` for the non-drag controls; every move announced through
  `ReorderAnnouncer`; all copy as props.
- `LineGroupsEditor` (`AK/components/line-groups/LineGroupsEditor.tsx`) — renders the sections (group
  header with inline-editable name, delete, *Move up/down*, drag handle; empty drop area; the ungrouped
  section last), delegates each line's cells to `renderLine` and each section's summary to
  `renderSummary`, adds *Move to group* to each line (the WCAG 2.5.7 single-pointer alternative),
  `readOnly` mode for display. Domain-free: knows no quote or order.

**Rationale**: both editing screens (quote: `QR` admin; order: `OR` admin) need it and cannot import each
other (Principle I), so it belongs in the kit (Principle IX). `useReorderList` is the sanctioned idiom for
*ordered* lists (keyboard, touch buttons, announcements) and KanbanBoard's header explicitly rules itself
out for ordered lanes (R-4).

**Alternatives rejected**:
- *Add `@dnd-kit/sortable`* — a new runtime dependency (Constitution IV) whose gain is animation; the
  multi-container keyboard and touch story would still have to be written, and the kit would hold two DnD
  idioms for ordered lists.
- *`KanbanBoard`* — no order within a lane, horizontal lanes.
- *`@dnd-kit/core` with hand-computed insertion indexes* — usable, but its keyboard sensor moves by
  coordinates, so an announced "move to position n of group g" needs a custom coordinate getter per row;
  more code than the native idiom for the same result.

### R-22 — Auditing (Principle XIII)

**Decision**: grouping writes are part of the audited writes they belong to, in the same transaction:
`quote_request.modify` / `quote_request.create_on_behalf` (their `stateAfter` gains `groups: [{ name,
lineCount }]`, and `stateBefore` of `modify` the previous shape), and, for an order an administrator
creates, `order.place_on_behalf` (`OR/…/order-service.ts`; `stateAfter.groups`). A customer's own
checkout records no audit entry today (it is not an administrator's write; the order row is the
record), and the grouping it copies from the quote follows that rule unchanged. No new write path, so
no new Command and no hand-written audit call is added.

**Rationale**: the grouping cannot be written apart from the line rewrite (R-8) or the placement (R-16,
R-17); a second audit entry for the same request would double-audit one operation. `quote_requests`'
line writes are not yet migrated to the Command Bus (R-1); migrating `modify` is a module-wide change
outside this feature's scope and is noted for the module's Command Bus migration. The owner's Q-B ruling
(R-9) keeps every grouping save inside `modify`, so no new write path exists.

### R-23 — Off-states (Principle XVII)

| Module off | Effect |
| --- | --- |
| `document_templates` | Quote PDFs absent and refused (`refuses-without`, as 153); grouping on every screen unaffected; stored templates and grouping kept. |
| `quote_requests` | `quoteRequestReadPort` absent → placement carries no source and no groups (`degrades-without`, unchanged); existing orders keep and show their groups (they are `orders`' rows). |
| `orders` | Non-deactivatable. |
| `carts` | Non-deactivatable for this purpose (placement fails closed as today). |

No new edge: carry-over rides the existing `degrades-without` read, and `orders` gains no edge toward
`document_templates` (no order PDF — R-20).

### R-24 — What does not carry groups

Resubmission (a new customer request, re-priced; the representative regroups it), reorder (fills a
basket), order-to-quote cloning (`order-clone-to-quote-service.ts` builds a customer request), invoices
(D4), returns, the cart and checkout, e-mails, webhooks and the ERP connector's documents. The order
reply's additive fields reach the external order API (`routes.external.ts` shares the serializer) — an
additive, harmless exposure of data the buyer already sees.

### R-25 — No cache, no event, no setting, no permission

Neither quote nor order reads are cached in Redis (`grep` over `QR/src/backend`, `OR/src/backend`:
only BullMQ and rate-limit uses), so there is nothing to invalidate. No domain event is added
(`rfq.modified.v1` and `order.created.v1` keep their payloads). No setting (no knob the owner asked for).
No permission (FR-080).

### R-26 — Limits

50 groups per document; names 1–120 characters after trimming; a client group key `^[A-Za-z0-9_-]{1,64}$`.
Lines per document are unchanged (quotes: none; admin orders: `ADMIN_ORDER_MAX_ITEMS` = 200).

### R-27 — Languages

Admin texts live in each module's own bundle (`QR/i18n`, `OR/i18n`, `DT/i18n`, en + pl); the kit
component carries no strings (labels are props, the kit convention). Storefront texts go into
`SF/lib/i18n/messages.ts`, whose total `Record` makes a missing Polish string a type error. PDF texts in
the per-language text maps (`QR/src/backend/document/texts.ts`, a new `OR/src/backend/document/texts.ts`)
and the facility's default *Other items* label in `DT`'s maps. Group names are operator content, never
translated.

### R-28 — Release and generated artefacts

Changesets (minor): `@endora-commerce/contracts`, `@endora-commerce/admin-kit`,
`@endora-commerce/mod-document-templates`, `@endora-commerce/mod-quote-requests`,
`@endora-commerce/mod-orders`. Re-record the OpenAPI baseline for the changed admin and customer
replies. `composer:generate` for the two migrations and the two entities; `manifests:generate` +
`pnpm install --lockfile-only` only if a package body changes (none is expected: no package gains a
dependency).

---

## Implementation notes (MVP, T001–T041, 2026-10-20)

Smallest deviations taken where the plan met the code; later phases build on them.

- **N-1 — Customer bodies strip, not refuse, on create.** `createQuoteRequestSchema` is deliberately
  non-strict (its own comment: unknown keys are stripped, never refused) and the PATCH line schema is not
  strict either. So a customer `POST` carrying `groups` / `groupKey` creates an ungrouped quote (the keys
  are dropped), a customer `PATCH` carrying `groups` answers 400 (the body is strict), and a `groupKey`
  on a PATCH line is dropped. FR-025 / SC-007 ("no customer endpoint accepts a grouping") hold; R-13's
  "a sent key is refused" holds for the PATCH body only. Tests: `customer-routes.test.ts` § 159,
  `line-carry-over.test.ts` § feature 159.
- **N-2 — Refined admin bodies.** `adminPatchQuoteRequestSchema` and `adminCreateQuoteRequestSchema` are
  now `.superRefine`d (as `adminCreateOrderRequestSchema` already was); `.extend()` on them is no longer
  possible. Nothing in the tree extends them; the changeset says so.
- **N-3 — History texts live in the `core` bundle.** `RfqHistory` reads `useTranslation('core')` and
  `history-bundle-coverage.test.ts` requires `rfq.detail.history.change.<kind>` for every schema kind, so
  the five kinds are `rfq.detail.history.change.{group_added,group_removed,group_renamed,line_group,line_order}`
  plus `rfq.detail.history.ungrouped` in `_i18n/i18n/{en,pl}.json` — not `history.change.groupAdded` in the
  `quote_requests` bundle as `contracts/ui.md` §4 lists. The editor's labels are in the `quote_requests`
  bundle as planned (`lineGroups.*`).
- **N-4 — Editor details.** `LineGroupsEditor` renders its own *Move group up/down* icon buttons with
  per-group accessible names instead of `TouchReorderButtons`, whose labels are fixed core strings and
  would give every group the same name. `useGroupedReorder` also announces a group's lift, drop and
  cancel (`groupGrabbed`, `groupDropped`, `groupCancelled`). The editor gained `layout="table"` (one
  table, a row group per section, `renderLine` returning cells): the create screen's lines are table rows
  and its tests find a line by `closest('tr')`; the order create screen (US5) can use the same. In
  `readOnly` empty groups are not shown (D2).
- **N-5 — Admin Overview keeps its table.** The *Overview* tab shows groups as heading rows
  (`<th scope="colgroup">`) and summary rows inside its existing table rather than through the read-only
  editor, so the table's columns and its totals footer stay as they are.
- **N-6 — Read port and positions early.** `quoteRequestReadPort.listItems` already answers `position` and
  `group` (T057's subject) because the ordering test reads them; T056 still owes its own test. New orders
  already store the basket order as `position` (part of I-O3, T059); customer create and resubmission
  store the request's order as positions; revision snapshots read the quote's groups inside
  `RfqRevisionService.record` (no new input on the record call).
- **N-7 — PDF data groundwork.** `QuoteDocumentDataBuilder.build` already takes `groups`, arranges the
  lines and emits `groups` and each line's `groupId` / `position`; the sample carries `groups: []` and
  positions. US3 adds sections, the sample's two groups and the facility side.
- **N-8 — Summaries.** Admin *Modify* totals a section from the typed agreed prices, *Overview* from the
  stored agreed prices (the screen's own rule); the discount shows only where every line has a reference
  and the reference total exceeds the net. The create screen shows no VAT, so its section summary is the
  item count and net.
- **N-9 — A test that imported the module's sources.** `backend/test/integration/quote_requests/expiry-worker.test.ts`
  built `RfqExpiryWorker` from `src/`, which registers a second `QuoteRequest` entity class beside the
  composed package's; with `QuoteRequestItemGroup` transitively scoped through that class name the ORM
  refuses to boot. The test now builds the worker from the composed module's class and dependencies. A
  booting test must not import `quote_requests`' or `orders`' entity-carrying sources by value.
- **N-10 — OpenAPI baseline.** `backend/test/fixtures/openapi-baseline.json` records no request or response
  bodies for these routes, so nothing moved; `openapi-baseline.test.ts` passes unchanged (T071 has nothing
  to re-record for the MVP's surface).

## Implementation notes (US3, T042–T053, 2026-10-20)

- **N-11 — The facility's PDF texts live in `CT`.** The default *Other items* heading and the plural item
  counts are `documentSectionTexts(language)` in `CT/document-templates.ts`, beside `formatDocumentValue`,
  rather than in a text map under `DT/src/backend`: the editor canvas (`src/admin`, a separate compile that
  cannot import backend files) must print what the PDF prints (153 FR-036). English and Polish ship; any
  other language reads English; the form is chosen with `Intl.PluralRules`.
- **N-12 — An ungrouped quote answers one section.** `quoteLineSections` returns a single `ungrouped`
  section over every line for a quote with no group (and `[]` only for a quote with no line), so the
  partition check holds and nothing is logged on every ungrouped export; the table prints flat because no
  section is a group.
- **N-13 — Partition check, twice.** `isValidSectionPartition` also refuses an empty section, a duplicate
  key and an `ungrouped` section that is not last. The renderer checks once per collection per render and
  logs once (`documentType`, `collection`); the table re-checks silently as a guard, and route 2 answers
  `sampleSections: []` for a bad or throwing sample. A stored `grouping` with an unknown `by` reads as
  *Document's groups* at render (tolerant, as every prop) and is refused at save.
- **N-14 — Editor choices.** *By field* writes 153's shape without `by`, so a template stays readable by the
  pre-feature renderer, and pre-selects the catalogue's first field (the stored shape requires one).
  *Document's groups* writes `null`; touching *Other items heading* or *Show item count* writes
  `{ by: 'sections', … }`. The "This document type has no groups." hint shows when the served
  `sampleSections` is empty — route 2 carries no separate "declares sections" flag. The bundle key
  `itemsTable.grouping.none` is replaced by `itemsTable.grouping.mode.none`.
- **N-15 — Subtotal rows.** A section's subtotal rows are right-aligned and not bold (contract §3: "not
  emphasised"); 153's field-grouping subtotal row keeps its bold.
- **N-16 — How SC-004 is proven.** `FLAT_153` at the end of `DT/src/backend/rendering/items-table.test.ts`
  was recorded once from the renderer as 153 left it (four prop sets: bare, styled, detail row + totals, by
  field); the test compares JSON, since the table `layout` functions do not serialise (their code is
  unchanged). It is a literal in the test rather than a JSON file beside it because any non-TypeScript file
  under a module's `src/` is a runtime asset the package must ship (`package-runtime-assets.test.ts`). `BT/contract/quote_requests/pdf-export.test.ts` reads the definition of a real export through
  a spy on the `documentRenderer` singleton's `buildDefinition` (the render port resolves to it); pdfmake
  fills `colSpan` placeholder cells in place, so they read as empty there.
- **N-17 — The sample keeps five lines.** Two groups (three lines and one) and one ungrouped line, so 153's
  sample assertions (five priced lines, two discounted, one packed, one with a note) hold unchanged.

## Implementation notes (orders, T054–T067, 2026-10-20)

- **N-18 — Exact matches are claimed before any fallback.** `carryQuoteGrouping`
  (`OR/src/backend/domain/quote-line-groups.ts`) runs the contract's two matching rules as two passes
  over the basket — every order line's product + variant + agreed-price match first, then product +
  variant for the rest — rather than both rules per line. Per line, an earlier line whose price moved
  could take, by fallback, the quote line a later line matches exactly, and both would land in the wrong
  groups. Same result whenever per-line matching was right. Ungrouped quote lines rank by the quote's
  display order; unmatched lines follow in basket order. A record set carrying neither `group` nor
  `position` (an old port stub) yields the basket layout.
- **N-19 — The admin preview names each line's tax rate.** FR-060 asks for VAT and gross per group on
  the create screen, and `adminOrderPreviewLineSchema` carried only a net `lineTotal`. It gains an
  optional `taxRate` (`CT/orders.ts`, the preview route resolves it per product tax class from the
  authority `summary.taxTotal` uses); the screen sums a group's VAT as Σ net × rate. Additive; a
  separate changeset (`.changeset/159-contracts-order-preview-tax-rate.md`).
- **N-20 — `group_conflict` shape and language.** *(Superseded by N-31: the refusal, its
  `productDisplayNames` helper and the `lineGroups.conflict` text are gone.)* The 422 carried `details: [{ path, code:
  'group_conflict', productId, issue }]` — `issue` because `HttpError`'s array details are
  `{ path, issue }`. Its message names the product (`OrderService.productDisplayNames`, the request's
  language) but stays English: the envelope never translates a `VALIDATION_FAILED` message. The admin
  screen therefore shows its own translated sentence on the line (`orders` bundle
  `lineGroups.conflict`) beside the server's message in the page alert.
- **N-21 — Where the grouping is audited.** `stateAfter.groups` is added to the existing
  `order.place_on_behalf` entry, which `placeOrder` writes only for an impersonated placement — the
  admin creation and an administrator checking out on a buyer's behalf. A buyer's own checkout of a
  grouped quote stays unaudited, as R-22 says.
- **N-22 — Placement writes groups before lines.** `order_items.group_id` references
  `order_item_groups` with no ORM relation, so the groups are created and flushed before the order's
  lines are created (the lines are persisted on `create`). The layout is keyed by basket index.
- **N-23 — Admin order screen keeps its table.** Like N-5, `OrderDetail` shows the groups as row groups
  (`<tbody aria-label>`, a `<th scope="colgroup">` heading, a summary row) inside its existing items
  table, so the columns and the totals footer stay. The ungrouped heading is *Other items* (spec US6),
  the editor's section on the create screen is *Ungrouped* (as on quotes). A placed order's summary
  takes gross as the sum of the stored `lineTotal`s (gross) and VAT as gross − net, so it adds up the
  rows above it; the create screen, which has no stored gross, computes VAT from the rates (N-19). The
  same rule is the storefront's `orderSectionTotals`.
- **N-24 — Create screen details.** *(The first two sentences are superseded by N-34: lines are keyed
  per line.)* Lines are keyed by product (the screen offers a product once), so
  a UI-built request never conflicts; the 422 mapping exists for the server's answer. The preview
  request is keyed on product and quantity only, so moving a line between groups does not re-price. A
  group's *Add product* opens the browser for that group, as on the quote create screen. Every group
  must be named before *Create* enables.
- **N-25 — Storefront.** The order detail's rows moved into `SF/components/orders/OrderItemRows.tsx`
  (so the test renders the page's real markup); `GroupedLineRows` gained `orderSectionTotals` and an
  optional `moneyLocale` — the order page formats money in the page locale, the quote page in the
  currency's own, and each summary follows its page.
- **N-26 — T056 green on arrival.** `listItems` already answered `group` and `position` (N-6); the
  read-port test was added and passed without a red phase.

**Checkpoint**: quickstart §4–§6 are covered by `place-order-quote-groups.test.ts`,
`admin-create-groups.test.ts` and the admin/storefront tests above; not walked by hand (T074).

## Implementation notes (polish, T068–T074, 2026-10-20)

- **N-27 — Off-state sweep (T069).** `BT/integration/quote_requests/off-state.test.ts` § feature 159 adds
  the cases R-23 left without a test of their own: with `document_templates` deactivated the quote PDF
  answers `503 MODULE_DISABLED` while an operator still regroups the quote and both quote replies carry
  the groups; with `quote_requests` off on **either** axis, an order placed from a grouped quote keeps
  answering the same `itemGroups` on the admin and the customer read (the control: the quote itself is
  refused meanwhile). The facility's four-route refusal stays in `BT/contract/quote_requests/pdf-export.test.ts`
  and placement while `quote_requests` is off in `place-order-quote-groups.test.ts` (FR-083); the sweep
  does not repeat them. `check:off-state-coverage` was already green (no new switchable module or edge).
- **N-28 — A section heading can close a page (T074).** `dontBreakRows` keeps each row whole, but pdfmake
  keeps no row with its neighbour, so a group's heading row can be the last row on a page with the group's
  first line opening the next. The two remedies were weighed and not taken: the document-level
  `pageBreakBefore` hook re-lays the whole document per node (the reason 153 gave for a line and its detail
  row, which have the same limitation), and folding a heading and its first line into one unbreakable row
  needs a nested table inside a spanned cell, which breaks the column grid, striping and borders. It is
  stated as a limitation on the Document templates page and in the renderer's comment; the contract's
  SHOULD (`contracts/document-sections.md` §3) is not met. **Owner ruling (2026-10-21): accepted as a known
  limitation**; revisit the renderer only if orphaned headings turn out to be a frequent complaint.
- **N-29 — Nothing to re-record (T071).** `openapi-baseline.json` still records no request or response
  body for any route this feature touched (N-10), including route 2's `sampleSections` and the admin
  preview's `taxRate`; `openapi-baseline.test.ts` passes unchanged. `composer:check` and `manifests:check`
  report no drift, so no `manifests:generate` or lockfile change.
- **N-30 — Changesets (T070).** The six `.changeset/159-*.md` files cover every changed package
  (`contracts`, `admin-kit`, `mod-document-templates`, `mod-quote-requests`, `mod-orders`, `mod-i18n`);
  `carts` did not change *(until D6: `159-carts-keep-repeated-lines.md` covers `mod-carts`, N-31)*. `159-document-sections.md` states the `grouping: null` meaning change. No new
  changeset was written for the documentation pages: they ship in the three module packages those
  changesets already bump.

## One product on several lines (owner decision D6, 2026-10-21)

The owner asked that one product and variant may sit on several lines of a document, in different
groups — *5 pcs of X in group Y and 3 pcs of X in group Z* — through creation, modification, the
customer's view, the PDF, the conversion and admin order creation. A survey of the chain found the
storage, the request schemas, the quote `modify` write, `planLineGrouping`, the PDF and the minimums
(feature 155 sums a product across its lines by design) already line-based. What was not:

- **N-31 — Orders: the basket, the admin layout and the carry.** (a) The admin creation seeded the
  basket through `CartWritePort.addItems(…, { replaceExisting: true })`, whose write merges a repeated
  `(product, variant, unit)` into the first line — so it refused one product in two groups
  (`group_conflict`, N-20). `addItems` gains `keepRepeatedLines` (with `replaceExisting` only): every
  line is written as its own, priced at its own quantity (`#assertBatchOrderable` prices each at its
  own quantity too), created in request order a millisecond apart; the minimums are judged on the
  batch total as before. The admin creation always seeds that way — grouped or not, the request is the
  order — and `group_conflict` is removed. (b) **Pricing (owner default):** each line of a split
  product is priced at its own quantity, as separate basket lines already are; a quote's lines carry
  their own agreed prices anyway. (c) The basket order was not deterministic: seeded lines shared a
  creation time and fell back to random ids, and placement's own read of the basket
  (`CartPlacementApplyService.readActiveForPlacement`) carried no `orderBy` at all. The seed
  (`replaceItemsForCustomer`) now creates its lines a millisecond apart in seed order and the
  placement read orders by `(createdAt, id)` like `CartReadService`. (d) `adminLayout` pairs each
  basket line with the request line at its own index (product, variant and quantity agreeing), then
  — as a safety net — by product, variant and quantity, then product and variant;
  `OrderLineGroupingInput.lines` is the request's line list. (e) `carryQuoteGrouping` matched by
  product, variant and price, then product and variant, ignoring quantity, so X×5 in Y and X×3 in Z at
  one price landed in whichever order the basket listed them. It now passes, each over every line
  first: product + variant + agreed quantity + price; + price; + quantity; product + variant.
  Alternatives rejected: *a basket line id carried into placement* — the basket is `carts`' and
  placement reads it whole; *keeping `group_conflict` and asking for two variants* — not what was
  asked.
- **N-32 — Quotes: pairing and naming a line among several of its product.** `pairLines` (feature
  146) pairs an incoming line with a stored row by id, then by product/variant/unit passes, then
  position. Without ids — a customer's draft edit, an admin API client, the revision comparisons —
  removing X×5 from *[X×5 in Y, X×3 in Z]* paired the remaining X×3 with the Y row. Each pass now
  prefers, among the rows it accepts, one of the line's own group and quantity, then group, then
  quantity, before stored order (each preference over every line first). The customer comparison
  (`RfqRevisionService.diffRevisions`) mapped revision lines **by product**, so two lines of one
  product collapsed into one; it now pairs one to one through the history diff's rule
  (`snapshot-pairing.ts`, shared by both). An entry about a product, variant and packaging unit on
  more than one line of either revision carries `groupName` (`null` = ungrouped) — the comparison
  entry and the History line reference alike — so *X: 5 → 3* says which X line. The group's name is
  one the customer was shown on that revision, so FR-023's rule holds.
- **N-33 — *Split line*.** The *Modify* editor allowed a product twice but offered no way to make the
  second line short of adding a blank one and re-choosing the product, which loses the customer's
  proposal and the packaging unit (a new line has neither — `modify` never prices). A per-line *Split
  line* action (icon button beside *Move to group*, EN *Split line* / PL *Podziel pozycję*) opens the
  kit's new `SplitLineDialog` — quantity to move (1 … quantity − 1; the editor enforces no packaging
  step, so the step is 1), the new line's group (default its own) — and inserts the new line after the
  original or at the end of the target group. It is sent with `splitFromId`, an optional admin PATCH
  line key naming the stored line it came from; the server copies that row's variant, packaging unit,
  proposal, note, currency and reference onto it (ignored when it names no line of this quote). The
  admin order creation offers the same action. Not on *Create quote request*: a new quote's lines have
  no proposal to keep, and adding the product again does the same.
- **N-34 — The create screens are keyed per line.** *Create quote request* and *Create order* keyed
  their rows by product (row key, de-duplicating `appendLines`, quantity/price/remove handlers, the
  *already added* greying in the browser and the quick search, DOM ids). Rows now carry their own key;
  a product already a line is offered again; the quote screen's price-prefill queue is keyed by line,
  so two lines of one product each ask at their own quantity; the order screen reads each line's
  preview answer at its own index, and only while it is still about the line's product and quantity
  (the preview answers one line per request line, in order). The de-duplication used to absorb two
  browser confirms landing in one tick; a confirm is now applied once per opening of the browser.
- **N-35 — What stays as it was.** The storefront's customer draft basket (`storefront/lib/rfqDraft.ts`)
  still merges a product added twice: customers do not group lines, and a second line of one product
  would mean nothing to them. The order minimums stay per product across lines (feature 155 D1). The
  quote PDF and every read-only screen were already line-based.

