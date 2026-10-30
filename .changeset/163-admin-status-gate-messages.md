---
'@endora-commerce/mod-catalog': patch
---

The product editor says what the completeness check found when a Save changes the status. Where the change switched the product on with values missing, the page names them by sales channel and language ("B2C shop · DE: name, attribute material") instead of "Saved."; where the check refuses the change, it names every channel and language that blocked it, says the product's details were not saved and keeps the edits in the form. The error code never reaches the operator.
