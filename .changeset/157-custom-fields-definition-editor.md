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
- **Edits keep your place.** An option's labels save when you leave the field or press Enter, with a
  *Saved* confirmation at the row. Its inputs stay usable while a save is on its way, a save that
  lands does not overwrite what you are still typing, and a reorder returns focus to the moved
  option. Option changes apply at once, and the dialog says so: after one, *Cancel* reads *Close*.
- **An option in use** is named by its label in a sentence of the editor's own, never by the
  server's message or code.
- **Deleting a field** asks in place first. The table shows a loading line, an empty state with
  one action, and cards on a narrow screen. Its *List filter* column says *Yes* or *No*.
