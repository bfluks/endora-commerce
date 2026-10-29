---
'@endora-commerce/mod-import-export': patch
---

The products export carries one `status@<channel code>` column per sales channel and one `status@<channel code>/<language>` column per channel language — the override at that scope, empty where it inherits — and the import reads them back (an empty cell removes the override; a value that is not a status rejects the file). A file without these columns leaves every scope as it is. Adapters may answer `exportTable()` when their columns depend on the data.
