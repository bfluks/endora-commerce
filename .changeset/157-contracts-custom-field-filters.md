---
'@endora-commerce/contracts': minor
---

Shared shapes for filtering admin lists on custom fields, and the code that refuses a filter a list does not offer.

**For a consumer of the contracts.**

- `customFieldFilterSchema` (type `CustomFieldFilter`) is one custom field's filter: `contains`,
  `in`, `is`, `min`/`max` (decimal strings) and `from`/`to` (calendar dates), strict. Which
  operators apply is the field's value type to say: the admin lists refuse any other with 400
  `VALIDATION_FAILED`, and only the CRM board ignores it.
- `customFieldFiltersSchema` (type `CustomFieldFilters`) is a request's filters keyed by
  definition key, with the key grammar of a definition (so `__proto__`, dotted or prefixed keys
  are refused) and two caps: at most `CUSTOM_FIELD_FILTERS_MAX_KEYS` (10) keys and at most
  `CUSTOM_FIELD_FILTERS_MAX_IN_VALUES` (100) `in` values summed over every key.
- `customFieldFiltersQueryParamSchema` reads that record from a `customFieldFilters` query
  parameter holding JSON of at most 8000 characters. It is idempotent: an already-parsed object
  is validated rather than refused, and a repeated parameter is refused.
- `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` carry `listFilter: boolean`;
  the create and update requests accept it optionally (absent on create is `false`, absent on
  update leaves it unchanged). `customFieldEntityTypeInfoSchema` carries `listFilter`, saying
  whether definitions of that type may be marked as list filters. `CUSTOM_FIELD_DEFINITION_ERROR_CODES`
  gains `list_filter_unsupported`.
- `customFieldListFilterFieldSchema` and `customFieldListFilterFieldsResponseSchema` describe the
  fields an admin list offers as filters: key, value type, labels and options only.
- `CustomFieldListFilterPort`, `CustomFieldListFilterCondition`,
  `CustomFieldFilterUnavailableFailure` and the guard `isCustomFieldFilterUnavailableFailure` are
  the in-process seam the `custom_fields` module publishes for these lists.
- `CUSTOM_FIELD_FILTER_OPERATORS` names the operators each value type applies, and
  `assertCustomFieldFilterOperators` throws the `ZodError` naming every operator of a filter that
  does not apply to its field, at `[key, operator]`. `customFieldFilterUnavailable(keys)` builds
  the failure `isCustomFieldFilterUnavailableFailure` narrows. `assertCustomFieldFilterRanges`
  throws the `ZodError` naming an inverted range (a minimum above its maximum, a start after its end).
- `ERROR_CODES` gains `CUSTOM_FIELD_OPTION_IN_USE` (`details: { value, label }`),
  `CUSTOM_FIELD_VALUE_TYPE_LOCKED` and `CUSTOM_FIELD_STORED_VALUES_EXIST` (`details: { key }`).
- `calendarDateSchema` and `isCalendarDate` (a `YYYY-MM-DD` day the calendar has) are published
  from the shared primitives; the CRM schemas use the same one.
- `adminOrdersListQuerySchema` accepts `customFieldFilters`.
- `ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE`: an admin list was asked to filter on a custom
  field it does not offer; its `details` are `{ key, keys }`.

**Same shape, one object.** CRM's `OpportunityFieldFilterSchema` is now
`customFieldFilterSchema` itself; what it accepts is unchanged, and the board's
`OpportunityFieldFiltersSchema` keeps its own 20-field cap.
