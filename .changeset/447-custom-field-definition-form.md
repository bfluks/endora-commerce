---
'@endora-commerce/mod-custom-fields': patch
---

`/custom-fields`: a field is created in the same definition form that edits it, so it can be fully
defined when it is created (#447).

- **New field** opens the form in a dialog with the edit dialog's sections in the same order:
  definition (record type, type, key), labels, options, rules, behaviour. Create still sends one
  `POST` — now with a label per admin language and options carrying their own labels per language,
  the default flag and their order. The comma-separated options box is gone.
- The label languages are the platform's supported languages, not a list written in the module.
- **Who can see the value** is offered in the edit dialog as well; a change that breaks a carry asks
  first, as it does from the table.
- Both views check before sending: the key's format, a default label, unique non-empty option values,
  a default label per option, and at most one default option on a *Single choice* field (several are
  allowed on *Multiple choice*). A server refusal is said next to the field it concerns — a taken key
  at the key — never as a code.
- The behaviour block's `row` layout and the `customFields.carry.helpGroup` key went with the inline
  create form; the create form's carry checkboxes now carry their own help lines, as the editor's do.
