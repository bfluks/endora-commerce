---
'@endora-commerce/mod-catalog': minor
---

The admin product editor sets a product's availability per sales channel and per channel × language.

- **Scope controls** (Details tab, under the scope editor's channel switcher): status per channel and per channel × language with **Use inherited** and the source of the value shown, a publication window per channel (entered in the operator's local time, both ends included) and an audience rule per channel (mode and organization list as one value, with a warning naming organizations that are not members of the channel — the names come with the scopes answer, so an operator without `customers:read` sees them too). One **Save availability** sends every changed channel through `PATCH /api/v1/admin/catalog/products/:id/scopes`, carrying only the keys that changed; a refusal keeps the edits. A language setting the channel no longer offers is shown as ignored, with a way to remove it.
- **Global publication window** on the Details tab, saved with the page Save through the product `PATCH` (`publishFrom` / `publishUntil`) only when it changed.
- **Order rules per channel** (Inventory tab): minimum order quantity and **Returnable** per member channel, inheriting the global values; an empty minimum inherits and `1` means no minimum in that channel.
- Scope controls and the order-rules card are **read-only without `catalog:write`** — the card's global controls included, which previously stayed editable and were refused on save.
- The `open-products` palette action also answers to "scope", "zakres", "visibility per channel" and "publication window".
