---
'@endora-commerce/mod-catalog': patch
---

- The product detail's `seo` block is `seo`'s per-field resolution at the request's sales channel and language (`seoProductMetaPort`, declared `degrades-without`): operator overrides — including per-language overrides saved before this release, which were stored but not shown — are now served; with `seo` switched off the derived metadata is served as before.
- The product page answers `410 PRODUCT_ARCHIVED` only for an archived product (`archived_at` set). A product that is `inactive` and not archived answers the absent product's `404`.
