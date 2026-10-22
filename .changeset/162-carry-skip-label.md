---
'@endora-commerce/mod-custom-fields': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-crm': minor
---

A custom-field value that was not carried is recorded with the field's label, so its history line can name the field.

- **`customFieldCarryPort`** names every skipped key with the **source** definition's label as
  it reads at that moment — `label: { labelDefault, labels }` — a `target_missing` skip
  included.
- **Records keep the label.** The Order system note (`systemNote.skipped`), the Quote Request
  `custom-field-carry-skipped` event and its `custom_field_carry_skipped` history entry, and the
  Sales Opportunity audit member `customFieldCarry.skipped` store each skip's label next to its
  key and reason. It is a snapshot: renaming the field later does not change history. Skips
  recorded earlier have no label and read as before.
- An administrator who cannot read custom-field definitions can now be shown which field was
  not carried and why. The values themselves stay visible only to readers with
  `custom_fields:read`.
