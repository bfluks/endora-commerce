---
'@endora-commerce/mod-crm': minor
---

**Behaviour change for API clients.** On `GET /api/v1/admin/crm/opportunities` without `cardValues=true`, a `custom:` reference in `fieldFilters` is now governed by the custom-field definition's list-filter option instead of the board card: a field with the option on is filtered whether or not the card shows it, and a field with the option off is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it. More than 10 `custom:` references or 100 chosen values in total are refused with 400 `VALIDATION_FAILED`. An operator that does not apply to a field's type, or an inverted range (a minimum above its maximum, a start date after its end), is refused with 400 `VALIDATION_FAILED` rather than ignored or answered empty. `builtin:` references keep the card rule. With `cardValues=true` (a board lane continued in the list) and on `GET /api/v1/admin/crm/board` nothing changes.

`GET /api/v1/admin/crm/opportunities/custom-field-filters` (`crm:read`) lists the Opportunity custom fields the list offers as filters.
