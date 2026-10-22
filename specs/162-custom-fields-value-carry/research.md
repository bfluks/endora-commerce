# Research: Custom-field value carry-over between Quote Requests, Orders and Sales Opportunities

**Feature**: `specs/162-custom-fields-value-carry/` (issue #287; the directory number is assigned
when the spec enters its branch — first free number on `origin/master` above the floor in
`specs/pre-migration-history/README.md`). **Builds on** `specs/157-custom-fields-list-filters/`
(issue #286, "the filters feature" below), whose definition editor this feature extends, and on
`specs/155-catalog-order-constraints/`, which rewrites the placement code this feature hooks into.

**Read against** `origin/master` at `3d9ca98cd` (2026-10-19) and the in-flight branch
`feat/155-catalog-order-constraints` at `637c6a3a1`. Line anchors below are `origin/master`'s unless
marked *(feat/155)*; where a file is rewritten by feat/155 the plan cites **symbols**, not lines, and
the Phase 1 drift check re-derives them.

Each decision: **Decision → Rationale → Alternatives rejected**.

---

## R-1 Where the carry options are stored

**Decision.** One column owned by `custom_fields`:
`custom_field_definitions.carry_to jsonb not null default '[]'` — a JSON array of target entity
types (`["order", "opportunity"]`), at most two entries, no duplicates, never the definition's own
type. Exposed as `carryTo: SupportedEntityType[]` on the definition DTO, the create/update schemas
and `CustomFieldDefinitionRecord`.

**Rationale.** The core *interprets* the option (configuration-time refusal, conversion-time
carry), so it is a definition attribute, exactly the argument the filters feature's R-1 makes for
`list_filter`. Spec A-5 / Principle XIV ask for a generic capability: an array of entity-type codes
is one column whatever pairs the registry later allows (R-2), and the spec's *Carry pair* is
"derived, not stored as its own record".

**Alternatives rejected.**
- *A key inside `config`* — `config` is documented as the host's, "stored but never read for
  meaning" (`packages/contracts/src/custom-fields.ts:84-86`,
  `custom-field-definition.entity.ts:73-75`); the core reading it breaks that contract.
- *Three boolean columns (`carry_to_order`, …)* — names host entity types in the core schema
  (XIV) and needs DDL for every new pair.
- *A `custom_field_carry_pairs` table* — the spec says a pair is derived, not a record; a table adds
  FK/cascade questions (definition deleted ⇒ pair row?) that the drift rules (FR-019) answer the
  other way: the option stays as configured.
- *`text[]`* — equivalent; `jsonb` matches the entity's other collection columns (`label`,
  `config`) and MikroORM's `json` type the module already uses.

## R-2 Which pairs are offered — a registry marker

**Decision.** `SupportedEntityMeta` (`custom-field-registry.ts:17-48`) gains
`carryTargets?: readonly SupportedEntityType[]`:

| Source | `carryTargets` |
| --- | --- |
| `quote_request` | `['order', 'opportunity']` |
| `order` | `['opportunity']` |
| `opportunity` | `['quote_request', 'order']` |
| others | absent |

`GET /api/v1/admin/custom-fields/entity-types` serves `carryTargets` per type, **filtered** to
targets whose owner is present (R-12). The editor offers exactly those toggles (US4-4, FR-001).

**Rationale.** The same shape as `managedBy`, `ownerModuleId` and the filters feature's
`listFilter` marker: data in the registry, read generically ("is the target in the list"), never a
branch on which host it is. `no-entity-capability-logic.test.ts` stays green (it forbids catalog
flags, not registry data).

**Alternatives rejected.** Hard-coding the five pairs in the definition service (host knowledge in
logic, XIV); letting hosts register pairs at boot through a contribution registry (YAGNI — three
first-party hosts, and a registry would need its own presence semantics; the static marker already
follows owner presence through `ownerModuleId`).

**Spec note — Order → Quote Request.** FR-001 says the platform has "no such conversion". It has
one: a buyer's *clone to quote* (`packages/modules/orders/src/backend/services/order-clone-to-quote-service.ts`,
"Reorder & clone-to-quote" in `packages/contracts/src/orders.ts`). The plan follows the spec and
does **not** offer the pair; flagged as owner question Q4.

## R-3 One compatibility rule, one home, three callers

**Decision.** A pure function in `@endora-commerce/contracts` (`custom-fields.ts`):

```ts
assessCustomFieldCarry(
  source: CustomFieldCarryParty,
  target: CustomFieldCarryParty | null,
): CustomFieldCarryIncompatibility[]
// CustomFieldCarryParty = { valueType; audience; options: ReadonlyArray<{ value: string }> }
```

It returns every reason, in a fixed precedence: `target_missing` (target `null`) →
`value_type_mismatch` (types differ — no widening: `select`→`multiselect` and any→`text` are
mismatches) → `options_missing` (select/multiselect: source option values absent on the target,
listed) → `audience_mismatch` (source `internal`, target `customer`). An empty array means
compatible. Callers:

1. **Configuration time** (server, `custom_fields`): refuse turning a carry on (R-4).
2. **The definitions table and the editor** (admin): the "incompatible" mark (FR-020) and the drift
   warnings (FR-019), computed from the page's own definitions list — no dry-run endpoint.
3. **Conversion time** (server, the carry port, R-5): `target_missing`, `value_type_mismatch` and
   `audience_mismatch` from this function; the option question is asked **per value** instead
   (spec edge case "compatibility is re-checked per value at conversion"; FR-010 "a value that does
   not satisfy the T definition").

**Rationale.** Three places must agree on one rule; a pure function with no SQL and no I/O is
exactly what `contracts` may carry to the browser (the filters plan refused contracts only for a
SQL builder). Precedent: guards (`isCustomFieldValidationFailure`) and pure evaluators already live
there.

**Alternatives rejected.** A server-computed `carryStatus` member on each definition DTO (the
mark would need N×M work per list read, and the editor would still need the rule client-side for
*hypothetical* edits); a `POST …/carry-impact` dry-run endpoint (a round trip per keystroke-level
change, a new route and permission surface, no gain over a pure function); duplicating the rule
in the admin (two statements drift).

## R-4 Configuration-time refusal (FR-003, FR-011) — owner ruling C5 (c), first half

**Decision.** In the definition **Commands** (`createDefinitionCommand`, `updateDefinitionCommand`,
`packages/modules/custom_fields/src/backend/commands/definition-commands.ts`), on the transaction's
`em`:

- compute `added = next.carryTo − current.carryTo` (all of `carryTo` on create);
- for each added target: refuse `pair_unsupported` if it is not in the source type's
  `carryTargets`; `target_unavailable` if the target type's owner module is not present (the write
  twin of R-12's hiding); otherwise load the same-key target definition with its options and run
  `assessCustomFieldCarry`; the first reason refuses;
- a target **already** in `current.carryTo` is never re-judged — a drifted carry stays as configured
  (FR-019) and a PATCH that re-sends it is not refused.

The refusal is a new `CustomFieldDefinitionError` code `carry_incompatible` carrying
`details = { code: <reason token>, targetEntityType, key, sourceValueType?, targetValueType?,
missingOptionValues? }`, mapped by `routes.admin.ts`' `toHttp` to **422
`CUSTOM_FIELD_CARRY_INCOMPATIBLE`** — a minted code declared with tokens
`['target_missing', 'value_type_mismatch', 'options_missing', 'audience_mismatch',
'pair_unsupported', 'target_unavailable']` so the envelope picks `errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.<token>`
in the request's language and fills it from `details` (`packages/platform/src/http/error-envelope.ts`,
the `refusalToken` / `messageParams` step). The editor renders its own sentence from `details`
(it can name the target *type* in the operator's language, which a backend parameter cannot).

**Rationale.** Inside the Command the read of the target and the write of the source share one
transaction, and the audit entry (`custom_fields.definition.updated`, `snapshotDefinition` gains
`carryTo`) is the FR-002 audit. One minted code with tokens follows the precedent of
`QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE` (`packages/modules/quote_requests/src/manifest.ts:334`).

**Alternatives rejected.** Reusing `CUSTOM_FIELD_DEFINITION_INVALID` (its sentence is generic and
it carries no tokens; the reason would reach a Polish operator in English only); refusing in the
route before the Command (a race with a concurrent target edit, and the apply seam would bypass it);
re-judging every carry on every PATCH (would make an unrelated label edit fail after drift — the
opposite of FR-019).

## R-5 The carry port — `custom_fields` computes, never writes

**Decision.** `custom_fields` publishes `customFieldCarryPort` (contract interface
`CustomFieldCarryPort` in `packages/contracts/src/custom-fields.ts`):

```ts
plan(input: {
  sourceType: SupportedEntityType;
  targetType: SupportedEntityType;
  sourceValues: Record<string, unknown>;
  targetValues: Record<string, unknown>;
}): Promise<CustomFieldCarryPlan>;
// CustomFieldCarryPlan = { values: Record<string, unknown>; carried: string[]; skipped: CustomFieldCarrySkip[] }
// CustomFieldCarrySkip = { key: string; reason: CustomFieldCarrySkipReason }
// CustomFieldCarrySkipReason = 'target_missing' | 'value_type_mismatch' | 'audience_mismatch' | 'value_invalid'
```

Algorithm, per source definition (read through the per-entity cache, like `validateAndMerge`):

1. If either type's registry owner is not effectively present → return
   `{ values: targetValues, carried: [], skipped: [] }` (FR-005, FR-014: carry nothing, record
   nothing).
2. Consider only source definitions whose `carryTo` contains `targetType` **and** whose source
   value is non-empty (`isEmpty` of `custom-field-value.service.ts:180-182`). A key present in the
   source bag with no live source definition is dormant → ignored (spec: "Dormant source value").
3. If the target bag already holds a non-empty value for the key → kept, not counted, not
   recorded (FR-009, C4 a).
4. Same-key target definition missing → skip `target_missing`; `valueType` differs → skip
   `value_type_mismatch`; source `internal` and target `customer` → skip `audience_mismatch`
   (SC-005).
5. Otherwise coerce the value with the target definition (the value service's `coerce`, exported
   from the same file — `custom-field-value.service.ts:188-240`); an error → skip `value_invalid`;
   success → `values[key] = coerced`, `carried.push(key)`.

Key lookups are prototype-free (`Object.hasOwn`, records built with `Object.create(null)` and
spread into a plain object only at the end) — `constructor` is a valid key. Unrelated `required`
target fields are never consulted (spec edge case), so the host must **not** run
`validateAndMerge` over the merged bag at creation.

**Rationale.** Principle XIV: "the generic layer MUST NOT write into host tables or audit host
writes … calling the generic layer only to validate incoming values and to read definitions". The
host keeps its record, its write and its audit; the port is the `validateAndMerge` pattern with a
different question. A separate port keeps `CustomFieldValuePort`'s stubs untouched (D-97.3 makes
every port method required, so widening an existing port breaks every fake).

**Alternatives rejected.** `custom_fields` writing the target row (XIV, Principle I); each host
re-implementing the rule (three copies of type/audience/option logic); one cross-module
transactional apply seam handing the port an `EntityManager` (D-169: a read handed an `em` reopens
a write seam).

## R-6 Who calls the port: always the **target's** host, with its own current bag

**Decision.** The module that owns the target record calls `plan` with the target's current
values and writes `values` in **its own** write, recording `skipped` on its own record:

| Pair | Caller | Where |
| --- | --- | --- |
| Quote Request → Order | `orders` | inside placement's transaction (R-7) |
| Quote Request → Opportunity, Order → Opportunity | `crm` | inside the create or link Command (R-9) |
| Opportunity → Quote Request | `quote_requests` | inside its own receiver Command (R-10) |
| Opportunity → Order | `orders` | inside its own receiver Command (R-10) |

**Rationale.** FR-009 (fill-empty) needs the target's current bag; FR-013 wants the values written
with the creation or link; FR-015 wants sources read through published ports. Each row satisfies
all three with no module reading another's table.

## R-7 Quote Request → Order at placement (US1)

**Decision.** In `OrderService.placeOrder`, after the basket's quote source is vouched and before
`tx.create(Order, …)`:

- the vouched Quote Request **record** is already in hand on feat/155's shape —
  `#vouchedQuoteRequestSource` returns `QuoteRequestSourceAssessment { sourceQuoteRequestId,
  quoteRequest, honoursExemptions }` *(feat/155: `order-service.ts` `#assessQuoteRequestSource`)*;
  `quoteRequest.customFieldValues` comes from `QuoteRequestReadPort`
  (`quote-request-read-port.ts:111`);
- only when `sourceQuoteRequestId !== null` (vouched): `plan({ sourceType: 'quote_request',
  targetType: 'order', sourceValues: quoteRequest.customFieldValues, targetValues: {} })`;
- `customFieldValues: plan.values` joins the `tx.create(Order, …)` call; for a non-empty
  `plan.skipped`, one system note (R-8) is created on `tx` in the same transaction;
- for an impersonated placement the existing `order.place_on_behalf` audit entry's `stateAfter`
  gains `carriedCustomFieldKeys: plan.carried` when non-empty (US1-5 is visible in the one audit
  trail placement already has); buyer checkout gains no audit (FR-013).

`quote_requests` off ⇒ `this.neighbours.quoteRequestRead()` is `null` ⇒ nothing is vouched ⇒
nothing carried (FR-014). The port is resolved per call through `lazyPort<CustomFieldCarryPort>`;
`custom_fields` is `nonDeactivatable`, so no presence decision is needed and no `catch` is written
(`check:port-catches`).

**Rationale.** The read is at placement time (spec "Concurrent edits"), under the same advisory
lock that makes the vouching true, and the value is part of the row the transaction commits — so
`order.created.v1` subscribers (CRM, R-9) see it.

**Alternatives rejected.** A post-commit `order.custom_fields.update` Command (a separate write,
FR-013; and CRM's subscriber could read the Order before it); carrying at `convert-to-order` into
the cart (carts own no custom fields; the cart is not the target).

**Dependency.** On `origin/master` the vouch returns only an id (`order-service.ts:1328-1357`);
feat/155 rewrites this region (`QuoteRequestSourceAssessment`). This phase is planned against
feat/155's shape and **must not start before feat/155 has merged** (Phase 1's drift check greps for
`QuoteRequestSourceAssessment`).

## R-8 The Order's skip record — an author-less system note (FR-010a)

**Decision.** `order_comments` gains `system_note jsonb null` (an `orders` migration). A comment
whose `system_note` is not null is a system note:

```jsonc
{ "kind": "custom_field_carry_skipped",
  "source": { "entityType": "quote_request" | "opportunity", "recordId": "<uuid>", "reference": "<business number>" },
  "skipped": [{ "key": "order_source", "reason": "value_invalid" }] }
```

written with `authorAdminUserId = null`, `authorCustomerAccountId = null`,
`isCustomerVisible = false`, `notifyCustomer = false`, and `body` = an English fallback sentence.

- `OrderCommentService.listForCustomer` adds `systemNote: null` to its filter (defence in depth
  beyond `isCustomerVisible: true`); no API-key route serves comments (`routes.external.ts` has
  none — verified).
- The admin DTO (`orderCommentSchema`, `packages/contracts/src/orders.ts:834`) gains
  `systemNote: OrderCommentSystemNote | null` (optional on the wire for customer replies, which
  never carry it). `OrderDetail.tsx` renders a "System" author and a translated sentence from
  `systemNote` (the `body` is the fallback).
- No path edits or deletes a comment today; the new kind gains none.
- Written on placement's `tx` (R-7) or the receiver Command's `em` (R-10) — never through
  `addByAdmin`, whose non-terminal check and notify path do not apply. The `command-coverage-ignore`
  precedent of `order-comment-service.ts:43-44` covers the insert inside placement; inside the
  receiver Command it is part of the Command's write.

**Rationale.** The note is persisted and read later by any number of administrators in their own
languages — `specs/conventions/module-i18n.md`'s "cannot resolve the reader's language" case: ship a
key, its params and an English fallback; the consumer translates. One nullable column keeps
existing comments untouched (FR-010a's last sentence).

**Alternatives rejected.** A `kind` enum column plus a frozen English `body` (no structured params
to translate); an `author_kind` column (one more column with the same information as "both authors
null"); a separate `order_system_notes` table (the order detail already renders one thread; a
second list is a second surface for the same thing); an Order *event history* (the spec rules
comments, clarification of 2026-10-16).

## R-9 Order / Quote Request → Opportunity (US2) inside CRM's own Commands

**Decision.**

- **Creation for a document** — `OpportunityAutoCreateService.#placedOrder` /
  `#submittedQuoteRequest` (`opportunity-auto-create-service.ts:144-234`) already hold the source
  record (`OrderRecord.customFieldValues`, `packages/contracts/src/orders.ts:1011`;
  `QuoteRequestRecord.customFieldValues`). `AutomaticOpportunityInput`
  (`opportunity-service.ts:121-129`) gains `carry?: { sourceType; sourceValues }`.
  `createForDocument` calls `plan(… targetValues: {})` **before** the Command and hands
  `customFieldValues: plan.values` to `#createCommand` (which already stores
  `input.customFieldValues`, `opportunity-service.ts:398`) plus the skip list, which the Command
  adds to its `after` as `customFieldCarry: { source, carried, skipped }`.
- **Joining** — `OpportunityLinkService.linkOrderPlacedFromQuoteRequest(order)`
  (`opportunity-link-service.ts:267-285`) passes `carry: { sourceType: 'order', sourceValues:
  order.customFieldValues }` into `linkAutomatically`; inside the `crm.opportunity.link_add`
  Command (`:209-258`), after `loadOpportunity`, it calls `plan` with `parent.customFieldValues`
  as the target bag, assigns `parent.customFieldValues = plan.values` when `carried` is non-empty,
  and adds `customFieldCarry` to `after` when anything was carried or skipped.
- **Origin links** (a document created from an Opportunity) carry **Opportunity → document only**
  (R-10); they pass no `carry` into `linkAutomatically`.
- The skip entry **is** the create/link audit entry: the Opportunity's change history is built
  from the audit log (`opportunity-history-service.ts`, `OpportunityHistory.tsx`), not from
  `crm_opportunity_events` (which are calendar events — see R-17).

**Rationale.** FR-013 "system for CRM's automatic creation or join": both Commands already run in
the subscriber's system scope. FR-012: `linkOrderPlacedFromQuoteRequest` already refuses a parent of
another Organization (`:279`), and `createForDocument` takes the document's own Organization.
FR-008 "once": `linkAutomatically` returns `already-linked` without a Command for a re-delivered
event (`:210-213`), so no second carry or entry.

**Alternatives rejected.** A follow-up `crm.opportunity.update` Command after the link (a separate
write, two history entries); reading the document's table from CRM (FR-015).

## R-10 Opportunity → Order / Quote Request (US3): pushed after the origin link

**Decision.** `OpportunityOriginLinkService.link` (`opportunity-origin-link-service.ts:89-109`),
when `linkAutomatically` answers **`linked`** (not `already-linked`), pushes the Opportunity's
values to the document's owner:

- `quote_requests` publishes `quoteRequestCustomFieldCarryPort`, `orders` publishes
  `orderCustomFieldCarryPort` — both implementing one contract interface:

  ```ts
  interface CustomFieldCarryReceiverPort {
    receiveCarriedValues(input: {
      recordId: string;
      organizationId: string;
      source: { entityType: 'opportunity'; recordId: string; reference: string; values: Record<string, unknown> };
    }): Promise<CustomFieldCarryReceipt>;
  }
  // CustomFieldCarryReceipt = { outcome: 'applied' | 'not-found'; carried: string[]; skipped: CustomFieldCarrySkip[] }
  ```

- The owner runs **one Command** (`quote_request.custom_fields.carry` /
  `order.custom_fields.carry`): load the record by id; if it is missing or its
  `organizationId !== input.organizationId` answer `not-found` (FR-012, defence in depth; the same
  answer for both so nothing leaks); `plan(…, targetValues: record.customFieldValues)`; assign
  `plan.values` when anything was carried; record a skip entry (QR: a `custom-field-carry-skipped`
  event, R-11; Order: a system note, R-8) on the same `em`; `after = { customFieldValues,
  customFieldCarry }`. Nothing carried and nothing skipped ⇒ `skipAudit: true` and no write.
- CRM asks `quoteRequests.isPresent()` before resolving the QR receiver
  (`crm-quote-requests.ts` pattern; manifest `nonBindingDependencies` entry, `degrades-without`);
  `orders` is a binding dependency of `crm` already.

**Rationale.** "The rule that decides the link decides the carry" (US3-2) is satisfied by
construction: the carry happens only after, and only because, the origin-link rules
(`:89-109`: Opportunity exists, same Organization, the creating administrator reaches it) linked
the document. The edges run in the existing direction (`crm` → `orders`, `crm` → `quote_requests`);
`orders` and `quote_requests` keep handing `origin` on unread ("neither of those modules knows the
word", `:12-16`).

**Deviation to confirm (owner question Q1).** FR-013 lists "operator for admin creation". The link
is made by CRM's subscriber **after** the document's creation committed, in a system scope; a
Command's actor is always the ambient context (`packages/platform/src/commands/command-bus.ts:48`),
so the carry is attributed to the **system**, in a Command of the document's owner, linked to the
operator only through the document's own creation entry. The alternative that honours "operator"
literally — `orders` and `quote_requests` pulling the Opportunity's values from a CRM port while
creating the document — makes both modules read CRM's `origin` (today deliberately opaque) and adds
`orders → crm` / `quote_requests → crm` edges against the existing `crm → orders` dependency. The
plan recommends the push and asks the owner to confirm.

**Alternatives rejected.** `orders` subscribing to `crm.opportunity.document_linked.v1` and pulling
(reopens the `orders ↔ crm` cycle through a CRM port); a cross-module transactional seam (D-169).

## R-11 What a "history entry" is, per target — one entry per conversion

| Target | Entry | Shape |
| --- | --- | --- |
| Opportunity | the `crm.opportunity.create` / `crm.opportunity.link_add` audit entry | `after.customFieldCarry = { source: { entityType, recordId }, carried: string[], skipped: CustomFieldCarrySkip[] }` |
| Quote Request | a `QuoteRequestEvent` of new type `custom-field-carry-skipped` | `payload = { type, source, skipped }`; admin-only |
| Order | an `OrderComment` system note | R-8 |

**One entry per conversion**, naming every skipped key once with its reason. SC-004 ("every skipped
carry produces exactly one history entry") reads as "appears in exactly one entry"; owner question
Q3 asks to confirm (the alternative, one entry per key, is a loop in three writers and nothing
else).

The QR event type needs the `qre_event_type_check` constraint widened by a `quote_requests`
migration — precedent `20261017T142121_quote_requests_quote_request_event_pdf_sent.ts`, whose
`BEFORE` list this one extends with `'pdf-sent'`. It is added to `ADMIN_ONLY_EVENT_TYPES`
(`customer-projection.ts:67`): the entry names keys and reasons of possibly `internal` fields, so a
buyer never reads it (SC-005 reasoning). Rendering: `history-projection.ts` (`case` beside
`'pdf-sent'`, `:238`) and `RfqHistory.tsx`.

The Opportunity's history renders `customFieldCarry` through `history-fields.ts`
(`LABELLED_HISTORY_FIELDS`) and `OpportunityHistory.tsx`; `src/admin/index.test.ts` holds that every
key an audited state can carry is labelled or silent. Visibility follows the existing
`canSeeCustomFields` gate (`OpportunityHistory.tsx:230`).

All three are persisted, read later by several administrators: key + params + English fallback
(`specs/conventions/module-i18n.md`, case "cannot resolve").

## R-12 Off-state (Principle XVII) and absent-owner retention

**Decision.**

- **Serving**: `GET …/entity-types` filters `carryTargets` by owner presence; `GET …/definitions`
  and `GET …/definitions/:id` strip from `carryTo` every target whose owner is absent (FR-005 "not
  offered"). Definitions of an absent owner's type are already not served
  (`routes.admin.ts:82-86`; `quote_request` follows `quote_requests` from the filters feature's
  FR-005a).
- **Writing**: a PATCH's `carryTo` is merged with the hidden entries — `next = body.carryTo ∪
  (current.carryTo ∩ absentTargets)` — so a save while `crm` is off never drops a retained
  "carry to Opportunity" (FR-005 "retained"). Turning on a target whose owner is absent is refused
  `target_unavailable` (R-4).
- **Converting**: the port returns an empty plan when either side's owner is absent (R-5); `crm`
  off ⇒ no CRM subscriber runs ⇒ nothing carried into or out of Opportunities; `quote_requests` off
  ⇒ no vouched source at placement, and CRM does not call the QR receiver. No replay on return:
  nothing is queued (FR-014).

**Rationale.** Off behaves as if never installed; data and configuration survive
(`specs/conventions/module-activation.md` items 5–6).

## R-13 Tenancy (Principle XI)

No tenant-scoped entity is added. `custom_field_definitions` stays `@GlobalEntity()`;
`order_comments` is `@GlobalEntity()` and is reached through the order. Every carry runs between
records of one Organization: placement vouches the QR's Organization (`judgeQuoteRequestSource`),
CRM's join and origin link check it, and both receiver ports re-check it and answer `not-found`
for a mismatch (indistinguishable from a missing record). Cross-tenant tests: Phase 5 (receiver
with a foreign Organization), Phase 4 (join refused across Organizations carries nothing).

## R-14 The admin surface (US4) — extending the filters feature's editor

**Decision.**

- **Toggles** — inside `DefinitionBehaviourFields` (filters feature, `contracts/admin-surfaces.md`
  §3), one checkbox "Carry value to <type>" per `entityTypeInfo.carryTargets` entry, by **additive
  props** (`value.carryTo`, `onChange` gains `carryTo`); the create form and the editor both get
  them. The editor's *Save* sends `carryTo` only when changed (the filters feature's
  changed-members rule).
- **Refusal** — 422 `CUSTOM_FIELD_CARRY_INCOMPATIBLE` keeps the dialog open with a sentence built
  from `details` naming the missing field / the type pair / the missing option values / the
  audience rule.
- **Table** — a *Carries to* column (translated type labels, "—" when none), and per target an
  "Incompatible" badge with the reason (text and `title`) when
  `assessCustomFieldCarry(source, sameKeyTarget)` is non-empty (FR-020). Computed client-side from
  the one definitions list the page already loads.
- **Drift warnings (FR-019)** — a pure module-local helper
  `carryCounterpartsBrokenBy(change, definitions)` answers which enabled carries a hypothetical
  change turns from compatible to incompatible (target: option removed, audience → `customer`,
  deleted; source: option added that a target lacks, audience → `internal`, deleted — a deleted
  definition warns for every enabled carry it is part of). Value type is not editable in the UI.
  Each change site asks before it acts, in-dialog (no native `confirm`): the editor's *Save*
  (audience is not in the dialog today, so only option add/remove reach this), the Options
  section's add/remove, the table's audience select and *Delete*. The warning lists
  "<entity type> · <key>" for every counterpart; the operator may proceed.
- **No** new route, page, permission code (FR-017), palette action or nav entry.

**If the filters feature slips (spec line 17).** Phases 1–6 and 8–9 of this plan do not touch the
editor and can proceed. Phase 7 is the only one that needs it. If the filters feature has not
merged when Phase 7 is due, Phase 7 ships `DefinitionBehaviourFields` **itself** — the carry
toggles only — rendered in master's create form and in a small module-local
`CarryOptionsDialog` opened from a row action, with the same props contract; the filters feature
then adds its `listFilter` checkbox to the same block. The warnings and table column are
unaffected. This fallback is not recommended (it makes the two features collide in one file) but it
is buildable.

## R-15 Out of the conversion set (owner questions)

- **Manual links** — an operator linking an existing document on the Opportunity's *Links* tab
  (`OpportunityLinkService.add`, action `crm.opportunity.link_add` with `linkSource: 'manual'`). FR-008
  enumerates creation, joining from a quote, and origin linking; a manual link is none of them. The
  plan **does not** carry on manual links (Q2).
- **Order → Quote Request** — see R-2 (Q4).
- **Re-submission / revision of a Quote Request** — not a conversion; nothing carried.

## R-16 Module edges and manifests

| Edge | Port | Manifest |
| --- | --- | --- |
| `orders` → `custom_fields` | `customFieldCarryPort` | `orders` resolves `customFieldValueService` today without `custom_fields` in `dependencies`; if `check:port-dependencies` reports the new edge, add `custom_fields` (non-deactivatable — no activation consequence). The filters feature's T026 asks the same question first. |
| `crm` → `custom_fields` | `customFieldCarryPort` | already in `dependencies` |
| `quote_requests` → `custom_fields` | `customFieldCarryPort` | already in `dependencies` |
| `crm` → `orders` | `orderCustomFieldCarryPort` | already in `dependencies` |
| `crm` → `quote_requests` | `quoteRequestCustomFieldCarryPort` | new `nonBindingDependencies` entry, `kind: 'degrades-without'`, beside the existing `quoteRequestReadPort` one (`packages/modules/crm/src/manifest.ts`), `whenAbsent`: "Values of Sales Opportunities are not carried into Quote Requests created from them" |

`check:port-shape`, `check:port-dependencies`, `check:port-catches` and `check:module-boundary`
judge these.

## R-17 Spec "Current state" corrections (no requirement changes)

The spec was written at `fda284a45`; these anchors moved or were misread. None changes a
requirement; the product owner may fold them into the spec when it enters the branch.

| Spec says | Actually (`origin/master` `3d9ca98cd`) |
| --- | --- |
| Opportunities have an event history in `crm-opportunity-event.entity.ts` | That entity is **calendar Events** (meetings, reminders). The *Change history* tab is built from the **audit log** (`opportunity-history-service.ts`, `routes.history.ts`, `OpportunityHistory.tsx`). R-9/R-11 use the audit entry. |
| `quote_requests` toggleable at `manifest.ts:186` | `activation` is at `packages/modules/quote_requests/src/manifest.ts:232` (`:186` is the admin-search contribution) |
| Placement `order-service.ts:1777-1792`, `:1318-1336`, `:1344-1364`, `:2217-2221` | master: vouch `:1328-1357`, `placeOrder` `:1359`, the vouch call `:1828-1833`, `tx.create(Order` `:1835`, impersonation audit `:2268-2278`; **feat/155 rewrites all of these** (`QuoteRequestSourceAssessment`, vouch at `:1395`, `tx.create` at `:1991`, audit at `:2433` on `637c6a3a1`) |
| `rfq-service.ts:886-1010`, `:1001` | `convertToOrder` `:887`, stamp `:1002` (feat/155: `:990`, `:1105`) |
| US3-2 "operator lacks `crm:write`" | The origin rule checks that the creating administrator **reaches the Opportunity's Organization** (`opportunity-origin-link-service.ts:96-101`), not `crm:write`. The carry follows that rule (R-10). |
| "Order → Quote Request — the platform has no such conversion" | A buyer's clone-to-quote exists (R-2). Requirement unchanged pending Q4. |

## R-18 Sequencing against the work in flight

- **feat/155 (catalog-order-constraints)** rewrites the placement region R-7 hooks into, and edits
  `rfq-service.ts`, `quote-request-read-port.ts`, `orders/index.ts`, `orders/routes.ts`,
  `quote_requests/off-state.test.ts`, `contracts/orders.ts` and `quote-requests.ts`. This feature
  starts **after feat/155 has merged** (it is at its final gate).
- **The filters feature** owns the editor (Phase 7 here) and edits the same `custom_fields` core
  files as Phases 1–2 here (entity, migration registry, registry, `contracts/custom-fields.ts`,
  `routes.admin.ts`, `definition-commands.ts`, `CustomFieldsPage.tsx`). Build it **first**; this
  feature branches from `origin/master` once it has merged, or stacks on its branch (a real
  dependency, per the rolling-delivery rule).
- **feat/156 (asset-stable-url)** touches `assets_library` only; shared artefacts
  (`migrations-registry.generated.ts`, `reference-ledgers.ts`, `errors.ts`, `openapi-baseline.json`,
  `test-server.ts`) are regenerated or rebased mechanically.
