---
'@endora-commerce/admin-kit': minor
---

Additive props on the asset and CMS page pickers; existing callers are unchanged.

- `AssetPicker` and `AssetFieldPicker`: `acceptMimePrefix` also accepts `'font/'`, which lists font files in the picker grid. It narrows the grid only — the inline uploader is not restricted, because browsers report no reliable type for font files.
- `AssetFieldPicker`: optional `chooseLabel`, `changeLabel` and `clearLabel` for translated button copy; each defaults to the previous English text.
- `CmsPagePicker`: optional `excludeIds` (pages never offered, such as a page and its descendants in a parent picker; a client-side filter only) and `selectedLabel` (the label shown for `value` before a search has returned that page).
