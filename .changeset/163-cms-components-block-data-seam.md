---
'@endora-commerce/cms-components': minor
---

The catalogue-only block-data seam is generalised to every block that reads server data, so `blog.LatestPosts` resolves on the server through the same path as the catalogue blocks.

New names, in `@endora-commerce/cms-components/utils/block-data`: `BlockDataRequest` (now also `{ kind: 'blog-posts', … }`), `BlockData`, `BlockDataSource` (gains the optional `fetchBlogPosts` and `isModulePresent`; a request whose owning module is absent is skipped and never asked), `blockDataOwnerOf`, `blockDataRequestOf`, `blockDataKey`, `collectBlockDataRequests`, `resolveBlockData`, `BLOCK_DATA_CONCURRENCY`, `blogPostsDataRequest`. The hook is `useBlockData` in `@endora-commerce/cms-components/hooks/use-block-data`, the context reader `useProvidedBlockData` in `@endora-commerce/cms-components/components/catalog-preview-context`, and `CatalogPreviewApi` gains the optional `fetchBlogPosts`.

**Deprecated, still working:** `@endora-commerce/cms-components/utils/catalog-block-data` re-exports the new names under the old ones (`CatalogBlockDataRequest`, `CatalogBlockData`, `CatalogBlockDataSource`, `catalogBlockDataRequestOf`, `catalogBlockDataKey`, `collectCatalogBlockDataRequests`, `resolveCatalogBlockData`, `CATALOG_BLOCK_DATA_CONCURRENCY`, and the unchanged request builders), so a storefront that imports it keeps compiling. Move to `utils/block-data`; the subpath will be removed in a later release.

**Breaking — removed without a shim:**

- `@endora-commerce/cms-components/hooks/use-catalog-block-data` (`useCatalogBlockData`, `CatalogBlockDataState`): import `useBlockData` / `BlockDataState` from `@endora-commerce/cms-components/hooks/use-block-data` (same call shape).
- From `components/catalog-preview-context`: `useProvidedCatalogBlockData()` → `useProvidedBlockData()`, and the type re-exports `CatalogBlockData`, `CatalogBlockDataRequest`, `CatalogBlockDataSource` → `BlockData`, `BlockDataRequest`, `BlockDataSource`.

The `CatalogBlockData` value type widens to include blog post cards; a consumer that narrows it by request kind is unaffected.
