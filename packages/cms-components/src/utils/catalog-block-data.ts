/**
 * The block-data seam under its pre-163 name.
 *
 * Feature 163 generalised the catalog-only seam to every server-read block kind and moved it to
 * `./block-data.js`. A storefront an instance copied from an earlier CLI still imports
 * `@endora-commerce/cms-components/utils/catalog-block-data`, so this subpath keeps answering with
 * the same names. Nothing in this repository imports it; new code imports `./block-data.js`.
 *
 * @deprecated Import from `@endora-commerce/cms-components/utils/block-data`.
 */
export {
  type CatalogCategorySelectionMode,
  type CatalogCategoryItem,
  type BlockDataRequest as CatalogBlockDataRequest,
  type BlockData as CatalogBlockData,
  type BlockDataSource as CatalogBlockDataSource,
  productSourceDataRequest,
  productCardDataRequest,
  categorySelectionDataRequest,
  blockDataRequestOf as catalogBlockDataRequestOf,
  blockDataKey as catalogBlockDataKey,
  collectBlockDataRequests as collectCatalogBlockDataRequests,
  BLOCK_DATA_CONCURRENCY as CATALOG_BLOCK_DATA_CONCURRENCY,
  resolveBlockData as resolveCatalogBlockData,
} from './block-data.js';
