# Research: Custom fields as admin list filters (`specs/157-custom-fields-list-filters/`)

**Input**: [spec.md](./spec.md) (clarified 2026-10-16, issue #286). Every path below is relative
to the repository root and was read on `origin/master` at `fda284a45`; every anchor was re-verified
on `3d9ca98cd` (2026-10-19) and the four that had moved were corrected (plan.md § *Refresh 2026-10-19*).

Each entry is **decision → rationale → alternatives rejected**. Nothing is left
`[NEEDS CLARIFICATION]`. R-8's board mode was an interpretation and is now **spec-confirmed**
(FR-011a's board sentence, added by the product owner after `speckit.analyze`). The list's boolean *No* (R-5) is
confirmed by the product owner (2026-10-16). Revised
2026-10-16 after `speckit.analyze` and the threat model; R-17 maps each threat-model finding to
where it is applied.

---

## R-1 The option is a dedicated definition attribute `listFilter`, not a `config` key

**Decision.** `custom_field_definitions` gains `list_filter boolean not null default false`,
owned by `custom_fields`, surfaced as `listFilter: boolean` on `customFieldDefinitionSchema`,
on `CustomFieldDefinitionRecord`, in the admin serializer and in the Command's audit snapshot
(`snapshotDefinition`, `packages/modules/custom_fields/src/backend/commands/definition-commands.ts:31`).
On create and on patch it is **optional** (`z.boolean().optional()`; absent on create = `false`,
absent on patch = unchanged), so `catalog`'s apply-seam callers and every existing client
compile and behave unchanged.

**Rationale.**

- `config` is documented and tested as **host-owned, core-uninterpreted** data:
  `custom-fields.ts:84-86` ("the generic core stores but never interprets `config`"),
  `docs/docs/architecture/custom-fields.md` § *Host-capability flags*, and
  `backend/test/integration/custom_fields/us4-capability-optin.test.ts`. This option is read by
  `custom_fields` itself — its own admin page renders it, its registry decides which types offer
  it (R-2) and its port decides which keys are filterable (R-4). A flag the core interprets is
  not a `config` flag.
- `PATCH` replaces `config` wholesale (`custom-field-definition-apply.ts:144`); an editor
  toggling one key inside it would have to round-trip every host flag it does not understand.
- `audience` (`20261010T090000_custom_fields_definition_audience.ts`) is the exact precedent: a
  generic definition attribute with its own column, DTO field and snapshot entry.
- The name avoids `isFilterable`, which on `/catalog/attributes` means storefront faceting
  (`packages/contracts/src/catalog.ts:942`), and `filterable`, which `config` already carries in
  `us4-capability-optin.test.ts`. `listFilter` contains none of the identifiers
  `backend/test/unit/custom_fields/no-entity-capability-logic.test.ts` forbids.

**Rejected.** `config.listFilter` — contradicts the documented contract of `config` and makes
the core read a host flag. A host-side column (`orders.custom_field_filter_keys` and siblings) —
three places to keep in sync and violates Principle XIV ("a generic definition capability").

## R-2 Which entity types offer the option: a generic registry marker

**Decision.** `SupportedEntityMeta` (`custom-field-registry.ts`) gains `listFilter?: true`, set
on `order`, `quote_request` and `opportunity`. `GET /api/v1/admin/custom-fields/entity-types`
answers `listFilter: boolean` per type (`customFieldEntityTypeInfoSchema` gains the field). The
create and patch services refuse `listFilter: true` on a type without the marker with a new
`CustomFieldDefinitionError` code `list_filter_unsupported`, answered by the existing default
branch as **422 `CUSTOM_FIELD_DEFINITION_INVALID`** (`routes.admin.ts:30-45`). `product` keeps
its `managedBy` 409 before any of this is reached.

**Rationale.** The registry is where per-type metadata already lives (`orgOwned`, `managedBy`,
`ownerModuleId`); the page renders from `entity-types` precisely so that "no hard-coded entity
list" lives in the frontend (`routes.admin.ts` comment above the route). The marker is data, not
host logic: the core never asks *which* module a type belongs to.

**Rejected.** A hard-coded list in the admin page (drifts from the server rule, and the fallback
list in `CustomFieldsPage.tsx:17-23` already shows how). Allowing the option on every type and
ignoring it where no list uses it (FR-001 says MUST NOT be offered).

## R-3 `quote_request` gets `ownerModuleId: 'quote_requests'` (FR-005a)

**Decision.** One registry line; no route code changes — `isOwnerPresent`/`isDefinitionServed`/
`assertOwnerPresent` (`routes.admin.ts:66-102`) already implement the behaviour for
`opportunity`. Two derived artefacts move in the same change:
`backend/test/integration/custom_fields/entity-owner-presence.test.ts` (its `UNOWNED` constant
lists `quote_request`) and `FALLBACK_ENTITY_TYPES` in `CustomFieldsPage.tsx:17-23`, which drops
`quote_request` so the page never offers it before `entity-types` answers.

**Rationale.** The owner chose to close the gap here (spec Clarifications). The generic rule
exists and is tested for `crm`; the test file is written to treat the owned type "as the
instance, not as a special case", so it is extended to iterate both owned types.

**What this does not touch.** `quote_requests`' own value writes (`validateAndMerge`) are only
reachable while the module is on; nothing outside it validates `quote_request` values.

## R-4 Server-side filtering: one published port owned by `custom_fields`

**Decision.** `custom_fields` publishes a new port, container name
**`customFieldListFilterPort`**, interface `CustomFieldListFilterPort` in
`packages/contracts/src/custom-fields.ts`:

```ts
interface CustomFieldListFilterPort {
  /** Served definitions of `entityType` with `listFilter` on — what a list offers. */
  listFilterable(entityType: SupportedEntityType): Promise<CustomFieldListFilterField[]>;
  /**
   * The whole request's filters as ONE condition over the entity's bound host table —
   * `{ sql, params }` = `select t."id" from "<table>" t where (<p1>) and (<p2>) …`, every
   * key and value bound — or null when nothing applies. Re-applies the record's caps
   * (ZodError), then throws a CustomFieldFilterUnavailableFailure naming every key that
   * has no served, same-type definition with `listFilter` on.
   */
  condition(
    entityType: SupportedEntityType,
    filters: CustomFieldFilters | undefined,
  ): Promise<CustomFieldListFilterCondition | null>;
}
```

A host adds the condition to its **own** scoped query as
`{ id: { $in: raw('(' + c.sql + ')', [...c.params]) } }` — the shape CRM's tag and field filters
already use (`packages/modules/crm/src/backend/domain/board-card-fields.ts:258-283`) — creating
the `raw()` fragment **afresh for every statement** it runs, as that file's "a raw fragment is not
reused" rule says (Orders runs three statements per list request and a fourth per export).

**One condition per request, not one per key** (threat model F-1). CRM's board emits one
semi-join per predicate; ten keys with a range each would be twenty scans of the host table in one
statement. The port instead ANDs every predicate inside one `where`, so a request costs one scan
of the host table per statement whatever it filters on. Together with the record's caps (R-6: 10
keys, 100 `in` values) that bounds the predicate count at 20 and the bound parameters at ~120.
The shape is testable from the SQL text alone — exactly one `from "<table>"` (T018).

**Rationale.**

- **The table is already bound in `custom_fields`.** `HOST_TABLE_BY_ENTITY`
  (`custom-field-value.service.ts`) maps every entity type to `{ table, column }` for the
  change-guard probes; the architecture page calls it "purely storage metadata — no host logic".
  The port reuses that binding, so a host passes no table name and the SQL is stated once.
- **The refusal (FR-011) needs the definitions**, which only `custom_fields` owns; the host
  would otherwise resolve `customFieldDefinitionReadPort` and re-implement "served, same type,
  option on" three times.
- **The stored representation is `custom_fields`' to know** — date as `YYYY-MM-DD` text,
  multiselect as a JSON array, number as a JSON number — `validateAndMerge`/`coerce` decide it.
- **Scope cannot widen (FR-012).** The condition is an id subquery that only intersects the
  host's own tenant-filtered, assignment-scoped statement; it is never a statement on its own.
  The refusal depends on definitions only (platform-global), never on rows, so it reveals
  nothing about records outside the caller's scope.
- `custom_fields` is `activation.nonDeactivatable` (its manifest; `CustomFieldValuesPanel.tsx`
  header) — the port is always present, so no host needs an off branch for it.

**Rejected.**

- *A pure SQL builder in `@endora-commerce/contracts`.* Viable (no ORM import is needed), but
  SQL text in a package the admin and storefront compile is the wrong home, the host would still
  need the definitions port for FR-011, and the table name would be restated per host.
- *A runtime helper on `@endora-commerce/mod-custom-fields/ports`.* The contract-surface rule `check:module-boundary` enforces: that subpath must
  compile to `export {}` (`packages/modules/custom_fields/src/ports/index.ts` header).
- *A new platform barrel.* `check:platform-surface` holds the published set at five; the
  platform owns no custom-field semantics.
- *Each host writing its own predicates.* Three copies of six value types' SQL — CRM's copy took
  an independent review (N-BFR6/7 in `board-card-fields.test.ts`) to get right.

## R-5 The CRM board keeps its own predicates (FR-016)

**Decision.** `boardFieldFilterConditions` (`board-card-fields.ts`) is **not** rewritten onto
the port. The port's predicates are adapted from its `customPredicates` (type-drift guards,
literal wildcards, date-as-text), with one deliberate difference.

**Rationale.** The spec's edge case says a record without a value matches neither "Yes" nor
"No"; the board's `is: false` is `is distinct from 'true'::jsonb` — "false or never set" —
and is asserted by `backend/test/integration/crm/board-card-fields.test.ts:199`
("boolean: yes is true, no is false or never set"). FR-016 freezes the board's behaviour and
SC-005 its tests. Delegating would change one or the other.

**Rejected.** Delegation with a "board mode" flag on the port — a host-specific rule inside
`custom_fields` (Principle XIV) to save ~40 lines. The divergence is recorded in Complexity
Tracking and in the module docs.

**Confirmed by the product owner (2026-10-16)** (`speckit.analyze` #5): the list's *No* matches a
stored `false` only, and the board keeps "false or never set"; the module docs state the difference.

## R-6 One operator vocabulary: CRM's, published as a shared schema

**Decision.** `packages/contracts/src/custom-fields.ts` publishes `customFieldFilterSchema`
(the exact shape of `OpportunityFieldFilterSchema`, `crm.ts:367-377`: `contains`, `in`, `is`,
`min`, `max`, `from`, `to`, `.strict()`), `customFieldFiltersSchema`
(`record(definitionKey → filter)`, at most **10 keys and 100 `in` values in total** — threat
model F-1; CRM's own record keeps its 20 references for the board) and `customFieldFiltersQueryParamSchema`
(the JSON-in-a-query-parameter transform, ≤ 8000 characters, issues located at
`[key, operator]`). `crm.ts` re-exports `OpportunityFieldFilterSchema` **as** the shared schema
(same object), so CRM's types and tests are unchanged and the operator set has one statement.

Operators per value type (FR-008) — on the lists an operator not of the type is refused with 400
`VALIDATION_FAILED` (contract §1.4, amended after the backend QA: FR-011 says a filter is never
ignored silently); the board keeps ignoring it, as CRM documents for its own schema
(`crm.ts:363-366`):

| Value type | Operators | Match |
| --- | --- | --- |
| `text` | `contains` | case-insensitive substring of the stored string; `%`, `_`, `\` literal |
| `select` | `in` | stored option is one of `in` (OR) |
| `multiselect` | `in` | stored array holds at least one of `in` (OR) |
| `boolean` | `is` | stored JSON `true` / `false` exactly; absent matches neither |
| `number` | `min`, `max` | inclusive; only a stored JSON number is compared |
| `date` | `from`, `to` | inclusive calendar dates on the stored `YYYY-MM-DD` |

A key whose record has no value never matches (each predicate requires the key to be present
and of the type). Different keys combine as AND, and AND with the list's own filters (FR-010).

**Caps.** The port parses its input with `customFieldFiltersSchema` before anything else, so the
caps hold for every host — including the CRM list, whose `fieldFilters` record allows 20
references and reaches the port with its `custom:` subset. A breach is a `ZodError` the host
rethrows, answered as 400 `VALIDATION_FAILED`. *Rejected:* each host counting its own keys (three
statements of one limit, and the CRM one easy to forget); lowering CRM's record cap to 10 (changes
the board, FR-016).

**Rejected.** A new operator vocabulary (the owner chose CRM's set); `eq`/`neq` or "has no
value" (out of scope).

## R-7 Wire encoding

**Decision.**

- **API.** Orders and Quote Requests take `customFieldFilters=<JSON>` keyed by bare definition
  key (`{"customer_source":{"in":["trade_fair"]}}`), parsed by
  `customFieldFiltersQueryParamSchema`. The Opportunities list keeps its shipped parameter,
  `fieldFilters`, whose `custom:<key>` references already address custom fields
  (`crm.ts:380-421`).
- **Admin page address (FR-013).** One repeated parameter per operator,
  `cf.<key>.<operator>=<value>` (`in` repeated), mirroring the board's `f.<ref>.<operator>`
  (`packages/modules/crm/src/admin/lib/board-fields.ts:91`, read by `readBoardFilters` at `:123`). Keys match `^[a-z][a-z0-9_]{0,63}$`
  so they contain no dot. Reading is forgiving of malformed **operators** (dropped, as the board
  does) but **not** of unavailable keys: those are sent and refused by the server (US1-9).
- **Saved view state (FR-014).** One namespaced member of the opaque `filters` object,
  `filters.customFields = { [key]: CustomFieldFilter }`. It counts towards the 8192-byte limit
  (`saved-list-views.ts:9-10`) with no server change. `customFields` does not collide with the
  vocabulary #317 proposes for the Quote Request list (`scope`, `organizationId`, `status`, `q`,
  `sort`).

The API parameter schema is **idempotent** (`string | CustomFieldFilters` in): the platform's Zod validator compiler replaces `request.query` with the parsed value and the Orders handlers parse it again (contract §1.2).

**Rejected.** Repeated `cf.*` parameters on the API (a second parser per host and no
path-located Zod issues); one JSON blob in the page address (unreadable, unbookmarkable by
hand).

## R-8 Opportunities list: FR-011a without breaking the board's lane continuation — spec-confirmed

**Finding.** The board's *Show more* reads further cards of one lane from the **list endpoint**:
`OpportunityBoardPage.tsx:412-419` spreads the board's params (including card-field
`fieldFilters`) into `crmApi.listOpportunities({ …, cardValues: true })`, and
`admin/test/modules/crm/board.test.tsx:573,577` and `board-card-fields.test.tsx:481` pin that
request. Applied literally, FR-011a would make *Show more* answer 400 for any card field without
the new option — a board behaviour change FR-016 forbids and SC-005 would catch.

**Decision (spec-confirmed: the product owner added FR-011a's board-mode sentence after
`speckit.analyze` #1).** On
`GET /api/v1/admin/crm/opportunities` the `cardValues` flag already means "summaries as the
board answers them" (`crm.ts:425-429`). The plan makes that the switch:

- **`cardValues=true` — board semantics, unchanged.** Every `fieldFilters` reference follows the
  card rule (only card fields; others ignored). This is the board's lane continuation and the
  only caller sending it.
- **Otherwise — list semantics (FR-011a).** A `custom:<key>` reference is governed by FR-011
  through the port (option on → filters, whether or not the field is on the card; option off,
  unknown or other type → 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`). A `builtin:<key>` reference
  keeps today's card rule — FR-011a concerns custom fields, no list client sends built-in
  references, and changing them is not asked for.

The Opportunities **list page** never sends `cardValues`, so every request it makes is under
FR-011a. A contract test covers both modes on the same endpoint, including that `cardValues=true`
with a key neither on the card nor list-filter-enabled is ignored (200), not refused.

**`cardValues` is never a security boundary** (threat model F-8). Any caller may send it; what it
selects is the narrower card rule inside the same tenant- and assignment-scoped statement, so it
can neither widen a result nor reach a record outside the caller's scope. The handler carries a
comment saying so, so nobody later hangs an authorisation decision on it.

**Rejected.** A dedicated `GET …/crm/board/lane` endpoint — the cleanest API, but every board
test that asserts the continuation request path changes (against SC-005's letter) and a route is
added for no user-visible gain. Refusing on the list regardless of `cardValues` — breaks the
board (FR-016). Owner question — not needed: the user-visible behaviour is exactly what the
owner accepted (list refuses; board unchanged).

## R-9 Quote Requests: narrow server-side inside the existing whole-set read (FR-009, A-5)

**Decision.** `GET /api/v1/admin/quote-requests` accepts `customFieldFilters`. The handler first
refuses a present value that is not one string — a repeated parameter arrives as an array — with
400 `VALIDATION_FAILED` (threat model F-3), then parses it with
`customFieldFiltersQueryParamSchema` (a thrown `ZodError` is the platform's 400
`VALIDATION_FAILED`, as `adminOrdersListQuerySchema.parse` already relies on); `RfqAdminService
.listAll` (`rfq-admin-service.ts:145-153`) pushes the port's condition into `where.$and` — never
assigns `where.id`, so a later id condition cannot overwrite it — **before** the in-memory
visibility and scope passes, so visibility still bounds the result (FR-012). The
response still carries every matching request; `RfqList.tsx` keeps paging what it receives. The
route keeps parsing its other parameters by hand and gains **no** route-level querystring schema:
attaching one for a single member would make Fastify's validator strip `status` and
`assignmentScope` from `request.query`.

**Rationale.** FR-009 asks that the filter narrow "the whole result set the list draws from —
totals and every page". Because the endpoint returns the whole visible set, narrowing that set
on the server satisfies it at any size (SC-002: test with more matches than one page). Issue
#317's redesign (server paging, batched visibility, truthful envelope) is left to #317; this
change adds one condition to the query #317 will rewrite and one parameter #317 can keep.

**Rejected.** Client-side filtering on values added to the summary row (FR-009 forbids
browser-only narrowing, and it would put every request's values on the wire). Doing #317 here
(scope creep into a separately-reported defect).

## R-10 What a list offers: one small host route per list, gated by the list's own permission

**Decision.** Each host serves its filterable definitions through the port:

| Route | Gate |
| --- | --- |
| `GET /api/v1/admin/orders/custom-field-filters` | `orders:read` |
| `GET /api/v1/admin/quote-requests/custom-field-filters` | `rfqs:handle` |
| `GET /api/v1/admin/crm/opportunities/custom-field-filters` | `crm:read` |

Each answers `{ data: CustomFieldListFilterField[] }` — key, value type, labels, options — and
nothing else (no `audience`, `required`, `config` or `listFilter`).

**Consequence, recorded deliberately** (threat model F-7, from FR-017): an operator holding only
the list's permission sees the key, labels and options of every list-filter field of that type,
`internal` ones included — metadata `custom_fields:read` would otherwise gate. That is no wider
than what they can already read: each list's admin detail returns the full value bag to an admin
(Quote Requests: `quoteCustomFieldValuesFor(…, forAdmin)` returns it unprojected,
`rfq-service.ts:1334-1347`; Orders: `order-response.ts:32` against the customer projection at
`:62`; Opportunities: `opportunity-service.ts:208-210`), and marking a field as a list filter is the definition owner's explicit choice to
show it there. `listFilter` itself is never added to a customer-facing projection.

**Rationale.** The definitions route (`GET /api/v1/admin/custom-fields/definitions`) is gated by
`custom_fields:read`; an operator holding `orders:read` alone would get no filters, which FR-007
and FR-019 ("lists keep their existing read permissions", no new code) exclude. A single generic
route in `custom_fields` would need each host's permission code in the registry — host knowledge
in the core. Each route lives in its host's route function, so it disappears with the host
(`crm` off, `quote_requests` off — FR-005). The static segment is registered beside `/:id`;
find-my-way prefers static segments, and a contract test per host proves it (147's lesson).

**Rejected.** Gating on `custom_fields:read` (breaks FR-007 for list-only operators); putting the
definitions into every list response (re-sent on every page, and absent exactly when a stale
filter makes the list answer 400).

## R-11 The refusal: one minted code, `CUSTOM_FIELD_FILTER_UNAVAILABLE` (400)

**Decision.** The port throws a structural failure (`name: 'CustomFieldFilterUnavailableError'`,
`keys: string[]`, guard `isCustomFieldFilterUnavailableFailure` in contracts — the pattern already used for
`isCustomFieldValidationFailure`). Each host maps it to
`HttpError(400, ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE, message, { key, keys })`, `key`
being the first refused key. The code is **owned by `custom_fields`** (ownership tier T1: the noun is the
definition, as for `CUSTOM_FIELD_VALUE_INVALID`, which five hosts raise and `custom_fields`
declares). Minted in one commit: `ERROR_CODES`, `MINTED_ERROR_CODES`
(`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), `custom_fields` manifest
`errorCodes`, `errors.CUSTOM_FIELD_FILTER_UNAVAILABLE` in `custom_fields/i18n/{en,pl}.json`
with `{key}` interpolated from `details` (`error-envelope.ts:479-484`). `details` holds no `code`
member, so `refusalToken` reads no token.

**Rationale.** The admin must act on the refusal — show "this filter is no longer available" and
offer to remove **that** key (US1-9) — so it needs a machine-readable code and key, not a parsed
Zod path. 400, because it is a property of the request against current configuration, like a
malformed parameter; a malformed operator or bound stays the platform's 400 `VALIDATION_FAILED`.

**Rejected.** Reusing `VALIDATION_FAILED` with a `details` path (the admin would branch on path
shape); 422 (reserved here for body validation, e.g. `CUSTOM_FIELD_VALUE_INVALID`); ignoring
unavailable keys (owner ruled refuse).

## R-12 The definition editor (FR-003, FR-003a, FR-003b, FR-006) — designed for value-carry to extend

**Decision.**

- **Edit, not re-create.** Each row of the definitions table gets an *Edit* action (holders of
  `custom_fields:write` only — `useAuth().hasPermission`) opening `DefinitionEditorDialog` on the
  kit's `ModalDialog` (promoted by 147). Sections: **Identity** (key, entity type, value type —
  read-only text), **Labels** (default, `en`, `pl`), **Rules** (`required`, with the FR-003b
  notice when it is switched on), **Options** (select/multiselect only), **List & behaviour**
  (`DefinitionBehaviourFields`: today only "Use as list filter", rendered when the type's
  `entity-types` entry says `listFilter: true`). Audience stays the inline row control it is
  today (`CustomFieldsPage.tsx:205-221`, pinned by `CustomFieldsPage.audience.test.tsx`).
- **The inline create form stays** and gains the same `DefinitionBehaviourFields` block, so the
  option is settable at creation (FR-003) and `CustomFieldsPage.audience.test.tsx` keeps passing.
- **Save semantics.** The dialog's *Save* sends **one** `PATCH` with only changed members of
  `labelDefault`, `label`, `required`, `listFilter` — one Command, one audit entry
  (`custom_fields.definition.updated`). **Options are applied one action at a time**, each its
  own existing sub-route and Command (`POST …/options`, `PATCH …/options/:id` for labels, default
  and sort order, `DELETE …/options/:id`), with the result shown at that option; an
  `option_in_use` refusal shows the server's sentence, which names the option
  (`custom-field-definition.service.ts:247-251`). Reordering uses the kit's
  `TouchReorderButtons` + `ReorderAnnouncer` (no drag-and-drop dependency) and patches the
  `sortOrder` of the options that moved. An option's stored `value` is shown read-only; it is
  editable only while adding a new option.
- **Save sends only what changed** (threat model F-6). The body never carries `config` (which a
  `PATCH` replaces wholesale), `options`, `valueType` or `key`, so two admins editing different
  members of one definition do not overwrite each other. An `If-Match` precondition is
  **deferred to value-carry**, whose carry settings make a lost edit costlier; recorded, not built.
- **Value-carry's seam.** `DefinitionBehaviourFields` receives the **definition being edited or created**
  (`key`, `valueType`, `options`, `audience`, and `id` when editing) as well as the entity type's
  `entity-types` entry, its value and `onChange` (contract `admin-surfaces.md` §3). It is the one
  block both create and edit render. value-carry may add its "Carry value to …" toggles inside it, a
  warning slot in the Options section and a confirm step before *Save* — each by additive props;
  neither the dialog's structure nor its save path is rewritten.
- **FR-006.** The table gains a *List filter* column (a translated yes/—), and every hard-coded
  English string on the page is moved into the `custom_fields` bundle (FR-018), which drains the
  page's entry in `HARDCODED_STRINGS_BASELINE` (`backend/scripts/i18n-hardcoded-strings.ts:499`,
  value 4) to nothing in the same commit.

**Rationale.** Options are rows with their own lifecycle and their own refusal; batching them into
one save would either need a new composite endpoint (the patch schema accepts `options` today but
`applyUpdateDefinition` silently ignores them — not a contract to build on) or produce partial
saves with no transaction across calls. Per-action application makes each change's outcome
visible where it happened. Each change is a Command, so FR-003a's audit holds per change.

**Rejected.** A dedicated edit page `/custom-fields/:id` (a new admin route and palette question
for a form that fits a dialog); a batch save over N calls (partial-failure ambiguity); a new
composite "replace options" endpoint (a destructive "absent means delete" contract for no
user-visible gain).

## R-13 Admin: one kit composite for the three lists

**Decision.** `@endora-commerce/admin-kit/components` gains `CustomFieldListFilters` (one control
per filterable field, by value type) plus pure helpers — `readCustomFieldFilterParams`,
`writeCustomFieldFilterParams`, `sanitizeCustomFieldFilters` (FR-014: kept vs dropped keys, removed options pruned), `pruneRemovedOptions` (address state once the fields load),
`customFieldFilterChips` (chip label and remover per key/operator), `customFieldFilterRefusal`
(the refused key from an `ApiError`) — and a hook `useCustomFieldListFilterFields(endpoint)`.
Strings come from the `core` namespace (`packages/modules/_i18n/i18n/{en,pl}.json`), as every kit
component's do. The CRM board's `BoardFieldFilters` is left untouched (R-5).

**Rationale.** Three lists, one behaviour, one set of strings — 147's `SavedViewsControl`
argument. The kit's barrel membership is derived from use by more than one module
(`packages/admin-kit/src/components/index.ts` header); three modules use this.

**Rejected.** Per-page copies (three implementations of six controls and of the stale-filter
flow); promoting `BoardFieldFilters` (it also renders built-in and contact filters and the
board's semantics).

## R-14 Saved views and stale filters (FR-014, US1-7, US1-9)

**Decision.** On loading a view, the page runs `sanitizeCustomFieldFilters(view.filters
.customFields, fields)` against the list's filterable fields **before** setting state; dropped
keys produce one notice (`customFieldFilters.notice.dropped`, naming the count and labels/keys)
and are never sent. If the fields have not loaded (or failed), the page waits for them; if they
failed, every saved custom-field filter is dropped with the same notice. A filter that reaches the
server from the **address** is not pre-sanitised: the 400 is shown as an error naming the key
with a *Remove this filter* action (US1-9), and the Orders CSV export link is not offered while
that error stands.

## R-15 Where tests go

- Contracts: co-located `packages/contracts/src/custom-fields.test.ts` (new),
  `orders.test.ts`, `crm.test.ts` (extended).
- `custom_fields` pure predicate builder: co-located
  `packages/modules/custom_fields/src/backend/services/custom-field-list-filter.service.test.ts`
  (never beside `src/manifest.ts`).
- Server-bound: `backend/test/integration/custom_fields/` (port against Postgres, option,
  owner presence), `backend/test/contract/{orders,quote_requests}/custom-field-filters.test.ts`,
  `backend/test/integration/crm/list-custom-field-filters.test.ts`, extended off-state tests.
- Admin: `admin/test/components/` (kit), `admin/test/modules/{orders,quote_requests,crm,
  custom_fields}/…` — every render in `<StrictMode>`.
- Fixtures: per-run unique definition keys (`` `cf157_${randomUUID().slice(0, 8)}` ``) and
  record marks; extra admins get their own stub sessions in `backend/test/helpers/test-actors.ts`
  and their own roles created by the test file; no shared role is mutated.

## R-16 Performance

The request's one condition is `id in (select t."id" from "<table>" t where <p1> and … and <pn>)`
— one semi-join over one sequential scan of the host table's JSONB column per statement, however
many keys are filtered (R-4). No index is added: the predicates (`->>` text, ranges, array
membership) are not served by a GIN `jsonb_path_ops` index, and the admin lists' existing filters
already scan. SC-002's dataset (> one page, up to 2 000 matches) is well inside that. A per-key
expression index is the follow-up if a measured list is slow; recorded under Risks.

**Backstops** (threat model F-1). The caps (10 keys, 100 `in` values, 8000-character parameter)
bound the predicate; the Orders list's `pageSize` cap and `ORDER_EXPORT_MAX_ROWS` (10 000) bound
the rows materialised. The Quote Request whole-set read has no row cap — that is #317's subject,
not this feature's (R-9). **There is no statement timeout** to name: no `statement_timeout` is set
anywhere on `fda284a45`. *Rejected:* adding one here — a per-request timeout is a platform
connection setting affecting every module, and the one-scan shape plus the caps already bound the
statement this feature adds.

## R-17 Threat-model dispositions (2026-10-16; no Critical or High)

| Finding | Applied in |
| --- | --- |
| F-1 DoS through many keys | R-4 (one condition), R-6 (caps 10 / 100, port re-parses), R-16 (backstops, no timeout); T001, T018 |
| F-2 raw fragment reuse | R-4; contract §1.4, §4; T023 (counts, payment counts, total and CSV row count agree), T025, T031, T036 |
| F-3 repeated or non-string parameter | R-9; contract §1.2, §5.1, §5.3; T023, T029, T033 (two keys, repeated parameter) |
| F-4 prototype keys | contract §1.2, §1.4, admin-surfaces §1.3; T018, T038 (`constructor`) |
| F-5 key rendering | admin-surfaces §2; T044 (`<img onerror>` key) |
| F-6 lost update in the editor | R-12; admin-surfaces §3; T055; `If-Match` deferred to value-carry |
| F-7 internal metadata to list-only operators | R-10; contract §1.3, §5.1; T018 (DTO members) |
| F-8 `cardValues` as a bypass | R-8; contract §5.3; T033 |
| F-9 SQL injection | contract §1.4 SQL rules; T018 (bound parameters, no `::date`, hostile values) |
| F-11 off state beyond `POST` | T011 (PATCH, DELETE and option sub-routes for `quote_request`) |
| F-13 board reference regex | contract §1.2 (confirmed: `crm.ts:285-287`) |
