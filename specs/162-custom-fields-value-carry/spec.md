# Feature Specification: Custom-field value carry-over between Quote Requests, Orders and Sales Opportunities

**Feature Branch**: `feat/162-custom-fields-value-carry`
**Created**: 2026-10-16
**Status**: Implemented — accepted by the product owner with conditions (2026-10-21); in the Phase 10 gate, pull request not yet opened
**Issues**: #287
**Input**: Issue #287 — *Custom Field value propagation across entities (Quote Request / Order / Lead).* When
one entity is created from another (a Quote Request becomes an Order; a Sales Opportunity leads to a Quote
Request or an Order), values of custom fields with the same key are not transferred. Add a per-definition
option ("Transfer value to Order", …) so that a value of `order_source` on a Quote Request is copied to the
`order_source` field of the Order created from it; the same for Order ↔ Sales Opportunity and Quote Request
↔ Sales Opportunity.

**Dependency.** This feature builds on `specs/157-custom-fields-list-filters/` (issue #286), which ships first and
delivers the ability to edit an existing definition's options on `/custom-fields`. 162 adds the carry-over
options to that same editing surface and does not redesign it. 162 MUST NOT be planned against the
earlier editor (audience-only editing); if the filters feature slips, the plan states how the carry options are reached.

## Current state (origin/master fda284a45)

Paths are relative to the repository root.

### Definitions

- A definition belongs to **exactly one** entity type (`packages/contracts/src/custom-fields.ts:15-28`) and
  is unique on `(entity_type, key)`
  (`packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts:25`). **Definitions
  are not shared across entity types**: an `order_source` field on Quote Requests and one on Orders are two
  unrelated rows that may differ in value type, options, `required` and audience.
- Value types: `text`, `number`, `boolean`, `date`, `select`, `multiselect` (`custom-fields.ts:32-39`).
  Changing `valueType` is refused while values exist
  (`packages/modules/custom_fields/src/backend/services/custom-field-definition.service.ts:189-190`); options
  can be deleted (`:234`) and definitions can be deleted (`:204`).
- Each definition carries `audience` (`customer` | `internal`, default `internal`) — `customer` values reach
  buyer-facing and API-key replies, `internal` values never leave the admin API (`custom-fields.ts:42-55`).
- `opportunity` is owned by the toggleable `crm` module
  (`packages/modules/custom_fields/src/backend/services/custom-field-registry.ts:66`); `quote_request`
  declares no owner module (`:55`) although `quote_requests` is toggleable
  (its `activation` is at `packages/modules/quote_requests/src/manifest.ts:232`).
  `specs/157-custom-fields-list-filters/` (FR-005a) adds `ownerModuleId: 'quote_requests'`, so from that feature on Quote Request definitions are not served while
  `quote_requests` is off; 162 relies on that.
- An option's stored value cannot be changed, and an option held by any record cannot be removed
  (`custom-field-definition.service.ts:222-256`); so an option can disappear from a target only while no
  target record holds it.

### Where values live and how they are written

- Values are a JSON bag on the host row: `Order.customFieldValues`
  (`packages/modules/orders/src/backend/entities/order.entity.ts:238`), `QuoteRequest.customFieldValues`
  (`packages/modules/quote_requests/src/backend/entities/quote-request.entity.ts:175`),
  `CrmOpportunity.customFieldValues`
  (`packages/modules/crm/src/backend/entities/crm-opportunity.entity.ts:125`). Every write is validated
  through `CustomFieldValuePort.validateAndMerge`; a key whose definition is gone stays as a dormant value.
- **No create path for an Order or a Quote Request accepts custom-field values.** Orders take them only after
  placement, through `PATCH /api/v1/admin/orders/:id/custom-fields`, a Command Bus write
  (`packages/modules/orders/src/backend/routes.ts:215`); Quote Requests only through the admin patch
  (`packages/contracts/src/quote-requests.ts:532`). An Opportunity accepts them on create
  (`packages/contracts/src/crm.ts:455`).

### Conversions

- **There is no Lead entity.** `crm` has one record type, the Sales Opportunity; #287's "Lead" means it.
- **Quote Request → Order is indirect.** The buyer's `convert-to-order`
  (`packages/modules/quote_requests/src/backend/services/rfq-service.ts:886-1010`) seeds the buyer's cart at
  the agreed prices and stamps it with `sourceQuoteRequestId` (`:1001`). The Order is created at checkout by
  `orders` (`packages/modules/orders/src/backend/services/order-service.ts:1777-1792`), which re-reads and
  vouches for the source Quote Request (`:1318-1336`). Placement is not a Command Bus write
  (`:1344-1364`); an audit entry is written only for placement on behalf of a customer (`:2217-2221`). The
  read port it uses already returns the Quote Request's `customFieldValues`
  (`packages/modules/quote_requests/src/backend/services/quote-request-read-port.ts:110`).
- **Order / Quote Request → Opportunity** is automatic and asynchronous, after commit
  (`packages/modules/crm/src/backend/services/opportunity-auto-create-service.ts:87-125`, `:136`, `:178`): the
  document joins the Opportunity it came from, joins its source Quote Request's Opportunity, or — when
  `crm.auto_create_from_orders` / `crm.auto_create_from_quote_requests` is on — gets a new one through
  `createForDocument` (`packages/modules/crm/src/backend/services/opportunity-service.ts:315-364`), which
  passes no custom-field values.
- **Opportunity → Order / Quote Request** is a link, not a copy
  (`packages/modules/crm/src/admin/components/CreateFromOpportunity.tsx:9-40`): CRM opens the owner module's
  create screen with an `origin`; the document is created without CRM data and linked afterwards when the
  origin holds (`packages/modules/crm/src/backend/services/opportunity-origin-link-service.ts`). The origin
  holds when the Opportunity exists, belongs to the document's Organization, and the creating
  administrator can reach that Organization.
- **Manual links.** An operator can also link an existing Order or Quote Request to an Opportunity on the
  Opportunity's *Links* tab (`crm.opportunity.link_add` with a manual link source). That is neither a
  creation nor an automatic join; it carries nothing (FR-008, owner ruling 2026-10-19).
- **Order → Quote Request exists** as the buyer's *clone to quote*
  (`packages/modules/orders/src/backend/services/order-clone-to-quote-service.ts`). It is **out of scope**
  for carry-over (FR-001, owner ruling 2026-10-19).
- Every pair stays within one Organization.

### Record history

- Quote Requests have an event history (`QuoteRequestEvent`,
  `packages/modules/quote_requests/src/backend/entities/quote-request-event.entity.ts:29`, shown by
  `packages/modules/quote_requests/src/admin/pages/RfqHistory.tsx`).
- An Opportunity's *Change history* is built from the **audit log** — the audit entries of its
  `crm.opportunity.*` Commands — by
  `packages/modules/crm/src/backend/services/opportunity-history-service.ts` and shown by
  `packages/modules/crm/src/admin/components/OpportunityHistory.tsx`.
  (`packages/modules/crm/src/backend/entities/crm-opportunity-event.entity.ts` is unrelated: it holds
  calendar Events such as meetings and reminders.)
- **Orders have no per-order history.** The order detail has comments
  (`packages/modules/orders/src/backend/entities/order-comment.entity.ts` — authored by an admin or the
  customer, customer-visible by default, optionally notifying the customer, allowed only while the order is
  non-terminal) and status transitions. Both author columns are nullable in the entity, but the comment
  service and the order detail know only admin- and customer-authored comments; there is no system note.
  This feature records an Order's carry skip as an internal system note in those comments (FR-010a).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Quote Request's value follows it into the Order (Priority: P1)

A Quote Request field `order_source` has "Carry to Order" on, and a compatible Order field with the key
`order_source` exists. A buyer converts the approved request and places the Order at checkout; the Order's
`order_source` holds the request's value.

**Why this priority**: The worked example of #287.

**Independent Test**: Set `order_source = "Trade fair"` on an approved request, convert, place the order,
open it in the admin and see the value.

**Acceptance Scenarios**:

1. **Given** "Carry to Order" on and a compatible same-key Order definition, **When** an Order is placed from
   a cart seeded by that Quote Request, **Then** the Order is created holding the request's value.
2. **Given** "Carry to Order" off, **When** the Order is placed, **Then** the Order has no value for that key
   (unchanged behaviour).
3. **Given** the cart's source Quote Request is not vouched for at placement (already used by another order,
   different Organization, lines changed — today's rules), **When** the Order is placed, **Then** nothing is
   carried.
4. **Given** the Order definition became incompatible after configuration (an option removed, the definition
   deleted), **When** the Order is placed, **Then** placement succeeds, the value is not carried, and the
   Order's comments hold one internal system note naming each skipped key and its reason — not visible to
   the buyer, with no notification sent.
5. **Given** the value was carried, **When** an administrator reviews how the Order came to hold it,
   **Then** it is part of the Order's creation by whoever placed it, not a separate later edit.

---

### User Story 2 - Values flow into the Sales Opportunity created or joined for a document (Priority: P2)

With "Carry to Sales Opportunity" on for a Quote Request or Order field, the Opportunity that CRM creates for,
or joins with, that document receives the value when it has none for the key.

**Why this priority**: Named in #287; creation depends on a CRM auto-create setting, so fewer installations
exercise it.

**Independent Test**: Turn on `crm.auto_create_from_quote_requests`, submit a request with a carried value,
open the created Opportunity.

**Acceptance Scenarios**:

1. **Given** auto-creation is on and the source field carries to Opportunity, **When** CRM creates an
   Opportunity for the document, **Then** the Opportunity holds the value.
2. **Given** an Order joins an existing Opportunity that already has a value for the key, **When** the join
   happens, **Then** the Opportunity's value is kept.
3. **Given** an Order joins an existing Opportunity that has no value for the key, **When** the join happens,
   **Then** the Opportunity receives the Order's value.
4. **Given** `crm` is off, **When** a document is placed or submitted, **Then** nothing is carried and
   nothing fails; turning `crm` back on does not replay past carries.
5. **Given** the value was not carried because the target became incompatible, **When** an administrator
   opens the Opportunity's history, **Then** the creation or join entry names each skipped key and its
   reason.
6. **Given** a Quote Request field carries to Sales Opportunity and its target became incompatible, **When**
   CRM creates or joins the Opportunity, **Then** the skip entry is on the **Opportunity's** history (the
   target), not on the Quote Request's.

---

### User Story 3 - Values flow from a Sales Opportunity into the Order or Quote Request created from it (Priority: P2)

With "Carry to Order" / "Carry to Quote Request" on for an Opportunity field, an Order or Quote Request an
operator creates from the Opportunity ("Create order" / "Create quote request") receives the value once the
link is established.

**Why this priority**: Completes the trio of #287; operator-driven and less frequent than checkout.

**Independent Test**: Set a value on an Opportunity, create a Quote Request from it, open the request and see
the value.

**Acceptance Scenarios**:

1. **Given** the Opportunity field carries to Quote Request and a compatible same-key Quote Request
   definition exists, **When** an operator creates a Quote Request from the Opportunity and the link is
   established, **Then** the Quote Request holds the Opportunity's value.
2. **Given** the origin does not hold (different Organization, Opportunity deleted, the creating
   administrator cannot reach the Opportunity's Organization), **When** the document is created, **Then**
   nothing is carried — the rule that decides the link decides the carry.
3. **Given** the new document already holds a value for the key, **When** the carry runs, **Then** the
   document's value is kept.
4. **Given** a value was carried from the Opportunity, **When** an administrator reviews the document's
   audit trail, **Then** the document's creation is attributed to the operator who created it and the
   carried values are attributed to the **system** (owner ruling 2026-10-19).
5. **Given** an existing Order or Quote Request with no value for the key, **When** an operator links it to
   the Opportunity on the Opportunity's *Links* tab, **Then** nothing is carried in either direction and no
   skip entry is recorded (owner ruling 2026-10-19).

---

### User Story 4 - Operator sets the carry options on the definition editor (Priority: P1)

On `/custom-fields`, using the definition editing surface delivered by `specs/157-custom-fields-list-filters/`, an operator with
`custom_fields:write` sets "Carry value to …" on a Quote Request, Order or Opportunity definition for each
other entity type of that trio. Turning an option on is refused unless the target entity type has a
compatible definition with the same key.

**Why this priority**: Without it US1–US3 cannot be configured.

**Independent Test**: Try to turn on "Carry to Order" on a Quote Request field with no `order_source` Order
field — refused with a reason; create the Order field, retry — accepted.

**Acceptance Scenarios**:

1. **Given** an existing Order definition, **When** the operator edits it, **Then** they can toggle "Carry
   to Sales Opportunity" without recreating the field, and the change is audited.
2. **Given** no same-key definition on the target type, **When** the operator turns "Carry to X" on,
   **Then** the save is refused with a message naming the missing field on X.
3. **Given** a same-key target definition with a different value type, or a select/multiselect target that
   lacks any of the source's option values, **When** the operator turns "Carry to X" on, **Then** the save is
   refused with a message naming the incompatibility (the type pair, or the missing option values).
3a. **Given** a `select` source and a `multiselect` target, or a non-text source and a `text` target, **When**
   the operator turns "Carry to X" on, **Then** the save is refused as a value-type mismatch (no widening).
3b. **Given** an `internal` source definition and a `customer` target definition, **When** the operator turns
   "Carry to X" on, **Then** the save is refused with a message saying the target is customer-visible and
   the source is internal; the operator must deliberately change one field's audience first.
4. **Given** a Category, Product, Customer or Organization definition, **When** the editor is shown,
   **Then** no carry option is offered; an Order definition is never offered "Carry to Quote Request".
5. **Given** the definitions table, **When** it lists fields, **Then** it shows where each carries to, in
   English and Polish.
6. **Given** a target definition into which one or more enabled carries point, **When** the operator edits
   it in a way that breaks compatibility (removes an option a source has, changes its value type, makes it
   `customer` while a source is `internal`) or deletes it, **Then** the editor warns before saving or
   deleting, naming each source field (entity type and key) that carries into it; the operator may proceed.
7. **Given** a carry made incompatible by such a change, **When** the definitions table lists the source
   field, **Then** that carry is marked "incompatible" (with the reason on hover or in the row), and the
   mark clears once the target is compatible again or the carry option is turned off.
8. **Given** a source definition with an enabled carry, **When** the operator changes it so that it no longer
   matches its target (adds an option the target lacks, changes its value type, makes it `internal` while
   the target is `customer`), **Then** the editor warns the same way, naming the target, and after saving the
   carry is marked "incompatible".

### Edge Cases

- **Target already has a value.** The target's value is kept; only an empty target is filled (owner
  decision).
- **Target drifts after configuration.** An option removed from a target `select` (possible only while no
  target record holds it), the target definition deleted, its value type changed while it held no values,
  or its audience made `customer` under an `internal` source: the change is allowed with a warning, the
  carry option stays on and is marked "incompatible", and at conversion the value is skipped and the skip
  recorded (FR-010, FR-019).
- **Source drifts after configuration.** The same applies symmetrically when the source changes (an option
  added that the target lacks, value type changed, audience made `internal` under a `customer` target).
- **Compatibility is re-checked per value at conversion.** A select source whose options all exist on the
  target at conversion carries even if the definitions table showed "incompatible" earlier and the operator
  has since fixed it; conversely a carry is skipped if it is incompatible at conversion, whatever the table
  showed.
- **Audience mismatch.** Source `internal`, target `customer`: refused at configuration (FR-011); if it
  arises later by audience drift, the value is skipped at conversion — an `internal` value never becomes
  customer-visible through carry-over.
- **Order system note and terminal orders.** Order comments are allowed only while the order is
  non-terminal; a just-created Order is non-terminal, so the skip note written with its placement, or with
  its link to the Opportunity it was created from, is always allowed. The note is never customer-visible, never notifies, and is not editable or deletable as a
  customer comment.
- **Other required target fields.** An unrelated `required` target field that is empty never causes a
  carried value to be skipped and never makes creation fail; the carried key is judged on its own
  definition only.
- **Required target field.** A `required` target definition and no source value: creation behaves exactly as
  today; this feature introduces no new failure.
- **Dormant source value.** A source key whose definition was deleted is not carried (there is no option to
  read).
- **Empty source value.** Not carried; never clears a target value.
- **Concurrent edits.** A Quote Request value edited after the cart was seeded but before checkout: the value
  at placement time is carried (the Order reads the request at placement).
- **Several documents on one Opportunity.** Order 1 and Order 2 join one Opportunity with different values:
  the first value fills the empty field; later documents do not overwrite it.
- **Loops.** Opportunity → Quote Request → Order → same Opportunity: a carry into a record that already holds
  a value is a no-op, so no cycle rewrites values.
- **Toggled-off owner module.** Options naming `opportunity` or `quote_request` as source or target are hidden
  and inert while `crm` / `quote_requests` is off, retained, and effective again when the module returns.

## Requirements *(mandatory)*

### Functional Requirements

**Carry options (US4)**

- **FR-001**: A definition of type `quote_request`, `order` or `opportunity` MUST carry an operator-set
  "carry value to <type>" option, default off, for each target in these pairs: Quote Request → Order, Quote
  Request → Opportunity, Order → Opportunity, Opportunity → Quote Request, Opportunity → Order. Order → Quote
  Request MUST NOT be offered: the conversion exists (the buyer's *clone to quote*) but is out of scope for
  carry-over (owner ruling 2026-10-19), so a clone-to-quote Quote Request receives no carried value.
- **FR-002**: The options MUST be settable when creating a definition and editable on an existing definition
  from `/custom-fields` through the editing surface delivered by `specs/157-custom-fields-list-filters/`, by a
  holder of `custom_fields:write`; each change MUST be audited as a definition update (Command Bus).
  Each carry checkbox MUST be explained: in the definition editor by one help line per checkbox, in the
  narrow create-form row by one shared help line for the group (owner ruling 2026-10-21, V2). The help
  line says that when a record of the named type is created from a record with this field, the new
  record's empty field with the same key receives this field's value (owner ruling 2026-10-21, P4).
- **FR-003**: Turning a "carry to X" option on MUST be refused unless a definition with the same key exists
  on X and is compatible with the source. Compatible means: the **same value type**, and for `select` /
  `multiselect` every option value of the source exists as an option value on the target (labels may
  differ; the target may have extra options). No widening is allowed: `select` → `multiselect` and any type
  → `text` are refused. The refusal MUST name the reason: missing target, value-type mismatch (naming both
  types), missing option values (naming them), or audience (FR-011).
- **FR-004**: Turning an option on or off MUST NOT change any stored value on any record and MUST NOT
  back-fill records created earlier.
- **FR-005**: While a toggleable owner module is not present — `crm` for `opportunity`, `quote_requests` for
  `quote_request` — options naming its entity type as source or target MUST NOT be offered and MUST have no
  effect; they MUST be retained and take effect again when the module returns.
- **FR-006**: The definitions table MUST show, per definition, the entity types it carries to.

**Carry-over (US1–US3)**

- **FR-007**: When a record of type T is created from, or joins, a record of type S in one of the FR-001
  pairs, each key whose S definition has "carry to T" on, for which a same-key T definition exists, and for
  which S holds a non-empty value, MUST be copied into the T record — subject to FR-009 and FR-010.
- **FR-008**: Carry-over happens **once**, when the relationship is established, and only through these
  events: Order placement with a vouched source Quote Request; CRM's automatic Opportunity creation for a
  document; an Order joining the Opportunity of its source Quote Request; a document linking to the
  Opportunity it was created from (origin link). An operator manually linking an existing document on the
  Opportunity's *Links* tab is **not** one of them and MUST carry nothing (owner ruling 2026-10-19). Later
  edits on either side are not synchronised.
- **FR-009**: If the T record already holds a value for the key, that value MUST be kept; only an empty
  target is filled.
- **FR-010**: A value that does not satisfy the T definition at the moment of carrying (missing definition,
  type, option, range) or whose carry has become audience-incompatible (`internal` source, `customer` target)
  MUST be skipped; the creation or link MUST succeed; and the skips of one conversion MUST be recorded as
  **one** entry on the T record naming every skipped key once with its reason (owner ruling 2026-10-19) —
  in the history of a Quote Request or a Sales Opportunity, and for an Order as FR-010a states. On a Quote
  Request the entry MUST be admin-only: it is never shown to the buyer on any buyer-facing surface (owner
  ruling 2026-10-19). Carry-over MUST NEVER make a buyer's checkout or an operator's create fail.
  Each skipped key MUST keep the source field's label as it read when the value was skipped, so the
  entry names the field to any administrator who can see the record (owner ruling 2026-10-21, V3).
  Custom-field **values** stay hidden from a reader without `custom_fields:read`: a Sales Opportunity's
  history MUST leave them out of its entries for such a caller, while the skip lines stay (owner ruling
  2026-10-21, P2 = a).
- **FR-010a**: On an **Order**, a skip MUST be recorded as an internal system note in the Order's comments:
  not visible to the customer on any buyer-facing or API-key surface, sending no notification, attributed to
  the system rather than to an admin or the customer, and written together with the placement or link it
  belongs to (FR-013). The order comment model MUST admit such an author-less system note and the order detail MUST
  show it as a system note; how (a marker column, a kind, or another shape) is a plan decision. Existing
  admin- and customer-authored comments are unchanged.
- **FR-011**: Carry-over MUST NOT change any definition's audience; the T definition's audience governs who
  reads the carried value. Turning "carry to X" on MUST be refused when the source definition is `internal`
  and the target definition is `customer`, through the same refusal path as an incompatible type (FR-003).
  `customer` → `internal`, `internal` → `internal` and `customer` → `customer` are allowed. A Sales
  Opportunity is seen by administrators only, so an Opportunity field's audience changes nothing on the
  Opportunity itself; it decides only where the value may be carried — a `customer` Opportunity field may
  carry into a `customer` Order or Quote Request field (owner ruling 2026-10-21, P3 = a).
- **FR-012**: Carry-over MUST only happen between records of the same Organization; a pair whose
  Organizations differ carries nothing.
- **FR-013**: Values written by carry-over MUST be written with the creation or link they belong to and
  attributed — never through a separate unattributed write. The actor is: the buyer at checkout (Quote
  Request → Order); the system for CRM's automatic creation or join (Order / Quote Request → Opportunity);
  and the **system** for values carried from a Sales Opportunity into an Order or Quote Request created from
  it, written by an audited write of the document's owner module when the origin link is established
  (owner ruling 2026-10-19). In that last case the document's creation itself stays attributed to the
  operator who created it. A carry that fills a Quote Request's field MUST raise the request's `version`,
  so an edit sent with the version the create returned is refused with `409 VERSION_CONFLICT` and
  re-read; the carry MUST hold the receiving record's row from its read to its write, so it never
  overwrites a concurrent edit (owner ruling 2026-10-21, P1 = c). Where the creation itself is not audited today (buyer checkout), this feature
  adds no new audit trail for it, but MUST NOT write carried values through a separate unaudited path
  (Principle XIII).
- **FR-014**: A source or target whose owner module (`crm`, `quote_requests`) is not present MUST carry
  nothing and record nothing, and MUST NOT be replayed when it returns.
- **FR-015**: Modules read source values only through published ports (`orders`, `quote_requests` and `crm`
  never read each other's tables).

**Drift after configuration (US4)**

- **FR-019**: Changing or deleting a definition that is the target or the source of an enabled carry MUST be
  allowed. Before saving a change that makes the carry incompatible under FR-003 / FR-011, or before
  deleting such a definition, the editor MUST warn the operator, naming every counterpart field (entity type
  and key) of the affected carries. The carry options MUST stay as configured. The warning's proceed
  button MUST name the action — "Remove option anyway", "Delete field anyway", "Add option anyway",
  "Change audience anyway" — destructive-styled for removals and deletions (owner rulings 2026-10-21, V1
  and W1).
- **FR-020**: The definitions table MUST mark a source's carry "incompatible" while its target is missing or
  incompatible under FR-003 / FR-011, stating the reason, and MUST clear the mark once compatibility is
  restored or the option is turned off. A carry marked "incompatible" still runs at conversion under FR-010:
  each value is judged against the target as it is then.

**Cross-cutting**

- **FR-016**: Every new label, option name, refusal message, editor warning, "incompatible" mark, history
  entry, the Order system note and its "System" author label MUST exist in `en` and `pl`.
- **FR-017**: No new permission code: definitions keep `custom_fields:read` / `custom_fields:write`.
- **FR-018**: Documentation in `docs/` (en + pl) MUST describe the carry options, the pairs, the
  fill-empty rule, the compatibility rule, the configuration-time refusal, the audience rule, the drift
  warning and "incompatible" mark, and the skip-and-record rule including the Order system note.

### Key Entities

- **Custom-field definition** — gains up to two carry options; still one entity type per definition, still
  keyed `(entity type, key)`.
- **Carry pair** — (source type, target type, key): exists while the source option is on; derived, not stored
  as its own record.
- **Carry skip entry** — on the target record, one per conversion: every skipped key with its reason, and
  the source record reference. On a Quote Request, an admin-only entry in its event history; on an
  Opportunity, part of the creation or join audit entry its *Change history* shows; on an Order, an
  internal author-less system note in its comments (FR-010a).
- **Order comment** — gains the ability to be a system note: no admin or customer author, never
  customer-visible, never notifying.
- **Host records** — Order, Quote Request, Sales Opportunity; unchanged shape, gain values at creation or
  link.

## Success Criteria *(mandatory)*

- **SC-001**: In 100% of conversions covered by an enabled carry pair with a compatible, empty target, the
  target holds the source value immediately after creation or link.
- **SC-002**: Zero conversions fail because of carry-over (incompatible or deleted targets, `crm` off) across
  the acceptance suite.
- **SC-003**: Zero target values are overwritten by carry-over across the acceptance suite.
- **SC-004**: Every conversion that skips one or more carries produces exactly one history entry on the
  target, naming each skipped key exactly once; a conversion that skips nothing produces no skip entry.
- **SC-005**: No `internal` value reaches a buyer or API-key reply through carry-over — refused at
  configuration and skipped at conversion after audience drift — verified by test on each target type.
- **SC-006**: No Order carry-skip note reaches a buyer-facing or API-key reply, and none triggers a
  notification; no Quote Request carry-skip entry reaches the buyer's view of the request — verified by
  test.
- **SC-007**: Every change that makes an enabled carry incompatible shows the warning before saving, and the
  table marks the carry "incompatible" until it is fixed — verified by test.

## Assumptions

- **A-1**: "Lead" and "Deal" in #287 mean the Sales Opportunity of `crm`.
- **A-2**: Matching is by exact key; there is no key mapping (`source_a` → `target_b`).
- **A-3**: The option lives on the **source** definition ("carry to …"), as #287 describes.
- **A-4**: The admin create screens of Order and Quote Request do not gain a custom-field section; carried
  values are set server-side.
- **A-5**: The options are stored as generic definition capabilities (Principle XIV); storage form is a plan
  decision.
- **A-6**: CRM's automatic join of an existing Opportunity counts as establishing the relationship (FR-008),
  so it fills empty keys under FR-009. A manual link on the *Links* tab does not (owner ruling 2026-10-19).

## Out of Scope

- Two-way or continuous synchronisation after creation.
- Key mapping between differently named fields; sharing one definition across entity types.
- Back-filling records created before an option was turned on.
- Order → Quote Request (the buyer's *clone to quote*): the conversion exists but carries nothing (owner
  ruling 2026-10-19).
- Manually linking an existing Order or Quote Request to an Opportunity on its *Links* tab (owner ruling
  2026-10-19).
- Carrying values onto Invoices, Returns, Carts, Customers, Organizations or any other entity.
- Product attributes (`/catalog/attributes`) and categories.
- List filters (`specs/157-custom-fields-list-filters/`).

## Constitution constraints

- **I (modular architecture)** — values cross modules through published ports only (FR-015).
- **II (API-first)** — definition options and any port changes are defined in `packages/contracts/` first;
  changes are additive.
- **III (TDD)** — every FR traces to a test, including off-state tests for `crm` and `quote_requests`.
- **XI (tenant isolation)** — carry-over never crosses Organizations (FR-012).
- **XIII (Command Bus auditing)** — definition edits are audited Commands; carried values and the Order
  skip note are written inside the creation or link they belong to (FR-002, FR-010a, FR-013).
- **XIV (entity-agnostic extensibility)** — options are generic definition capabilities.
- **XVII (operator-toggleable modules)** — `crm` or `quote_requests` off ⇒ options and carries behave as if
  never installed, non-destructively (FR-005, FR-014).
- **VIII / i18n** — English in code and docs; `en` + `pl` for every user-facing string (FR-016).

## Clarifications

### Session 2026-10-16

- Q: Deliver issues #286 and #287 together or split? → A (product owner): Split. This feature covers #287 and
  builds on the definition editor delivered by `specs/157-custom-fields-list-filters/`, which ships first.
- Q: The target record already has a value for the key — what happens? → A (product owner): Keep the
  target's value; carry-over fills only an empty target.
- Q: The target definition is missing or incompatible — what happens? → A (product owner): Refuse at
  configuration: "carry to X" requires a field with the same key and a compatible type and options on X. At
  conversion, if the target has since become missing or incompatible, still skip and record an entry in the
  target's history.
- Q: What does a "compatible" target field mean when turning carry-over on? → A (product owner): Same value
  type, and for select/multiselect every source option value exists in the target. No widening (select →
  multiselect, any → text).
- Q: The source field is `internal` and the target is `customer` — allow, warn, or refuse? → A (product
  owner): Refuse at configuration, through the same refusal path as an incompatible type.
- Q: Where is "value not carried" recorded on an **Order**, which has no event history? → A (product owner):
  As an internal system note in the order's comments, never visible to the customer, with no notification.
  The comment model needs an author-less system note; the plan decides how.
- Q: The target field is changed or deleted after carry-over was configured — allow, warn, or refuse? → A
  (product owner): Allow; the editor warns which source fields carry into it, and the definitions table marks
  the source's carry "incompatible".

### Session 2026-10-19

Owner answers to the five questions the plan raised (`plan.md` § Owner questions, research R-10, R-11,
R-15, R-2).

- Q1: Values carried from a Sales Opportunity into an Order or Quote Request created from it are written
  after the origin link is made — who are they attributed to? → A (owner ruling 2026-10-19): The **system**,
  in history and audit, not the operator. The document's creation itself stays attributed to the operator.
  Amends FR-013; adds US3-4.
- Q2: Does an operator manually linking an existing Order or Quote Request to an Opportunity on its *Links*
  tab carry values? → A (owner ruling 2026-10-19): No. Only creation, the automatic join from a quote, and
  origin linking carry (FR-008). Amends FR-008 and A-6; adds US3-5.
- Q3: One history entry per skipped key, or one per conversion? → A (owner ruling 2026-10-19): One entry per
  conversion, listing every skipped key. Amends FR-010 and SC-004.
- Q4: Order → Quote Request exists as the buyer's *clone to quote* — include it? → A (owner ruling
  2026-10-19): No; it stays excluded from carry-over. Amends FR-001 and Out of Scope.
- Q5: Is the Quote Request's skip entry admin-only? → A (owner ruling 2026-10-19): Yes; it is never shown to
  the buyer. Amends FR-010 and SC-006.

### Session 2026-10-21

Owner rulings on the review of the admin surfaces (Phases 7 and 8: V1 – V3, W1) and on the code and
security review of the pushed branch (P1 – P4).

- V1: What does the proceed button of a carry-drift warning say? → A (owner ruling 2026-10-21): It names
  the action — "Remove option anyway", "Delete field anyway", "Save anyway" (Polish: "Usuń opcję mimo to",
  "Usuń pole mimo to", "Zapisz mimo to"). It stays destructive-styled for removals and deletions.
  Amends FR-019. *Superseded in part by W1 below: "Save anyway" no longer exists.*
- V2: How are the carry checkboxes explained? → A (owner ruling 2026-10-21): In the definition editor, one
  help line per carry checkbox; in the narrow create-form row, one shared help line for the group.
  Amends FR-002.
- V3: Who may read which field a skip names? → A (owner ruling 2026-10-21): Every carry-skip entry stores a
  snapshot of the skipped field's label — the **source** definition's, as it read at write time — so any
  administrator who can see the record reads the field's name in their language without
  `custom_fields:read`. It applies to the Order system note, the Quote Request skip entry and the Sales
  Opportunity audit entry. Only skip lines (name and reason, never a value) become visible to every reader;
  custom-field **values** stay hidden from a reader without `custom_fields:read`. A skip recorded before the
  snapshot existed has no label. Amends FR-010 and FR-010a.
- W1: What do the add-option and audience drift buttons say, which V1 answered with one "Save anyway"? →
  A (owner ruling 2026-10-21): Each names its action — add an option → "Add option anyway" ("Dodaj opcję
  mimo to"), change the audience → "Change audience anyway" ("Zmień widoczność mimo to"); both keep the
  default style. Supersedes V1's "Save anyway" ("Zapisz mimo to"). Amends FR-019.
- P1: A carry from a Sales Opportunity fills a Quote Request field just after the create answered — does
  it raise the request's version? → A (owner ruling 2026-10-21): (c) Yes. An edit sent with the version
  the create returned is refused with `409 VERSION_CONFLICT` and re-read; the carry holds the row while it
  reads and writes, so a concurrent edit is never overwritten. Amends FR-013.
- P2: May a reader without `custom_fields:read` see custom-field values in a Sales Opportunity's history?
  → A (owner ruling 2026-10-21): (a) No. The history response leaves `customFieldValues` out for that
  caller; the skip lines stay (V3). Order and Quote Request audit logs are out of scope. Amends FR-010.
- P3: What does an Opportunity field's audience mean, when Opportunities are admin-only? → A (owner ruling
  2026-10-21): (a) It is about the document the value carries into: a `customer` Opportunity field may
  carry into a `customer` Order or Quote Request field, and the customer then sees the value there.
  Amends FR-011.
- P4: How is a carry checkbox's help worded? → A (owner ruling 2026-10-21): "When a record of type
  “{type}” is created from a record with this field, the new record's empty field with the same key
  receives this field's value." (the group line: "When a record of a selected type is created …"); type
  names in the carry refusals and reasons are quoted. Amends FR-002.
