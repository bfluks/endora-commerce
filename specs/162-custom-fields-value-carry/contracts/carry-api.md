# Contract: carry options, the carry port and the receiver ports (`specs/162-custom-fields-value-carry/`)

Everything here is defined in `@endora-commerce/contracts` **before** any route or service uses it
(Principle II). All changes are additive except where §1.3 marks a required member of an in-process
record (a type-level change for hand-built fakes, swept in Phase 1).

## 1. Definition attribute and entity-type marker (`packages/contracts/src/custom-fields.ts`)

### 1.1 Shapes

```ts
export const CUSTOM_FIELD_CARRY_MAX_TARGETS = 2;

export const customFieldCarryToSchema = z
  .array(supportedEntityTypeSchema)
  .max(CUSTOM_FIELD_CARRY_MAX_TARGETS)
  .refine((list) => new Set(list).size === list.length, 'Duplicate carry target');

// customFieldDefinitionSchema            + carryTo: customFieldCarryToSchema            (required on the wire)
// createCustomFieldDefinitionSchema      + carryTo: customFieldCarryToSchema.default([])
// updateCustomFieldDefinitionSchema      + carryTo: customFieldCarryToSchema.optional() (absent = unchanged,
//                                           declared again without the create default, as audience/config are)
// customFieldEntityTypeInfoSchema        + carryTargets: z.array(supportedEntityTypeSchema).default([])
// CustomFieldDefinitionRecord            + carryTo: SupportedEntityType[]               (required)
```

The "never the definition's own type" rule is a server refusal (`pair_unsupported`), not a schema
refine — the update schema does not know the type.

### 1.2 The compatibility rule

```ts
export interface CustomFieldCarryParty {
  valueType: CustomFieldValueType;
  audience: CustomFieldAudience;
  options: ReadonlyArray<{ value: string }>;
}

export type CustomFieldCarryIncompatibility =
  | { reason: 'target_missing' }
  | { reason: 'value_type_mismatch'; sourceValueType: CustomFieldValueType; targetValueType: CustomFieldValueType }
  | { reason: 'options_missing'; missingOptionValues: string[] }
  | { reason: 'audience_mismatch' };

/** Every reason, in this order; `[]` = compatible. Pure: no I/O. */
export function assessCustomFieldCarry(
  source: CustomFieldCarryParty,
  target: CustomFieldCarryParty | null,
): CustomFieldCarryIncompatibility[];
```

- `target === null` → `[{ reason: 'target_missing' }]` and nothing else.
- `valueType` differs → `value_type_mismatch` (no widening: `select`→`multiselect`, any→`text`,
  `number`→`text` all mismatch). When types differ, `options_missing` is not computed.
- Same type `select`/`multiselect`: `missingOptionValues` = source option values not among the
  target's, in source order; labels are ignored; extra target options are fine.
- `source.audience === 'internal' && target.audience === 'customer'` → `audience_mismatch`. All
  other three combinations pass (FR-011).

### 1.3 Record sweep

`CustomFieldDefinitionRecord.carryTo` and `CustomFieldEntityTypeInfo.carryTargets` become required
members. Every hand-built record or entity-type fake in `packages/`, `backend/test` and `admin/test`
gains `carryTo: []` / `carryTargets: []` (Phase 1, the same sweep the filters feature runs for
`listFilter`).

## 2. Error code `CUSTOM_FIELD_CARRY_INCOMPATIBLE` (owner: `custom_fields`)

| Status | Code | `details` | Tokens (`details.code`) |
| --- | --- | --- | --- |
| 422 | `CUSTOM_FIELD_CARRY_INCOMPATIBLE` | `{ code, targetEntityType, key, sourceValueType?, targetValueType?, missingOptionValues? }` (`missingOptionValues` joined with `", "` as a string so it interpolates; also sent as an array under `missingOptionValueList`) | `target_missing`, `value_type_mismatch`, `options_missing`, `audience_mismatch`, `pair_unsupported`, `target_unavailable` |

Lands in **one commit** with its four places: `ERROR_CODES` (`packages/contracts/src/errors.ts`),
`MINTED_ERROR_CODES` (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `to:
'custom_fields'`), `errorCodes` in `packages/modules/custom_fields/src/manifest.ts` as
`{ code, tokens: [...] }`, and `errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE` plus one
`errors.CUSTOM_FIELD_CARRY_INCOMPATIBLE.<token>` sentence per token in
`packages/modules/custom_fields/i18n/{en,pl}.json`. English sentences (final wording is the
designer's):

| Token | English |
| --- | --- |
| *(none)* | This field cannot carry its value there. |
| `target_missing` | No field with the key "{key}" exists on {targetEntityType}. Create it first. |
| `value_type_mismatch` | The field "{key}" on {targetEntityType} is {targetValueType}, but this field is {sourceValueType}. |
| `options_missing` | The field "{key}" on {targetEntityType} lacks these options: {missingOptionValues}. |
| `audience_mismatch` | The field "{key}" on {targetEntityType} is visible to customers, but this field is internal. Change one of them first. |
| `pair_unsupported` | Values of this field cannot be carried to {targetEntityType}. |
| `target_unavailable` | {targetEntityType} is switched off, so values cannot be carried to it. |

## 3. Admin routes (owner: `custom_fields`) — no new route

| Route | Change |
| --- | --- |
| `GET /api/v1/admin/custom-fields/entity-types` | each entry + `carryTargets` (registry marker filtered to targets whose owner is present) |
| `GET /api/v1/admin/custom-fields/definitions`, `GET …/definitions/:id` | each definition + `carryTo` (entries whose owner is absent removed) |
| `POST …/definitions` | accepts `carryTo`; refusals §2 |
| `PATCH …/definitions/:id` | accepts `carryTo` (absent = unchanged); hidden entries retained; refusals §2 only for **added** targets |
| `DELETE …/definitions/:id`, option routes | unchanged (deleting or editing a target is allowed — FR-019) |

`custom_fields:read` / `custom_fields:write` as today (FR-017).

## 4. Ports (plain TS interfaces in `packages/contracts/src/custom-fields.ts`)

### 4.1 `CustomFieldCarryPort` — container name `customFieldCarryPort`, owner `custom_fields`

```ts
export type CustomFieldCarrySkipReason =
  | 'target_missing' | 'value_type_mismatch' | 'audience_mismatch' | 'value_invalid';

/** The source definition's label when the value was skipped (owner ruling 2026-10-21, V3). */
export const customFieldCarrySkipLabelSchema = z.object({ labelDefault: z.string(), labels: localizedLabelSchema });

export interface CustomFieldCarrySkip {
  readonly key: string;
  readonly reason: CustomFieldCarrySkipReason;
  /** Absent on a skip recorded before the snapshot existed. */
  readonly label?: CustomFieldCarrySkipLabel;
}

/** A plain copy for a record to store: key, reason, and a copy of the label when present. */
export function customFieldCarrySkipRecord(skip): CustomFieldCarrySkip;

export interface CustomFieldCarryPlan {
  readonly values: Record<string, unknown>;
  readonly carried: readonly string[];
  readonly skipped: readonly CustomFieldCarrySkip[];
}

export interface CustomFieldCarryPort {
  plan(input: {
    sourceType: SupportedEntityType;
    targetType: SupportedEntityType;
    sourceValues: Record<string, unknown>;
    targetValues: Record<string, unknown>;
  }): Promise<CustomFieldCarryPlan>;
}
```

Semantics: research R-5. No database write, no audit, no event. `custom_fields` is
`nonDeactivatable`, so the gate never closes; callers write no `catch` around it.

**Label snapshot (owner ruling 2026-10-21, V3).** Every skip `plan` answers carries `label` — the
**source** definition's `labelDefault` and per-locale `label` map as they read at that moment; the
source is always known at carry time, so a `target_missing` skip has one too. All three writers —
the Order system note, the Quote Request `custom-field-carry-skipped` event and the Opportunity
audit `after.customFieldCarry` — store it through `customFieldCarrySkipRecord`, so a history line
names the field in the reader's language without a `custom_fields` definitions read. Only the name
and reason are shown that way; the values stay behind `custom_fields:read` where they were.

### 4.2 `CustomFieldCarryReceiverPort` — `orderCustomFieldCarryPort` (owner `orders`), `quoteRequestCustomFieldCarryPort` (owner `quote_requests`)

```ts
export interface CustomFieldCarryReceipt {
  readonly outcome: 'applied' | 'not-found';
  readonly carried: readonly string[];
  readonly skipped: readonly CustomFieldCarrySkip[];
}

export interface CustomFieldCarryReceiverPort {
  receiveCarriedValues(input: {
    recordId: string;
    organizationId: string;
    source: {
      entityType: 'opportunity';
      recordId: string;
      /** The source's business number, for the skip entry's sentence. */
      reference: string;
      values: Record<string, unknown>;
    };
  }): Promise<CustomFieldCarryReceipt>;
}
```

Semantics: research R-10. One Command of the owner; `not-found` for a missing record **and** for one
of another Organization (one answer, no existence leak); `applied` otherwise, even when nothing was
carried. Idempotent in effect: a second call carries nothing more (fill-empty) — CRM calls it once,
on `linked`.

**Owner off.** `quote_requests` off: the port's gate throws `ModuleDisabledError`; `crm` decides
presence first (`CrmQuoteRequests.isPresent()`) and does not call. `orders` is not deactivatable.

## 5. Order comment (`packages/contracts/src/orders.ts`)

```ts
export const orderCommentSystemNoteSchema = z.object({
  kind: z.literal('custom_field_carry_skipped'),
  source: z.object({
    entityType: z.enum(['quote_request', 'opportunity']),
    recordId: uuidSchema,
    reference: z.string(),
  }),
  skipped: z.array(customFieldCarrySkipSchema).min(1), // { key, reason, label? }
});
// orderCommentSchema + systemNote: orderCommentSystemNoteSchema.nullable().optional()
```

## 6. Quote Request history (`packages/contracts/src/quote-requests.ts`)

`rfqEventTypeSchema` + `'custom-field-carry-skipped'`; the history entry DTO for that type carries
`{ source: { entityType: 'opportunity', recordId, reference }, skipped: CustomFieldCarrySkip[] }`
(admin replies only). Each skip keeps the `label` snapshot its event stored (owner ruling 2026-10-21, V3).

## 7. CRM (`packages/contracts/src/crm.ts`)

No route or schema change. `OpportunityHistoryEntry.after` is already an opaque state; its new
member `customFieldCarry` (data-model §4.3) is documented in the history-fields module and labelled
in both bundles.

**The history response varies by caller** (owner ruling P2 = a, 2026-10-21).
`GET /api/v1/admin/crm/opportunities/:id/history` leaves `customFieldValues` out of every entry's
`before` and `after` for a caller without `custom_fields:read` (`OpportunityHistoryService`'s
`mayReadCustomFields`, the `customFields` member of `OwnerReadChecks`, asked once per page); the
rest of each entry, `customFieldCarry` included, is unchanged. A caller holding
`custom_fields:read` receives the values as before. The shape is the same for both callers — the
member is absent, never `null`. Order and Quote Request audit logs are out of this rule's scope.

## 8. Events

No new event name. Existing events carry the values implicitly: `order.created.v1` subscribers
read an Order that already holds its carried values; `crm.opportunity.created.v1` /
`crm.opportunity.document_linked.v1` follow Commands whose `after` records the carry.
