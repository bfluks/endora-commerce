---
'@endora-commerce/mod-custom-fields': minor
---

**Behaviour change for API clients.** Three 409 refusals on the custom-field definition routes no longer share `CUSTOM_FIELD_DEFINITION_INVALID` and an English message:

- removing an option records still hold answers `CUSTOM_FIELD_OPTION_IN_USE`, with `details.value` and `details.label`;
- changing a definition's value type while records hold values answers `CUSTOM_FIELD_VALUE_TYPE_LOCKED`, with `details.key`;
- creating a customer-visible definition over values a deleted field left answers `CUSTOM_FIELD_STORED_VALUES_EXIST`, with `details.key`.

Each has a sentence in English and Polish naming what it refuses. A list filter with an inverted range (a minimum above its maximum, a start date after its end) is refused as a validation failure rather than answered with an empty list.
