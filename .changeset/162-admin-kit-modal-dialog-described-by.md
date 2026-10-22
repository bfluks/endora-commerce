---
'@endora-commerce/admin-kit': patch
---

`ModalDialog` (`@endora-commerce/admin-kit/components`) takes an optional `aria-describedby`: the
id of the element that describes the dialog, set on the panel beside its `aria-labelledby`, so a
screen reader reads a warning or a question together with the title when focus enters the dialog.
Without it the panel carries no `aria-describedby`, exactly as before. Additive.
