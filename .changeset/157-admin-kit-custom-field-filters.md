---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': minor
---

Custom-field filters for admin lists: one composite, its hook and the pure helpers the Orders, Quote Requests and Opportunities lists share.

**New in `@endora-commerce/admin-kit/components`.**

- `CustomFieldListFilters` — one filter control per custom field a list offers, rendered as grid
  cells for the host's own advanced-filters grid. Props: `idPrefix`, `fields`
  (`CustomFieldListFilterField[]`), `value` (`CustomFieldFilters`), `onChange(key, filter | null)`
  (one key's filter, whole; `null` when nothing of it is left), `language`, and optionally
  `status` (the hook's) with `onRetry`: a placeholder cell while the fields load, and on failure a
  sentence with a *Try again* button. A text field is a search box committed after a 300 ms pause;
  a number is a minimum and a maximum, a decimal comma accepted, also paused; a date is a from and
  a to. Both ranges stack below `sm` with a visible short label on each bound, explain a bound that
  is not a number and an inverted range in a message linked to the input, and send nothing for
  either. A yes/no field is *Any / Yes / No*; a select or multiselect field is a multi-select of its
  options in their order, searchable above eight. Labels follow `label[language]`, then the base
  language, then `labelDefault`. A pending text or number commit is dropped when the value changes
  from outside.
- `useCustomFieldListFilterFields(endpoint)` — `{ fields, status: 'loading' | 'ready' | 'error',
  reload }` from one `GET` of a list's offered-fields endpoint; `reload()` reads it again.
- `readCustomFieldFilterParams(params)` / `writeCustomFieldFilterParams(params, filters)` — the
  filters in an address's `cf.<key>.<op>` parameters (`in` repeated) and back, other parameters
  untouched. A key failing the definition-key grammar and a malformed operator value are dropped;
  an unknown well-formed key is kept for the server to refuse; at most 10 keys and 100 `in`
  values.
- `sanitizeCustomFieldFilters(saved, fields)` — a saved view's filters against the offered fields:
  `{ kept, dropped }`, removed options pruned. `pruneRemovedOptions(filters, fields)` — removes
  options a known field no longer has from filters read from the address.
- `customFieldFilterChips(fields, filters, language, t)` — one `{ id, label, remove, removeLabel }`
  chip per key, the label plain text and `removeLabel` the remove action's accessible name.
- `customFieldDisplayName(fields, key, language)` — how a field is named to the operator: its label
  (language, base language, `labelDefault`), or for a key the list does not offer the key cut to
  64 characters. `resolveCustomFieldLabel(label, labelDefault, language)` — the label rule alone.
- `emptyCustomFieldFilters()`, `withCustomFieldFilter(filters, key, filter | null)` and
  `withoutCustomFieldFilter(filters, key)` — new prototype-free records with one key set or removed. `customFieldFilterRefusal(error)` — the key a
  `CUSTOM_FIELD_FILTER_UNAVAILABLE` refusal names, else `null`. `toCustomFieldFiltersParam(filters)`
  — the `customFieldFilters` request parameter, keys sorted, `null` when empty.
- Types: `CustomFieldListFiltersProps`, `CustomFieldFilterChip`, `CustomFieldFilterTranslator`,
  `CustomFieldListFilterFieldsState`, `CustomFieldListFilterFieldsStatus`.

Every record the helpers return has a `null` prototype, so a key such as `constructor` is an
ordinary key and never an inherited member.

**`@endora-commerce/mod-i18n`** ships the `customFieldFilters.*` keys of the `core` namespace in
English and Polish, which the composite reads; a host needs that version alongside this one.

**`Input`** (`@endora-commerce/admin-kit/ui`) draws its border in the destructive colour while
`aria-invalid` is set.
