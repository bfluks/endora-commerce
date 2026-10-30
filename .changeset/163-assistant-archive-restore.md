---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-prompt-actions': patch
---

The admin assistant can archive and restore products (product data scopes).

- **New assistant tools** `catalog.archive_product` and `catalog.restore_product` (`catalog:write`), with the parameter schemas `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema`. Like every assistant change they are planned first and run only after the operator confirms. Each product runs the same audited Archive / Restore as the admin screens, recorded in the audit log under the confirming admin. More than 50 products run as the bulk Archive / Restore in the background, which can be undone from its operation page.
- `catalog.set_product_status` still only switches products on or off. Its description now tells the assistant that it does not archive or restore, and names the new tools.
- **Behaviour change — assistant search:** `catalog.search_products` now includes archived products and returns `archived` beside `status`, so an archived product can be found to restore it.
- **prompt_actions documentation:** the tool catalogue lists every catalog tool, the two new ones included, and says that archiving is not a status.
