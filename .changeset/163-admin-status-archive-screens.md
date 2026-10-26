---
'@endora-commerce/admin-kit': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-product-feeds': patch
---

**BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

- **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
- **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
- **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
- **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
- **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has *All · Active · Inactive · Archived* with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's *Set status* offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
- **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.
