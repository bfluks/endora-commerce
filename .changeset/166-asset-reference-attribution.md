---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-megamenu': patch
---

Every asset reference these modules report is tagged with the `assetId` it points at, and each descriptor answers a batch of assets in one statement (`specs/166-asset-reference-visibility/`). The catalog's category content, CMS content and blog content scans used to run one JSON-path query per asset; each is now one query per batch, walking a document once however many assets are asked. Their references stay unrestricted: they never hide a library file.
