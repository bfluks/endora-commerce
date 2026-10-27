---
'@endora-commerce/contracts': minor
---

**BREAKING — `CatalogBulkImportPort` gains a required method, `exportScopedStatuses()`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. An implementer of the port (an overlay replacing catalog's import / export) must add it; it answers the products' scoped statuses as `ScopedStatusExport`. Callers are unaffected.

`ProductImportRow.scopedStatus` (`ScopedStatusCell[]`), `ScopedStatusExport`, `scopedStatusColumn()` / `parseScopedStatusColumn()` for the products file's `status@<channel code>[/<language>]` columns, and `CatalogBulkImportPort.exportScopedStatuses()` — an implementer of that port must add the method. `CatalogProductScopeWritePort` is now registered as `catalogProductScopeWritePort` by `catalog`.
