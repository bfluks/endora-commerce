---
'@endora-commerce/contracts': minor
---

Asset references can now say who may see them (`specs/166-asset-reference-visibility/`).

- `AssetReferenceDescriptor.findReferences(assetIds)` returns `AssetReferenceHit[]`: an `AssetReference` plus the `assetId` it points at. A descriptor that still returns plain `AssetReference[]` compiles and is answered correctly, but the registry then asks it one asset at a time wherever it must attribute a batch — tag your hits.
- New optional, readonly data property `AssetReferenceDescriptor.readerRestriction` (`AssetReferenceReaderRestriction`): `visibleEntityIds(entityIds)`, `assetIdsWithHiddenReferences()` and `allReferencedAssetIds()`. Absent, the references never hide an asset; present, a library reader who may see none of the records using an asset does not see the asset.
- `AssetReadPort` gains the **required** method `visibleToCaller(assetIds)`: which of the ids the ambient caller may see in the asset library (missing, hidden and non-uuid ids are all absent). A test double or an alternative implementation of the whole port must add it; one that picks methods (`Pick<AssetReadPort, …>`) is unaffected.
