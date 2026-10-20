---
'@endora-commerce/mod-custom-fields': minor
---

The `/custom-fields` screen turns value carry-over on and off, shows where values carry, and warns before a change that would stop a carry from working.

**For an administrator.**

- The create form and the definition editor offer one *Carry value to …* checkbox per entity type
  the definition's type can carry to — none for a type that carries nowhere (Category, Product,
  Customer, Organization), and never *Quote request* for an Order field. The editor's *Save* sends
  the carry list only when it changed.
- A refused carry option keeps the form or the editor open with a sentence that names what is
  wrong — the missing field and its type, the two value types, the missing option values, or the
  audience rule — in the operator's language.
- A new *Carries to* column lists each target as a chip. A chip whose same-key target no longer
  fits is marked *Incompatible*, with its reason as text; the mark goes as soon as the definitions
  are re-read compatible.
- Removing or adding an option, changing a field's audience in the table and deleting a field ask
  first when the change would break an enabled carry, naming every field on the other side.
  *Cancel* sends nothing; *Continue anyway* makes the change exactly as before. A change that
  breaks nothing asks nothing.

**For a module author.** `DefinitionBehaviourFields` takes an optional `value.carryTo` (answered
back by `onChange`) and an optional `entityTypes`; `DefinitionEditorDialog` takes optional
`entityTypes` and `definitions`; `DefinitionOptionsEditor` takes an optional `carryGuard`. All
additive.
