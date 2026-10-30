---
'@endora-commerce/mod-catalog': minor
---

Bulk status per sales channel and language, and the completeness check when a product is switched on (product data scopes).

- **Bulk scoped status:** `POST /api/v1/admin/catalog/products/bulk-update` accepts `fields.scopedStatus: { channelId, languageCode, value }` (`active`, `inactive` or `inherit`). Only that scope changes on each product, through the audited `product.scopes.update` Command (`product.updated.v1` `['scopedStatus']`); a product not in the channel, or a language the channel does not offer, is skipped as `scope_invalid`. It cannot be combined with `status`. The queued path records the scope's before-state and the bulk undo puts it back.
- **New setting `catalog.scope_completeness_gate`** (`warn` by default, or `refuse`; one value for the platform) in a new `catalog` settings group. When an operator's status change — global, per channel or per channel × language, single or bulk — switches the product on where its name, URL key or a required language-dependent attribute is missing in that language, `warn` saves it and answers `warnings: [{ kind: 'completeness', channelId, languageCode, missing }]`; `refuse` answers `422 SCOPE_INCOMPLETE` with every failing pair and saves nothing, and a bulk edit skips such products as `completeness_gate`. Imports, connectors and the API-key upsert are never checked.
- **API shape (additive):** `PATCH /api/v1/admin/catalog/products/:id` answers `{ data, warnings }`; the scopes `PATCH` carries completeness warnings in its existing `warnings`.
- **Scope overview:** every cell of a member channel in a language it offers carries `missing` — what the check would report there, whatever the cell's status.
- **Fix:** undoing a queued bulk Restore re-archives the products again; its revert record used to read a stale archived time, so every product was reported as changed since.
