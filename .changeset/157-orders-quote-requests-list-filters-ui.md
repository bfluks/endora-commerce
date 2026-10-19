---
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
---

Custom-field filters on the admin Orders and Quote Requests lists. The fields marked as list filters appear among each list's filters, labelled in the operator's language, and are applied on the server. They are deep-linkable (`cf.<key>.<operator>` in the address), shown as removable chips and kept in saved views. A saved filter on a field that is no longer offered is dropped when the view is loaded, with a notice naming it. A filter the server refuses, for instance one carried in an old link, is reported by the field's name with a button that removes it. The Orders CSV export follows the same filters, and is not offered while a refused filter stands.
