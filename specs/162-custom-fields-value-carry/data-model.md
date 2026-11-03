# Data model: Custom-field value carry-over (`specs/162-custom-fields-value-carry/`)

Two columns and one widened check constraint, in three migrations owned by three modules. No new
table, no host-record column, no tenant-scoped entity. Everything else is a transient shape (a port
answer, an audit `after` member, an event payload). Migrations are scaffolded, never numbered by
hand (`specs/conventions/module-migrations.md`); each lands with
`pnpm --filter backend run composer:generate` and the regenerated
`backend/src/db/migrations-registry.generated.ts` in the same commit.

## 1. `custom_field_definitions.carry_to` (owner: `custom_fields`)

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `carry_to` | `jsonb` | not null | `'[]'::jsonb` | Entity types this definition's values carry **to** when a record of such a type is created from, or joins, a record of this definition's type (FR-001) |

- **Migration** — `pnpm --filter backend run migration:new -- --module custom_fields --name definition_carry_to`.
  `up`: `alter table "custom_field_definitions" add column "carry_to" jsonb not null default '[]'::jsonb;`
  `down`: `alter table "custom_field_definitions" drop column "carry_to";`
  Every existing definition reads `[]` (default off, FR-001). References no other module's table.
- **Entity** — `CustomFieldDefinition.carryTo: SupportedEntityType[] = []`
  (`packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts`), added to
  `[OptionalProps]`; `@Property({ type: 'json' })`. Still `@GlobalEntity()`.
- **Validation** (in the definition Commands, research R-4):
  - each entry ∈ `supportedEntityTypeSchema`, no duplicates, never the definition's own type, at most
    two entries (Zod, contract `carry-api.md` §1);
  - each **newly added** entry ∈ the source type's registry `carryTargets` (else `pair_unsupported`),
    its owner present (else `target_unavailable`), and `assessCustomFieldCarry(source, target)`
    empty (else the first reason) → 422 `CUSTOM_FIELD_CARRY_INCOMPATIBLE`;
  - entries already stored are never re-judged (FR-019).
- **Absent-owner retention** (R-12) — reads strip entries whose owner is absent; a PATCH merges the
  hidden entries back.
- **Audit** — `snapshotDefinition` (`definition-commands.ts:31-44`) gains `carryTo`, so
  `custom_fields.definition.created` / `.updated` / `.deleted` carry it in `before`/`after` (FR-002).
- **Cache** — no new path: every definition Command publishes `publishInvalidate(entityType)`; the
  carry port reads through the same per-entity cache (5 s TTL fallback). A carry toggled on reaches
  every process within that window; a conversion inside the window uses the previous setting — the
  same consistency every definition change already has.
- **Never written by a conversion.** Turning an option on or off changes no stored value on any
  record and back-fills nothing (FR-004).

### 1.1 Registry metadata (code, not schema)

`SupportedEntityMeta.carryTargets?: readonly SupportedEntityType[]`
(`packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`):

| Entry | `carryTargets` |
| --- | --- |
| `quote_request` | `['order', 'opportunity']` |
| `order` | `['opportunity']` |
| `opportunity` | `['quote_request', 'order']` |
| `category`, `organization`, `customer`, `product` | absent |

## 2. `order_comments.system_note` (owner: `orders`)

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `system_note` | `jsonb` | null | `null` | Present ⇒ the comment is an author-less **system note** written by the platform; its shape below |

- **Migration** — `pnpm --filter backend run migration:new -- --module orders --name order_comment_system_note`.
  `up`: `alter table "order_comments" add column "system_note" jsonb null;`
  `down`: `delete from "order_comments" where "system_note" is not null; alter table "order_comments" drop column "system_note";`
  (the `down` removes the rows the column defined — a system note without its marker would read as a
  staff comment).
- **Entity** — `OrderComment.systemNote?: OrderCommentSystemNote | null`
  (`packages/modules/orders/src/backend/entities/order-comment.entity.ts`), in `[OptionalProps]`.
- **Shape** (`OrderCommentSystemNote`, contract `carry-api.md` §4):

  ```jsonc
  {
    "kind": "custom_field_carry_skipped",
    "source": { "entityType": "quote_request" | "opportunity", "recordId": "<uuid>", "reference": "<business number of the source>" },
    "skipped": [{ "key": "order_source", "reason": "target_missing" | "value_type_mismatch" | "audience_mismatch" | "value_invalid",
                  "label": { "labelDefault": "Order source", "labels": { "pl": "<Polish label>" } } }]
  }
  ```

- **Invariants of a system note row**: `author_admin_user_id is null`,
  `author_customer_account_id is null`, `is_customer_visible = false`, `notify_customer = false`,
  `body` = the English fallback sentence (e.g. *"Custom field values were not carried from quote
  request QR-1042: order_source (the value is not one of this field's options)."*). Written only by
  placement (R-7) and the order receiver Command (R-10), never by a route.
- **Reads** — `listForCustomer` filters `isCustomerVisible: true, systemNote: null`; `listForAdmin`
  returns everything; the admin serializer adds `systemNote`; the customer serializer is unchanged
  (and never receives one). No route edits or deletes a comment.
- **Tenancy** — `@GlobalEntity()` as today; reached only through a scoped order load.

## 3. `quote_request_events.event_type` check (owner: `quote_requests`)

- **Migration** — `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_event_carry_skipped`.
  `up`: drop `qre_event_type_check`; add it again with the twelve current values **plus**
  `'custom-field-carry-skipped'`. `down`: drop and re-add with the twelve values (fails while a
  `custom-field-carry-skipped` row exists, as narrowing any check must). The `BEFORE` list is the
  pdf-sent migration's list plus `'pdf-sent'`
  (`packages/modules/quote_requests/src/migrations/20261017T142121_quote_requests_quote_request_event_pdf_sent.ts`).
- **Entity** — `QuoteRequestEventType` gains `'custom-field-carry-skipped'`
  (`quote-request-event.entity.ts:14-28`); `rfqEventTypeSchema` likewise
  (`packages/contracts/src/quote-requests.ts:83-98`).
- **Payload** — `{ type: 'custom-field-carry-skipped', source: { entityType: 'opportunity', recordId, reference }, skipped: CustomFieldCarrySkip[] }`;
  actor columns null (system), `revisionId` null.
- **Admin-only** — added to `ADMIN_ONLY_EVENT_TYPES` (`customer-projection.ts:67`).

## 4. Transient shapes

### 4.1 `CustomFieldCarryPlan` (the carry port's answer)

`{ values: Record<string, unknown>; carried: string[]; skipped: CustomFieldCarrySkip[] }` —
`values` is the target bag to persist (the input target bag plus the carried keys; never a removed
or overwritten key), `carried` the keys added, `skipped` the keys not carried with a reason and the
source definition's label snapshot `{ labelDefault, labels }` (owner ruling 2026-10-21, V3; optional on
the wire, so rows written before it still parse). `plan` writes nothing.

### 4.2 `CustomFieldCarryIncompatibility` (the pure rule's answer)

```ts
| { reason: 'target_missing' }
| { reason: 'value_type_mismatch'; sourceValueType; targetValueType }
| { reason: 'options_missing'; missingOptionValues: string[] }
| { reason: 'audience_mismatch' }
```

### 4.3 The Opportunity's history member

`after.customFieldCarry = { source: { entityType: 'quote_request' | 'order', recordId }, carried: string[], skipped: CustomFieldCarrySkip[] }`
on `crm.opportunity.create` and `crm.opportunity.link_add` entries; present only when something was
carried or skipped. `customFieldValues` in the same `after` shows the carried values.

### 4.4 Receiver Command audit

`order.custom_fields.carry` / `quote_request.custom_fields.carry`, `objectType` `order` /
`quote_request`, `before: { customFieldValues }`, `after: { customFieldValues, customFieldCarry }`;
`skipAudit: true` when nothing was carried and nothing skipped.

### 4.5 `OrderCommentSystemNote` on the wire

Admin `GET /api/v1/admin/orders/:id/comments`: each item gains `systemNote: OrderCommentSystemNote | null`.
Customer `GET /api/v1/orders/:id/comments`: unchanged shape; system notes never listed.

## 5. What does not change

- No column on `orders`, `quote_requests` or `crm_opportunities`: values go into their existing
  `custom_field_values` JSONB columns, at creation or link.
- `custom_field_options` — option values stay immutable; `option_in_use` still guards removal.
- `crm_opportunity_events` (calendar Events) — untouched.
- No setting, no cache prefix, no pub/sub channel, no permission code, no queue.
