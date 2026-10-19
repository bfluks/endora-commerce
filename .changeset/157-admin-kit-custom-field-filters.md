---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
---

Custom-field filters for admin lists: one composite, its hook and the pure helpers the Orders, Quote Requests and Opportunities lists share.

**New in `@endora-commerce/admin-kit/components`.**

- `CustomFieldListFilters` — one filter control per custom field a list offers, rendered as grid
  cells for the host's own advanced-filters grid. Props: `idPrefix`, `fields`
  (`CustomFieldListFilterField[]`), `value` (`CustomFieldFilters`), `onChange(key, filter | null)`
  (one key's filter, whole; `null` when nothing of it is left) and `language`. A text field is a
  search box committed after a 300 ms pause; a number is a minimum and a maximum, a decimal comma
  accepted, also paused; a date is a from and a to; a yes/no field is *Any / Yes / No*; a select or
  multiselect field is a multi-select of its options in their order, searchable above eight.
  Labels follow `label[language]`, then the base language, then `labelDefault`.
- `useCustomFieldListFilterFields(endpoint)` — `{ fields, status: 'loading' | 'ready' | 'error' }`
  from one `GET` of a list's offered-fields endpoint.
- `readCustomFieldFilterParams(params)` / `writeCustomFieldFilterParams(params, filters)` — the
  filters in an address's `cf.<key>.<op>` parameters (`in` repeated) and back, other parameters
  untouched. A key failing the definition-key grammar and a malformed operator value are dropped;
  an unknown well-formed key is kept for the server to refuse; at most 10 keys and 100 `in`
  values.
- `sanitizeCustomFieldFilters(saved, fields)` — a saved view's filters against the offered fields:
  `{ kept, dropped }`, removed options pruned. `pruneRemovedOptions(filters, fields)` — removes
  options a known field no longer has from filters read from the address.
- `customFieldFilterChips(fields, filters, language, t)` — one `{ id, label, remove }` chip per
  key, the label plain text. `customFieldFilterRefusal(error)` — the key a
  `CUSTOM_FIELD_FILTER_UNAVAILABLE` refusal names, else `null`. `toCustomFieldFiltersParam(filters)`
  — the `customFieldFilters` request parameter, keys sorted, `null` when empty.
- Types: `CustomFieldListFiltersProps`, `CustomFieldFilterChip`, `CustomFieldFilterTranslator`,
  `CustomFieldListFilterFieldsState`, `CustomFieldListFilterFieldsStatus`.

Every record the helpers return has a `null` prototype, so a key such as `constructor` is an
ordinary key and never an inherited member.

**`@endora-commerce/mod-i18n`** ships the `customFieldFilters.*` keys of the `core` namespace in
English and Polish, which the composite reads; a host needs that version alongside this one.
