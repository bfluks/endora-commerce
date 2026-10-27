---
'@endora-commerce/mod-catalog': patch
---

A sales channel's default language now counts as offered on every catalog write and admin read, as it already did on the storefront: a value override, a per-language scope status or a channel URL key in the channel's default language is accepted even when the channel's `languages` list omits it, and the product scopes, scope overview, URL keys and scope context responses list that default among the channel's languages instead of reporting rows in it as orphaned.
