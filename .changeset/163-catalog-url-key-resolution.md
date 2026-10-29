---
'@endora-commerce/mod-catalog': minor
---

Storefront resolution of product URL keys at the request's sales channel and language.

- **New public route** `GET /api/v1/catalog/products/resolve/:key`. A key is valid only in its own language: the product's effective key at (channel, language) answers `{ kind: 'product', productId, key }`; any other of its current keys in that language, and its redirect keys there (a language-less redirect — a former global key — counts in every language), answer `200 { kind: 'redirect', key, languageCode, path }`, `path` built by `productPath()`. A key of no product, a key of another language, and a product unavailable to the caller there (out of the channel, outside the audience, off in the scope, outside its window) all answer the same `404 PRODUCT_NOT_FOUND`; an archived product answers `410 PRODUCT_ARCHIVED`. Redirects are served only while `seo` is effectively present. Signed-in callers' answers are `private, no-store`.
- `GET /api/v1/catalog/products/:idOrSlug` now answers an id, a current key of the request language, else a product's global key (the handle CMS product blocks store) — never a redirect key.
- The product detail carries `paths: { canonical, alternates }` — the page's URL at the request's channel and language, and one per channel language where the product is available to anonymous visitors.
- `slug` on the listing, the product detail, grouped and bundle children and product-link tiles is the product's effective URL key at the request's channel and language.
- New port `catalogProductUrlKeyReadPort.effectiveKeys(productIds, channelId)`.
- `GET /api/v1/admin/catalog/products/:id/url-keys` omits `redirects` while `seo` is not effectively present; the rows stay and keep reserving their keys.
