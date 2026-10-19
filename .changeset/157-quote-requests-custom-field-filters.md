---
'@endora-commerce/mod-quote-requests': minor
---

The admin Quote Request list accepts `customFieldFilters`, a JSON object of filters keyed by Quote Request custom-field key, applied on the server and combined as AND with the organization, status and assignment filters. A key the list does not offer is refused with 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` naming it; a malformed value, more than 10 keys or 100 chosen values, or the parameter given twice is 400 `VALIDATION_FAILED`.

`GET /api/v1/admin/quote-requests/custom-field-filters` (`rfqs:handle`) lists the Quote Request custom fields the list offers as filters.

The module's Quote Request custom-field definitions now follow its activation: while `quote_requests` is switched off they are neither offered, served nor writable on the custom-fields admin, and they return unchanged with it.
