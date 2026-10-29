---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-search': patch
'@endora-commerce/mod-comparisons': patch
---

Storefront links on the basket, the search results, comparisons and the quick-order type-ahead use the product's effective URL key at the request's sales channel and language (product data scopes), as the product page and the catalogue listing already did.

- **Behaviour change for API clients:** `productSlug` of a basket line and of an up-sell candidate, `slug` of a Meilisearch result card, of a comparison column and of a quick-order search hit is the channel × language key, else the language key, else the global key. A product with its own key in a language used to be linked by its global key, which answers 404 in that language when `seo` is off. A basket line whose product is unavailable still has `productSlug: null`.
- **Also:** a Meilisearch result card and a comparison column report the request channel's `minOrderQuantity`.
- `search` and `comparisons` resolve `catalogProductUrlKeyReadPort`; `catalog` is already a dependency of both.
