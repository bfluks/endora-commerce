---
'@endora-commerce/contracts': minor
---

`productDetailSchema` gains the required `paths` field (`productPagePathsSchema`, exported from `product-url-keys`): the product page's canonical path and its alternate-language paths, built by the backend with `productPath()`. `CatalogProductUrlKeyReadPort` is now registered as `catalogProductUrlKeyReadPort` by `catalog`. A consumer that constructs a `ProductDetail` literal must add `paths`.
