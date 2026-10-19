---
'@endora-commerce/mod-custom-fields': minor
---

An existing custom-field definition is editable on `/custom-fields`.

- **Edit dialog.** Each row has an *Edit* action that opens a dialog showing the key, the entity
  type and the value type as fixed text. The dialog edits the default, English and Polish
  labels, *Required* (switching it on explains that existing records keep their values and are
  asked for one at their next custom-field edit) and *Use as list filter* where the entity type
  offers it. *Save* sends only the members that changed and nothing when nothing did; a refusal
  keeps the dialog open with the server's sentence.
- **Options** of a select or multiselect field are edited in the same dialog, one action at a
  time: relabel, mark as default, move up or down (announced to assistive technology), remove
  after an in-dialog confirmation (an option still in use is refused at its row), and add. An
  option's stored value never changes.
- **The table** shows a *List filter* column, and the create form offers *Use as list filter*
  for the entity types that have the option.
- **Translated.** Every label, header, value-type name and placeholder on the page is read from
  the module's bundle, in English and Polish.
- **Write controls follow `custom_fields:write`.** Create, edit, delete and the audience select
  are offered only to an operator holding it; a reader sees the table.
