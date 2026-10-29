---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
---

The assistant's product mutation tools take at most `PROMPT_PRODUCT_IDS_MAX` (10 000, the bulk product route's cap) product ids: `AssignProductsToCategoryParamsSchema`, `RemoveProductsFromCategoryParamsSchema`, `SetProductStatusParamsSchema`, `SetProductsVisibilityParamsSchema`, `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema` refuse a longer `productIds`. `PROMPT_PRODUCT_IDS_MAX` is exported. Catalog's tools treat a repeated id as one product, so its preview no longer answers 404 and it is written once; a per-product failure reported to the assistant names only an `HttpError`'s message, `failed` otherwise.
