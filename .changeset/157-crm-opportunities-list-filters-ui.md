---
'@endora-commerce/mod-crm': minor
---

Custom-field filters on the Opportunities list, governed by the list-filter option.

- The list offers one filter per Opportunity custom field whose *Use as list filter* option is
  on — whether or not the board card shows the field — beside its existing filters.
- A filter is sent as a `custom:<key>` reference in `fieldFilters`, never with `cardValues`, so
  the list-filter rule applies; any change returns the list to its first page.
- The filters live in the address as `cf.<key>.<op>`, so a filtered list can be bookmarked and
  shared.
- A filter that is no longer available is reported by the field's name, with *Remove this
  filter*.
- The panel shows the first three custom-field filters and puts the rest behind *More filters
  (n)*; a hidden field with an active filter is always shown.
- The board, its card-field filters and its lanes are unchanged.
