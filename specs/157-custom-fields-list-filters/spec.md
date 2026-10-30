# Feature Specification: Custom fields as admin list filters

**Feature Branch**: `feat/157-custom-fields-list-filters`
**Created**: 2026-10-16
**Status**: Clarified — ready for plan
**Issues**: #286
**Input**: Issue #286 — *Custom Field flag for Admin UI listing filters.* Custom fields defined on
`/custom-fields` cannot be used to filter entities in Admin UI list views. Add an option on the definition
that makes the field available as a filter on the list of its entity — e.g. a `customer_source` field on
Orders with the option on shows a filter for it on `/orders`.

**Split.** This spec is one half of an owner-approved split (Session 2026-10-16). Its sibling,
`custom-fields-value-carry` (issue #287), adds per-definition carry-over options and **builds on the
definition editor delivered here**. This feature ships first and owns the editor work: making an existing
definition fully editable from `/custom-fields` (labels, `required`, select options, the new filter
option). Nothing here depends on value-carry.

## Current state (origin/master fda284a45)

Paths are relative to the repository root.

### Definitions and the editor

- A definition belongs to **exactly one** entity type (`packages/contracts/src/custom-fields.ts:15-28`) and
  is unique on `(entity_type, key)`
  (`packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts:25`). Value types:
  `text`, `number`, `boolean`, `date`, `select`, `multiselect` (`custom-fields.ts:32-39`).
- Each definition carries `audience` (`customer` | `internal`, default `internal`) and an opaque `config`
  JSON object that "the generic core stores but never interprets" (`custom-fields.ts:84-86`). Nothing stores
  a filter option today. The patch schema accepts `config`, label, `required` and options
  (`updateCustomFieldDefinitionSchema`, `custom-fields.ts:101-113`); changing `valueType` while values exist
  is refused (`packages/modules/custom_fields/src/backend/services/custom-field-definition.service.ts:189-190`).
- `product` is host-managed by `catalog`
  (`packages/modules/custom_fields/src/backend/services/custom-field-registry.ts:56-65`) and edited on
  `/catalog/attributes`, where `isFilterable` already exists with a **different meaning** — storefront
  faceting (`packages/contracts/src/catalog.ts:942`).
- `opportunity` declares its owner module `crm` (`custom-field-registry.ts:66`), so its definitions are
  hidden on `/custom-fields` while `crm` is off. `quote_request` declares **no** owner module
  (`custom-field-registry.ts:55`) although `quote_requests` is operator-toggleable
  (`packages/modules/quote_requests/src/manifest.ts:232`, setting `quote_requests.enabled`); Quote Request
  definitions are therefore offered while the module is off. This feature closes that gap (FR-005a): the
  fix location is the `quote_request` entry of `custom-field-registry.ts`, which gains
  `ownerModuleId: 'quote_requests'` as `opportunity` carries `ownerModuleId: 'crm'`.
- Existing edit rules on the API, which this feature's editor surfaces unchanged: `entityType` and `key` are
  not patchable (`updateCustomFieldDefinitionSchema`, `custom-fields.ts:101-113`); an option's stored
  `value` is not patchable — only its labels, default flag and sort order (`updateOption`,
  `custom-field-definition.service.ts:222-232`); an option held by any record cannot be removed
  (`option_in_use`, `:234-256`); `required` is enforced by `validateAndMerge` on every later custom-field
  write to a record, so a record lacking the value must have it supplied at its next custom-field edit
  (`packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts:73-78`).
- The editor `packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx` creates a definition with
  `config: {}` (`:126`) and afterwards lets an operator change **only the audience** per row (`:205-221`) or
  delete the definition (`:228-233`). Several labels on the page are hard-coded English (`:147`, `:175`,
  `:181-186`, `:246-280`).

### Lists

- **Orders** (`packages/modules/orders/src/admin/pages/OrdersList.tsx`) is server-paginated; the query is
  built at `:195-215` over `adminOrdersListQuerySchema` (`packages/contracts/src/orders.ts:493-525`), which
  has no custom-field parameter. The CSV export reuses the same query string (`OrdersList.tsx:568`). Saved
  views are rendered at `:656`.
- **Quote Requests** (`packages/modules/quote_requests/src/admin/pages/RfqList.tsx`) fetches the whole
  visible set once, passing only `assignmentScope` and `organizationId` (`:136-150`), then filters (`:166`)
  and paginates (`:192`) **in the browser**. The summary row carries no custom-field values. Saved views are
  rendered at `:430`.
- **Sales Opportunities** — the CRM query shared by the board and the list already accepts `fieldFilters`
  (`packages/contracts/src/crm.ts:385-421`; operators `contains` / `in` / `is` / `min`–`max` /
  `from`–`to`). The server honours them on both the board
  (`packages/modules/crm/src/backend/services/board-service.ts:103`) and the list
  (`packages/modules/crm/src/backend/services/opportunity-service.ts:546-556`), but **only for fields shown on
  the board card**; a field not on the card is ignored. Only the board renders the controls
  (`packages/modules/crm/src/admin/pages/OpportunityBoardPage.tsx:237-244`); the list
  (`packages/modules/crm/src/admin/pages/OpportunitiesList.tsx:128-140`) does not send them. The
  Opportunities list has no saved views.
- **Saved views** (feature 147, merged in fda284a45) exist on the Orders and Quote Requests lists. The saved
  `filters` is a free `record<string, unknown>` capped at 8192 bytes
  (`packages/contracts/src/saved-list-views.ts:9-10`, `:55`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator filters the Orders list by a custom field (Priority: P1)

An operator has a `customer_source` select field on Orders with the "Use as list filter" option on. On
`/orders` a "Customer source" filter appears among the list's filters; choosing "Trade fair" narrows the
list, its total and its pagination to orders whose value is "Trade fair".

**Why this priority**: The example of #286, on the busiest admin list; the smallest slice that delivers the
issue.

**Independent Test**: Create the definition with the option on, set values on three orders through the
order detail, filter `/orders` by one value and see exactly the matching orders with the total updated.

**Acceptance Scenarios**:

1. **Given** an Order definition with the filter option on, **When** an operator opens `/orders`, **Then** a
   filter labelled with the definition's label in the operator's language appears with the other filters.
2. **Given** the same definition with the option off, **When** the operator opens `/orders`, **Then** no
   filter for it appears, and a list request naming it as a filter is refused with a validation error naming
   the key (FR-011).
3. **Given** a select field filtered by two of its options, **When** the list loads, **Then** it contains
   the orders whose value is either option (OR within one field), across all pages, and the total reflects
   it.
4. **Given** two custom-field filters and a status filter, **When** the list loads, **Then** an order is
   shown only if it satisfies all three (AND across filters).
5. **Given** an active custom-field filter, **When** the operator opens the page address in a new tab,
   **Then** the same filter is applied.
6. **Given** an active custom-field filter, **When** the operator saves an order view and later loads it,
   **Then** the filter is restored.
7. **Given** the definition was deleted, or its option turned off, after a view was saved with it, **When**
   that view is loaded, **Then** the list loads without that filter and tells the operator that one filter is
   no longer available, rather than failing.
8. **Given** an active custom-field filter, **When** the operator exports the list to CSV, **Then** the
   export contains the same orders as the filtered list.
9. **Given** a page address (e.g. an old bookmark) carrying a custom-field filter whose definition is gone,
   belongs to another entity type, or no longer has the option on, **When** the operator opens it, **Then**
   the list shows the validation error naming the key and lets the operator remove that filter; it does not
   show an unfiltered list as if filtered.

---

### User Story 2 - The same filter on the Quote Requests and Sales Opportunities lists (Priority: P1)

The same option makes a Quote Request field filterable on `/quote-requests` and an Opportunity field
filterable on the Opportunities **list**. The Opportunity board keeps its existing card-field filters.

**Why this priority**: The owner put all three lists in scope; an operator who tracks one field across the
three documents expects to filter all three.

**Independent Test**: As US1, on each list. For Quote Requests, verify with more matching requests than one
list page holds.

**Acceptance Scenarios**:

1. **Given** a Quote Request definition with the option on, **When** an operator filters `/quote-requests`
   by it, **Then** only matching requests are listed, within the operator's existing visibility (assignment
   scope, organization filter) and never beyond it.
2. **Given** more matching Quote Requests than one page holds, **When** the operator pages through the
   filtered list, **Then** every matching request appears exactly once and the total is correct.
3. **Given** an Opportunity definition with the option on, **When** an operator opens the Opportunities
   list, **Then** a filter for it is offered whether or not the field is shown on the board card.
4. **Given** an Opportunity definition shown on the board card but with the option off, **When** the
   operator opens the board, **Then** the board still offers its card-field filter exactly as today,
   including *Show more*; the Opportunities list does not offer it, and a list request naming it is refused
   with a validation error naming the key (FR-011a).
5. **Given** `crm` is switched off, **When** an operator opens `/custom-fields`, **Then** Opportunity
   definitions are not offered (as today) and no Opportunity filter exists anywhere.
6. **Given** `quote_requests` is switched off, **When** an operator opens `/custom-fields`, **Then** Quote
   Request definitions are not offered at all — not listed, not creatable, not editable — exactly as
   Opportunity definitions while `crm` is off, and no Quote Request filter exists anywhere.
7. **Given** Quote Request definitions with values and the filter option on, **When** `quote_requests` is
   switched off and back on, **Then** the definitions, their options, their filter option and every stored
   value return unchanged.

---

### User Story 3 - Operator edits an existing definition, including the filter option (Priority: P1)

On `/custom-fields` an operator with `custom_fields:write` edits an existing definition without recreating
it: its labels in Polish and English, whether it is required, its select options (add, relabel, reorder,
remove an unused one), and — on Order, Quote Request and Opportunity definitions — "Use as list filter",
which is also settable at creation.

**Why this priority**: Without it US1–US2 cannot be configured from the UI. The edit surface it introduces is
the one `custom-fields-value-carry` extends (value-carry needs option editing to make a target field compatible).

**Independent Test**: Create an Order select definition without the option; from the definitions table edit
it — change its Polish label, add an option, turn the filter option on — reload `/orders` and see the filter
with the new label and option; turn the option off and see it gone.

**Acceptance Scenarios**:

1. **Given** an existing Order definition, **When** the operator edits it, **Then** they can toggle "Use as
   list filter" without recreating the field, the change is audited as a definition update, and no stored
   value changes on any record.
2. **Given** a Category, Product, Customer or Organization definition, **When** the editor is shown,
   **Then** the filter option is not offered.
3. **Given** the definitions table, **When** it lists fields, **Then** it shows which fields are list
   filters, in English and Polish.
4. **Given** an existing definition, **When** the operator changes its Polish or English label and saves,
   **Then** the detail screens and the list filter show the new label, the change is audited, and no stored
   value changes.
5. **Given** an existing select definition, **When** the operator adds an option, relabels one, or reorders
   them, **Then** the change is saved and audited; the stored option value of an existing option cannot be
   changed from the editor.
6. **Given** an option held by at least one record, **When** the operator tries to remove it, **Then** the
   removal is refused with a message saying the option is in use (today's rule); an unused option can be
   removed.
7. **Given** an existing optional definition with records lacking a value, **When** the operator makes it
   required, **Then** the change is saved, no stored value changes, and the editor tells the operator that
   records without a value must have one supplied at their next custom-field edit (today's enforcement).
8. **Given** an existing definition, **When** the editor is shown, **Then** its key, entity type and value
   type are shown read-only; the editor offers no value-type change (the API keeps today's rule — refused
   while records hold values).
9. **Given** an operator with `custom_fields:read` only, **When** they open `/custom-fields`, **Then** no
   edit control is offered and an edit request is refused.

### Edge Cases

- **Multiselect values.** A record holding several options matches when it holds **any** of the chosen
  options.
- **Records without a value.** A record with no value for the key never matches a custom-field filter; there
  is no "has no value" choice (owner decision).
- **Text.** "Contains" is case-insensitive substring match on the stored text.
- **Number and date.** Inclusive ranges; either bound may be omitted. A date range on a `date` field
  compares calendar dates, not instants.
- **Boolean.** "Yes" matches `true`, "No" matches `false`; a record without a value matches neither.
- **Dormant values.** A key whose definition was deleted stays in the record's value bag but can no longer be
  filtered on.
- **Option relabelled or removed.** Relabelling changes only the label, so active filters keep working. An
  option can be removed only while no record holds it (`option_in_use`); a filter value naming a removed
  option matches nothing and is dropped from the controls on next load.
- **Quote Request definitions while `quote_requests` is off.** The whole entity type disappears from
  `/custom-fields`, not only the filter option (FR-005a); stored definitions, options and values are kept.
- **Stale filter in the page address.** Refused by the server (FR-011) and surfaced on the list as an
  error naming the key, with a way to remove the filter (US1 scenario 9). A **saved view** is checked on load
  instead and the unavailable filter is dropped with a notice **before** the list is requested (FR-014), so
  loading an old view never produces the error.
- **Mismatched operator or inverted range.** An operator that does not apply to the field's value type
  (`contains` on a Yes/No field), or an inverted range (a minimum above its maximum, a start date after its
  end), is refused with 400 `VALIDATION_FAILED` rather than ignored or answered empty (owner ruling
  2026-10-19; FR-011).
- **Making a field required.** Existing records without a value are not touched and stay listable and
  filterable; the requirement bites at their next custom-field write (existing behaviour, surfaced in the
  editor, US3 scenario 7).
- **Large Quote Request sets.** The Quote Requests list filters in the browser today; a custom-field filter
  must give the same answer whatever the number of requests (FR-007).
- **Labels and language.** Filter labels follow the definition's label in the operator's language, with
  `labelDefault` as the fallback, exactly as on the detail screens; select options likewise.
- **Saved-view size.** Custom-field filters count towards the 8192-byte saved-view `filters` limit.
- **Board vs list.** The same Opportunity field can be a board filter (because it is on the card) and not a
  list filter (option off), or the reverse; the two rules are independent. Because the list now refuses a
  filter without the option (FR-011a), a card-field filter that the Opportunities list honours today stops
  working on the list until the option is turned on; the board is unaffected.

## Requirements *(mandatory)*

### Functional Requirements

**Definition option and editor (US3)**

- **FR-001**: A custom-field definition of type `order`, `quote_request` or `opportunity` MUST carry an
  operator-set "use as list filter" option, default off. It MUST NOT be offered for `product` (managed on
  `/catalog/attributes`, where `isFilterable` means storefront faceting), `category`, `customer` or
  `organization`.
- **FR-002**: The option MUST be available for every value type: `text`, `number`, `boolean`, `date`,
  `select`, `multiselect`.
- **FR-003**: The option MUST be settable when creating a definition and editable on an existing definition
  from `/custom-fields`, by a holder of `custom_fields:write`; each change MUST be audited as a definition
  update (Command Bus).
- **FR-003a**: An existing definition MUST be editable from `/custom-fields` by a holder of
  `custom_fields:write`, without recreating it: its labels (`pl`, `en`, default), `required`, its select
  options (add, relabel, set default, reorder, remove) and — where FR-001 offers it — the list-filter option;
  the audience control keeps working as today. Each change MUST be audited through the Command Bus. The
  editor MUST apply the existing API rules unchanged: `entityType` and `key` are read-only; an option's stored
  value is read-only; an option held by any record cannot be removed and the refusal names the option. The
  editor offers no `valueType` change; the API keeps refusing one while records hold values. No edit changes any stored value on any record.
- **FR-003b**: When an operator makes an existing definition required, the editor MUST state that records
  without a value keep loading and must have one supplied at their next custom-field edit. This feature does
  not back-fill values and does not change how `required` is enforced.
- **FR-004**: Turning the option on or off MUST NOT change any stored value on any record.
- **FR-005**: While `crm` is not present, the option on `opportunity` definitions MUST NOT be offered and
  MUST have no effect; while `quote_requests` is not present, the same holds for `quote_request`
  definitions. The option MUST be retained and take effect again when the module returns.
- **FR-005a**: While `quote_requests` is not present, Quote Request definitions MUST NOT be offered on
  `/custom-fields` or by the definitions API — not listed, created or edited — exactly as `opportunity`
  definitions are while `crm` is not present. Definitions, options and stored values MUST be kept and MUST
  return unchanged when the module returns. An off-state test MUST cover it.
- **FR-006**: The definitions table MUST show which definitions are list filters.

**List filters (US1, US2)**

- **FR-007**: The Orders list, the Quote Requests list and the Sales Opportunities list MUST each offer one
  filter per definition of their entity type whose option is on, labelled with the definition's label in the
  operator's language.
- **FR-008**: Operators per value type: `text` — contains (case-insensitive); `select` and `multiselect` —
  any of the chosen options; `boolean` — yes / no; `number` — inclusive range with optional bounds; `date` —
  inclusive date range with optional bounds. A record with no value for the key does not match.
- **FR-009**: A custom-field filter MUST narrow the whole result set the list draws from — totals and every
  page — not only the rows already loaded in the browser.
- **FR-010**: Values within one field's filter combine as OR; filters on different fields, and with the
  list's existing filters, combine as AND.
- **FR-011**: A list request naming a custom-field filter whose definition does not exist, is not of the
  list's entity type, or does not have the option on MUST be refused as an invalid request with a validation
  error naming the key. It MUST NOT be ignored silently; the one exception is the board's lane continuation
  on the Opportunities list endpoint, which follows the board's rule (FR-011a, FR-016). This applies to the
  Orders list, the Orders CSV export, the Quote Requests list and the Opportunities list. The admin list MUST show the error naming the
  key and let the operator remove the offending filter (US1 scenario 9).
- **FR-011a**: On the Opportunities **list** endpoint the rule of FR-011 replaces today's card-field rule:
  a `fieldFilters` entry for a field that is on the board card but does not have the list-filter option on
  MUST be refused. This is a deliberate change of shipped list behaviour; the existing list `fieldFilters`
  tests change with it. The **board** endpoint is unchanged (FR-016). A request to the Opportunities list
  endpoint carrying `cardValues=true` — the board's *Show more* lane continuation — follows the board's
  card-field rule (FR-016) and is not subject to FR-011a, so the board stays unchanged; every other request
  to that endpoint follows FR-011a. Reason: the board loads further cards of a lane through the list
  endpoint, so applying FR-011a there would make the board refuse, on *Show more*, card-field filters its
  first page honours — a change to the board the owner ruled out.
- **FR-012**: Filtering MUST stay within the operator's existing visibility (tenant scope, sales-rep
  assignment scope, organization filter) and MUST NOT reveal the existence of records outside it.
- **FR-013**: Active custom-field filters MUST be reflected in the page address (deep-linkable), MUST appear
  as removable applied-filter chips where the list shows chips, and MUST return the list to its first page
  when changed.
- **FR-014**: On the Orders and Quote Requests lists, active custom-field filters MUST be part of the saved
  view's `filters` and MUST be restored when the view is loaded. A saved custom-field filter whose definition
  is gone or no longer has the option on MUST be dropped on load with a visible notice, before the list is
  requested, so that the request never carries it and FR-011 is not triggered; the rest of the view MUST
  load.
- **FR-015**: The Orders CSV export MUST honour the active custom-field filters, as it honours the list's
  other filters.
- **FR-016**: The Opportunity board's card-field filters MUST keep their shipped behaviour: they are
  governed by the card fields, not by the new option, and a field not on the card is ignored on the board.
  This includes the board's lane continuation (*Show more*) served by the Opportunities list endpoint with
  `cardValues=true` (FR-011a).
- **FR-017**: Values of `internal`-audience definitions MAY be filtered in the admin. No custom-field filter
  is added to any storefront or API-key endpoint.

**Cross-cutting**

- **FR-018**: Every new label, operator name, chip text, notice, validation message and editor warning MUST
  exist in `en` and `pl`; the hard-coded English labels on `/custom-fields` that this feature touches —
  including every label of the edit form — MUST be translated in the same change.
- **FR-019**: No new permission code: definitions keep `custom_fields:read` / `custom_fields:write`; lists
  keep their existing read permissions.
- **FR-020**: Documentation in `docs/` (en + pl) MUST describe definition editing and its limits, the
  option, where the filters appear, the operators per value type, the refusal of unavailable filters, the
  board/list distinction (including the FR-011a change) and saved-view behaviour, and that Quote Request
  definitions are hidden while `quote_requests` is off.

### Key Entities

- **Custom-field definition** — gains a list-filter option and becomes editable after creation; still one
  entity type per definition, still keyed `(entity type, key)`, key and entity type immutable.
- **Custom-field filter** — (definition key, operator, value(s)) carried in a list request, the page address
  and a saved view; not stored on its own.
- **Host lists** — Orders, Quote Requests, Sales Opportunities; unchanged rows (no custom-field columns).

## Success Criteria *(mandatory)*

- **SC-001**: An operator edits an existing field — label, options, filter option — and uses it as an Orders
  filter in under one minute without recreating the field.
- **SC-002**: On each of the three lists, a custom-field filter returns the same records whether 20 or
  2 000 records match (verified by test on a dataset larger than one page).
- **SC-003**: Every value type has at least one passing filter test per list that offers it.
- **SC-004**: A saved Orders or Quote Requests view with a custom-field filter restores it; a view whose
  field became unavailable still loads, with the notice.
- **SC-005**: The Opportunity board's existing filter tests pass unchanged; the Opportunities list's
  `fieldFilters` tests are deliberately updated to FR-011a.
- **SC-006**: With `quote_requests` off, no Quote Request definition is reachable through `/custom-fields` or
  the definitions API, and all of them return unchanged when it is switched back on (off-state test).

## Assumptions

- **A-1**: Customers, Organizations, Products and Categories lists are out of scope (owner decision).
- **A-2**: The CSV export of Orders follows the list's filters because it already reuses the list query; the
  Quote Requests and Opportunities lists have no export affected by this feature.
- **A-3**: The option is stored as a generic definition capability (Principle XIV), not as a host-specific
  column; how it is stored (`config` key or a dedicated attribute) is a plan decision.
- **A-4**: The Opportunities list keeps its cursor pagination; this feature does not change it.
- **A-5**: The Quote Requests list may move filtering to the server or keep fetching the visible set; either
  way FR-009 must hold. The choice is a plan decision.

## Out of Scope

- Custom-field **columns** in admin lists; sorting by a custom field.
- A "has no value" filter choice.
- Custom-field filters on storefront or API-key endpoints.
- Customers, Organizations, Products (`/catalog/attributes`) and Categories.
- Changing the Opportunity board's filter rule.
- Value carry-over between documents (`custom-fields-value-carry`).

## Constitution constraints

- **II (API-first)** — new query parameters and the definition option are defined in `packages/contracts/`
  first; changes are additive.
- **III (TDD)** — every FR traces to a test, including off-state tests for `crm` and `quote_requests`.
- **XI (tenant isolation)** — filters never widen the operator's scope (FR-012).
- **XIII (Command Bus auditing)** — definition edits are audited Commands (FR-003, FR-003a).
- **XIV (entity-agnostic extensibility)** — the option is a generic definition capability; `custom_fields`
  learns no host-specific list rules.
- **XVII (operator-toggleable modules)** — `crm` or `quote_requests` off ⇒ their definitions, filters and
  options behave as if never installed, non-destructively (FR-005, FR-005a).
- **VIII / i18n** — English in code and docs; `en` + `pl` for every user-facing string (FR-018).

## Clarifications

### Session 2026-10-16

- Q: On the new lists, does a yes/no filter set to *No* also match records where the field has no value (as the Opportunities board does)? → A (product owner): No — on the lists *No* matches only a stored `false`; the board keeps "false or never set" unchanged; the module docs state the difference.

- Q: Deliver issues #286 and #287 together or split? → A (product owner): Split. `157-custom-fields-list-filters`
  covers #286 plus the definition-editor work needed for the filter option and ships first;
  `custom-fields-value-carry` covers #287 and builds on this editor.
- Q: Which admin lists get custom-field filters? → A (product owner): Orders, Quote Requests and the Sales
  Opportunities list. Not Customers or Organizations.
- Q: How does the new option relate to the Opportunity board's card-field filters? → A (product owner): The
  new option drives the Opportunities **list**; the board keeps filtering by card fields.
- Q: Which value types and operators? → A (product owner): All value types with the CRM operator set — text
  "contains", select "any of", boolean yes/no, number and date ranges. No "has no value".
- Q: Are custom-field filters part of saved views? → A (product owner): Yes — where a list has saved views,
  custom-field filters are part of the saved state. (Saved views, feature 147, merged in fda284a45 after the
  question was asked; FR-014 therefore applies to the Orders and Quote Requests lists directly.)
- Q: How far does editing an existing definition on `/custom-fields` go — only the new filter toggle, or full
  editing? → A (product owner): Full editing of an existing definition: labels pl/en, required, select
  options and the new "Use as list filter" toggle (value-carry relies on option editing).
- Q: Quote Request definitions are offered on `/custom-fields` while `quote_requests` is off — hide only the
  filter option, or fix the gap? → A (product owner): Fix the gap in 157: Quote Request definitions disappear
  from `/custom-fields` while `quote_requests` is off, as Opportunity definitions do with `crm`
  (`ownerModuleId: 'quote_requests'` in `custom-field-registry.ts`), with an off-state test.
- Q: A list request filters by an unknown key, another entity's field, or a field without the filter option
  — refuse or ignore? → A (product owner): Refuse with a validation error naming the key, including on the
  Opportunities list endpoint; consequence accepted: a card-field filter without the new option now errors on
  the list, the board is unchanged.
- Q: Does the Orders CSV export apply the same custom-field filters (FR-015)? → A (product owner): Yes,
  accepted.
- Note (product-owner reading, not a new owner answer): the board's *Show more* calls the Opportunities
  list endpoint with `cardValues=true` (`OpportunityBoardPage.tsx`), and the list page never sends that
  parameter. Consistent with the owner's "board unchanged" ruling, such requests follow the board's
  card-field rule (FR-016) and are exempt from FR-011a; all other list-endpoint requests are refused per
  FR-011 / FR-011a. Recorded in FR-011, FR-011a and FR-016.
