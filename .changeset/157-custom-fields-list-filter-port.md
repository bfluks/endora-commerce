---
'@endora-commerce/mod-custom-fields': minor
---

Publishes `customFieldListFilterPort`, the seam the admin lists of other modules use to filter on custom fields.

- `listFilterable(entityType)` answers the fields a list offers: the served definitions of the type whose list-filter option is on, ordered, with their labels and options and nothing else.
- `condition(entityType, filters)` turns a request's custom-field filters into one server-side condition over the entity's own table, every key and value bound. A filter on a field the list does not offer is refused with a failure naming every such key, which the hosts answer as 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`; more than 10 keys or 100 chosen values in total is refused before anything is read.
- A Yes/No filter matches a stored *yes* or *no* only; a record without a value matches neither.
