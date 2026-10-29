---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/page-builder-admin': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-document-templates': patch
---

The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

- `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
- The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.
