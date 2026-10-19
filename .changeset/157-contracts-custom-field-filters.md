---
'@endora-commerce/contracts': minor
---

Shared shapes for filtering admin lists on custom fields, and the code that refuses a filter a list does not offer.

**For a consumer of the contracts.**

- `customFieldFilterSchema` (type `CustomFieldFilter`) is one custom field's filter: `contains`,
  `in`, `is`, `min`/`max` (decimal strings) and `from`/`to` (calendar dates), strict. Which
  operators apply is the field's value type to say; the others are ignored by the server.
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
- `adminOrdersListQuerySchema` accepts `customFieldFilters`.
- `ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE`: an admin list was asked to filter on a custom
  field it does not offer; its `details` are `{ key, keys }`.

**Same shape, one object.** CRM's `OpportunityFieldFilterSchema` is now
`customFieldFilterSchema` itself; what it accepts is unchanged, and the board's
`OpportunityFieldFiltersSchema` keeps its own 20-field cap.
