---
'@endora-commerce/mod-custom-fields': minor
---

**Behaviour change for API clients.** Three 409 refusals on the custom-field definition routes no longer share `CUSTOM_FIELD_DEFINITION_INVALID` and an English message:

- removing an option records still hold answers `CUSTOM_FIELD_OPTION_IN_USE`, with `details.value` and `details.label`;
- changing a definition's value type while records hold values answers `CUSTOM_FIELD_VALUE_TYPE_LOCKED`, with `details.key`;
- creating a customer-visible definition over values a deleted field left answers `CUSTOM_FIELD_STORED_VALUES_EXIST`, with `details.key`.

Each has a sentence in English and Polish naming what it refuses.

**An option patch changes only what it names.** `PATCH /api/v1/admin/custom-fields/definitions/:id/options/:optionId` used to fill every member the request left out with its create default, so relabelling an option also cleared its translations, its default flag and its position; it now leaves them as they are, and still never changes the stored `value`. Its audit entry records the option's `label`, `labelDefault`, `isDefault` and `sortOrder` before and after, so a translation, a new default or a move is visible in the audit log rather than looking unchanged.
