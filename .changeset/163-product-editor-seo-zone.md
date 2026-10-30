---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-seo': patch
---

The product editor's SEO tab ends with a new admin zone, `product.editor.seo.after` (props: the product id). `seo` contributes the link to its meta-tag editor there, shown while `seo` is on and the admin holds `catalog:write`; `catalog` no longer names `seo`. The tab's former "Page title (preview)" input, which saved nothing, is gone.
