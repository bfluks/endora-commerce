---
'@endora-commerce/contracts': minor
---

Shared shapes for carrying custom-field values between Quote Requests, Orders and Sales Opportunities, and the code that refuses a carry that cannot work.

**For a consumer of the contracts.**

- `customFieldCarryToSchema` is the list of entity types a definition's values carry to: at most
  `CUSTOM_FIELD_CARRY_MAX_TARGETS` (2) entries, no duplicates.
- `customFieldDefinitionSchema` carries `carryTo` (required on the wire);
  `createCustomFieldDefinitionSchema` defaults it to `[]`; `updateCustomFieldDefinitionSchema`
  takes it optionally, and an absent `carryTo` leaves the stored one unchanged.
- **Required member — type-level change for hand-built fakes.** `CustomFieldDefinitionRecord`
  gains `carryTo: SupportedEntityType[]`, and `CustomFieldEntityTypeInfo` gains `carryTargets`
  (parsed with a default of `[]`): the entity types a definition of that type may carry to.
  A hand-built record or entity-type value now needs the member.
- `assessCustomFieldCarry(source, target)` is the one compatibility rule of a carry pair: it
  returns every `CustomFieldCarryIncompatibility` — `target_missing`, `value_type_mismatch` (no
  widening), `options_missing` (the source option values the target lacks) and
  `audience_mismatch` (an internal value into a customer-visible field) — in that order, `[]`
  meaning compatible. Pure; safe in the browser.
- `CustomFieldCarryPort` (`plan`) answers which values carry into a target bag, as a
  `CustomFieldCarryPlan` of `values`, `carried` keys and `skipped` keys, each a
  `CustomFieldCarrySkip` with a `customFieldCarrySkipReasonSchema` reason (`target_missing`,
  `value_type_mismatch`, `audience_mismatch`, `value_invalid`).
- `CustomFieldCarryReceiverPort` (`receiveCarriedValues`, answering a `CustomFieldCarryReceipt`)
  is how a Sales Opportunity's values are pushed to the Order or Quote Request created from it.
- `orderCommentSystemNoteSchema` (type `OrderCommentSystemNote`) is an author-less system note
  in an Order's comments naming the custom-field values not carried into it;
  `orderCommentSchema` gains an optional, nullable `systemNote` (admin replies only).
- `rfqEventTypeSchema` gains `custom-field-carry-skipped`; `quoteRequestHistoryEntryKindSchema`
  gains `custom_field_carry_skipped`, whose entries carry `customFieldCarry` (the source
  Opportunity and the skipped keys). Admin replies only.
- `CUSTOM_FIELD_DEFINITION_ERROR_CODES` gains `carry_incompatible`, so
  `isCustomFieldDefinitionFailure` recognises a refused carry option.
- `ERROR_CODES.CUSTOM_FIELD_CARRY_INCOMPATIBLE` — 422 when a definition's carry option is turned
  on towards a target that cannot take its values; `details.code` names why (`target_missing`,
  `value_type_mismatch`, `options_missing`, `audience_mismatch`, `pair_unsupported`,
  `target_unavailable`).
