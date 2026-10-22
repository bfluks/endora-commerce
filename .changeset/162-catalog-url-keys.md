---
'@endora-commerce/mod-catalog': minor
---

Product URL keys per language and per sales channel × language, with permanent redirects.

- Migration `20261022T054223_catalog_product_url_keys.ts` adds `product_url_keys` (a product's key per language, or per sales channel × language) and `product_url_redirects` (a former key and the product it redirects to; a language-less row is a former global key). The global key stays `products.slug`; no backfill. Both tables cascade on product hard delete; channel keys also on sales channel delete.
- **New admin routes** `GET|PUT /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read` / `catalog:write`) and `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`). A key is unique per language across every sales channel, the global key counting in every language where the product has no language key; a key another product holds is refused with `409 URL_KEY_TAKEN` naming it, and a key that is another product's redirect needs the operator's confirmation (`confirmTakeover`) after `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` naming the product that loses it. A changed key stays as a redirect in its language; redirects store the product and never chain. Writes are the audited Commands `product.url_keys.update` (whose before-state re-sent through the route restores the keys) and `product.url_redirect.delete`, and emit `product.updated.v1` with `changedFields: ['urlKeys']`. Storefront resolution of these keys is not wired yet.
- A new product's slug, on create and on duplicate, is now chosen free of every live product's language, channel and redirecting keys; deleting a product removes its redirects.
