---
'@endora-commerce/contracts': minor
---

**BREAKING — `ProductDetail` gains a required field, `paths`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. Code that builds a `ProductDetail` literal (a test fixture, an overlay serving the product page) must add `paths` — `{ canonical, alternates }` from `productPagePathsSchema`; a reader is unaffected.

`productDetailSchema` gains the required `paths` field (`productPagePathsSchema`, exported from `product-url-keys`): the product page's canonical path and its alternate-language paths, built by the backend with `productPath()`. `CatalogProductUrlKeyReadPort` is now registered as `catalogProductUrlKeyReadPort` by `catalog`. A consumer that constructs a `ProductDetail` literal must add `paths`.
