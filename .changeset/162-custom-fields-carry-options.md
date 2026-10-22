---
'@endora-commerce/mod-custom-fields': minor
---

Custom-field definitions can carry their values to Quote Requests, Orders and Sales Opportunities.

- **Carry options on definitions.** A definition's `carryTo` names the entity types its values
  carry to when a record of such a type is created from, or joins, a record of the definition's
  own type. `GET /api/v1/admin/custom-fields/entity-types` serves `carryTargets` per type — the
  pairs the registry offers (Quote Request → Order and Opportunity, Order → Opportunity,
  Opportunity → Quote Request and Order), filtered to targets whose owner module is present.
  New column `custom_field_definitions.carry_to` (migration
  `Migration20261020T110920CustomFieldsDefinitionCarryTo`); every existing definition carries
  nothing, and turning an option on or off changes no stored value.
- **Configuration refusal.** Turning a target on is judged once, in the definition Command:
  `422 CUSTOM_FIELD_CARRY_INCOMPATIBLE` with `details.code` `target_missing`,
  `value_type_mismatch`, `options_missing` (`details.missingOptionValues` as text,
  `details.missingOptionValueList` as a list), `audience_mismatch`, `pair_unsupported` or
  `target_unavailable`, and a sentence in the request's language. A target already on is never
  judged again, so later changes to either field are allowed. The audit entries of
  `custom_fields.definition.*` carry `carryTo`.
- **Retention while an owner is off.** A carry to a type whose module is switched off is not
  served and not offered, a save made meanwhile keeps it, and it is served again when the module
  returns.
- **`customFieldCarryPort`** (`CustomFieldCarryPort` from `@endora-commerce/contracts`) computes
  which values carry into a target record's bag — empty target fields only, the value judged by
  the target definition — and writes nothing; the module owning the target persists the answer.
- **`./ports`:** `CustomFieldDefinitionApplyApi.applyCreate` takes the new
  `CustomFieldDefinitionApplyCreateInput` (the create request with `carryTo` optional). A host
  names no carry target; one it named outside the registry's pairs is refused
  (`carry_incompatible`).
