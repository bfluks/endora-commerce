---
'@endora-commerce/mod-custom-fields': minor
---

Publishes `customFieldListFilterPort`, the seam the admin lists of other modules use to filter on custom fields.

- `listFilterable(entityType)` answers the fields a list offers: the served definitions of the type whose list-filter option is on, ordered, with their labels and options and nothing else.
- `condition(entityType, filters)` turns a request's custom-field filters into one server-side condition over the entity's own table, every key and value bound. A filter on a field the list does not offer is refused with a failure naming every such key, which the hosts answer as 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`; more than 10 keys or 100 chosen values in total is refused before anything is read.
- An operator that does not apply to the field's type (`contains` on a Yes/No field, a range on an options field) is refused as a validation failure rather than ignored, and so is an inverted range (a minimum above its maximum, a start date after its end) rather than answered with an empty list.
- A Yes/No filter matches a stored *yes* or *no* only; a record without a value matches neither. A date range compares only a stored `YYYY-MM-DD` date and a number range only a stored number, so a value stored under an earlier type neither matches nor fails the list.
