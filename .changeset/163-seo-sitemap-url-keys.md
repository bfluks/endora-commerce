---
'@endora-commerce/mod-seo': patch
---

The sitemap lists one URL per language a product is live in, each on the product's effective URL key in that language (`catalogProductUrlKeyReadPort`), with `?lang=` off the channel's default language. A `product.updated.v1` that changes a product's scoped status, publication window, audience or URL keys marks every channel's cached sitemap stale, so the next request regenerates it.
