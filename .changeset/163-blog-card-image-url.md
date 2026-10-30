---
'@endora-commerce/mod-blog': patch
---

Blog post and category cards on the storefront show their main image. The storefront resolver was never handed an asset-URL resolver, so every card's `mainImageUrl` was `null`. `@endora-commerce/mod-blog` now resolves it through the asset library port by default; only a public asset is served, and a missing asset renders the card without an image.
