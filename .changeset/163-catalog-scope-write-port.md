---
'@endora-commerce/mod-catalog': minor
---

Scoped writes for connectors and importers.

- New port `catalogProductScopeWritePort.applyScopes(productId, input, { source })`: writes only the scopes named — status per sales channel or channel × language, the global or a channel publication window, a channel audience, channel order rules, and URL keys per language or channel × language — so a connector writing global values removes no operator override. Status, window, audience and order rules go through the `product.scopes.update` Command. URL keys run in import mode: a key another product holds as a current key or a redirect is not written, the product keeps its previous key, and the outcome names the language, key and holder (`kind: 'current' | 'redirect'`); a redirect is never taken over. One `product.url_keys.update` audit entry per call (`source` recorded in its after-state). No completeness gate runs.
- `catalogBulkImportPort.importProducts` takes `scopedStatus` cells and writes them in the same all-or-nothing Command (an empty cell removes the override; a value for a channel the product is not in, a language the channel does not offer or an unknown channel code rejects the file), announcing `product.updated.v1` `['scopedStatus']` per changed product after commit. New `catalogBulkImportPort.exportScopedStatuses()`.
- New page *URL Keys and Redirects* in the catalog documentation, with which scope every integration field is written at.
