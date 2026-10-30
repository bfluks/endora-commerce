---
'@endora-commerce/mod-crm': minor
---

Opportunities can refer to Opportunities and Projects (`specs/165-task-management/` R-5).

- Migration `crm_opportunity_reference_kinds` widens `crm_opportunity_references_target_type_check` to the seven reference kinds; its `down` restores the five.
- An Opportunity's description and notes resolve `[[opportunity:…]]` and `[[project:…]]` references per reader, and the `@@` list offers Opportunities and Projects when their module is on and the reader may read them. A referenced Project shows as unavailable while Projects is off.
- `opportunityReadPort` gains `findByIds` and `search`.
- The tag picker and the board's *Move to…* menu now come from `@endora-commerce/admin-kit`; nothing changes for the user.
