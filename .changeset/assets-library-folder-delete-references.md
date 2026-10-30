---
'@endora-commerce/mod-assets-library': patch
---

`AssetReferenceRegistry.findReferencesMany` now attributes every reference to the asset it
points at, so a recursive folder delete (`ifNonEmpty: 'deleteRecursively'`) refuses with
409 `ASSET_REFERENCED` when any asset in the subtree is still used by a product, category,
CMS page, blog post, menu item or record attachment (#535). It used to return an empty list
for every asset and soft-delete in-use files. Every contributor is asked once for the whole
folder (`specs/166-asset-reference-visibility/`).
