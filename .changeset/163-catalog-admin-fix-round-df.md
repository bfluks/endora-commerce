---
'@endora-commerce/mod-catalog': patch
---

Product editor review fixes for product data scopes:

- A save refused by the completeness check writes nothing — the staged channel overrides and gallery edits are written only after the product itself is accepted.
- Staged gallery edits survive switching tabs and count as unsaved changes; while any are staged, adding or removing an image waits for Save. Removing an image and the image preview use the admin dialog.
- The scope overview asks before resetting a text value or deleting a value that no longer applies; channel and language values sit in their own column and row; focus returns to the overview after a reset.
- One vocabulary: **Use inherited** returns a value to the inherited one, **No longer applies** names a value the resolution ignores.
- The URL keys panel works when the product's channels cannot be read, asks again when a confirmed takeover meets another redirect, marks a refused key's field and shows the inherited key as text.
- Packaging units are read-only without `catalog:write`; the attachment and packaging-unit dialogs share their error wording, a saving state and a question before unsaved edits are dropped.
- The bulk result names products by name and SKU and links a scoped-status row to the product's Scopes tab (`?tab=scopes` opens it); the scoped status has no preselected value.
