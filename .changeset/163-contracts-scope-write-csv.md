---
'@endora-commerce/contracts': minor
---

`ProductImportRow.scopedStatus` (`ScopedStatusCell[]`), `ScopedStatusExport`, `scopedStatusColumn()` / `parseScopedStatusColumn()` for the products file's `status@<channel code>[/<language>]` columns, and `CatalogBulkImportPort.exportScopedStatuses()` — an implementer of that port must add the method. `CatalogProductScopeWritePort` is now registered as `catalogProductScopeWritePort` by `catalog`.
