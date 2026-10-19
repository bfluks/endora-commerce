---
'@endora-commerce/mod-orders': minor
---

The admin Orders list and its CSV export accept `customFieldFilters`, a JSON object of filters keyed by Order custom-field key (`contains`, `in`, `is`, `min`/`max`, `from`/`to`, by the field's type). The page, the total, both count maps and the export all narrow by it, and it combines with every other filter as AND. A key the list does not offer — unknown, defined on another entity, or with its list-filter option off — is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`, whose `details` name the first refused key and all of them; more than 10 keys or 100 chosen values in total, a malformed bound, or the parameter given twice is 400 `VALIDATION_FAILED`.

`GET /api/v1/admin/orders/custom-field-filters` (`orders:read`) lists the Order custom fields the list offers as filters: key, value type, labels and options.
