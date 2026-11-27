// `apiClient` comes through the kit's published `lib` barrel, as `ProductPicker.tsx`
// does: `vi.mock` keys on a resolved module id, and the barrel is the only spelling
// an admin test outside this package can name.
import { apiClient } from '../../lib/index.js';
import type { ProductBrowserItem, ProductBrowserType } from './types.js';

/**
 * The browser's tabs. `all`, `active` and `inactive` list products that are **not**
 * archived; `archived` lists the archived ones of either status (feature 163,
 * FR-113, research R30.4). Archived is its own axis, never a status value.
 */
export type ProductBrowserStatusFilter = 'all' | 'active' | 'inactive' | 'archived';

export interface ProductBrowserQuery {
  /** Zero-based. */
  page: number;
  pageSize: number;
  status: ProductBrowserStatusFilter;
  type: ProductBrowserType | null;
  q: string;
}

/** The admin list's counts (R30.4): the first three over non-archived rows. */
export interface ProductBrowserCounts {
  all: number;
  active: number;
  inactive: number;
  archived: number;
}

export interface ProductBrowserPage {
  rows: ProductBrowserItem[];
  total: number;
  counts: ProductBrowserCounts;
}

interface AdminProductListResponse {
  data: Array<ProductBrowserItem & Record<string, unknown>>;
  pagination: { page: number; pageSize: number; total: number };
  counts: ProductBrowserCounts;
}

const PRODUCTS_PATH = '/api/v1/admin/catalog/products';

/**
 * The list request, in the order contract B1 fixes:
 * `[archived=only&]page&pageSize[&status][&type][&q]`. Archived products are left
 * out by the list's default (`archived=exclude`, feature 163 R30.4), so the first
 * three tabs and their counts agree; the Archived tab asks for them alone.
 */
export function buildProductBrowserPath(query: ProductBrowserQuery): string {
  const params = new URLSearchParams();
  if (query.status === 'archived') params.set('archived', 'only');
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  if (query.status === 'active' || query.status === 'inactive') params.set('status', query.status);
  if (query.type !== null) params.set('type', query.type);
  const trimmed = query.q.trim();
  if (trimmed.length > 0) params.set('q', trimmed);
  return `${PRODUCTS_PATH}?${params.toString()}`;
}

/** One page of the list, projected onto `ProductBrowserItem`. */
export async function fetchProductBrowserPage(query: ProductBrowserQuery): Promise<ProductBrowserPage> {
  const res = await apiClient.get<AdminProductListResponse>(buildProductBrowserPath(query));
  return {
    rows: res.data.map((p) => ({
      id: p.id,
      sku: p.sku,
      slug: p.slug,
      name: p.name,
      status: p.status,
      type: p.type,
      archivedAt: p.archivedAt ?? null,
    })),
    total: res.pagination.total,
    counts: res.counts,
  };
}
