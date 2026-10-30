---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-custom-fields': minor
---

*Project* is a record type of Custom Fields: an operator defines fields on Projects on
`/custom-fields` as on Opportunities, and the Projects module validates, stores and shows them.

**`@endora-commerce/mod-custom-fields`**:

- New entity type `project` (*Project* / *Projekt*), owned by the `projects` module: offered on
  the entity-types listing, and its definitions created, changed or deleted, only while Projects
  is on — while it is off the type is absent and a definition write answers 409
  `CUSTOM_FIELD_HOST_MANAGED`, as for the other owned types. Definitions and stored values are
  kept and served again when Projects is back.
- A Project definition may be marked as a list filter; no carry targets.
- The values live in `projects.custom_field_values`; the definition-change guards and the
  list-filter condition read that column.

**`@endora-commerce/contracts`**:

- `supportedEntityTypeSchema` gains `'project'`. A consumer that switches exhaustively over
  `SupportedEntityType`, or holds a `Record<SupportedEntityType, …>`, gets a compile error until
  it handles the new member.
