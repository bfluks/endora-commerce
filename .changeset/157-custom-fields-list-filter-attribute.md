---
'@endora-commerce/mod-custom-fields': minor
---

**Behaviour change for API clients.** Quote Request custom-field definitions now follow the `quote_requests` module, as Opportunity definitions follow `crm`: while `quote_requests` is switched off, `quote_request` is left out of `GET /api/v1/admin/custom-fields/entity-types`, its definitions are not listed or served by id (404), and every definition and option write answers 409 `CUSTOM_FIELD_HOST_MANAGED`. Nothing is deleted; the definitions and the stored values return unchanged with the module.

Definitions carry `listFilter`, saying whether the admin list of their entity type offers the field as a filter. It is settable on Order, Quote Request and Opportunity definitions; `listFilter: true` on any other entity type is refused with 422 `CUSTOM_FIELD_DEFINITION_INVALID`. Absent on create it is `false`, absent on update it is unchanged, and changing it is one audited write that never touches a record's stored values. Each `entity-types` item carries `listFilter`, saying whether its definitions may be list filters.

The admin custom-fields page no longer offers the Quote request type before the server has said it is offered.
