import { apiClient } from '@endora-commerce/admin-kit/lib';

/** How an admin screen names a product it holds only the id of. */
export interface ProductLabel {
  name: string;
  sku: string;
}

/** Pick a display name from the multilingual product `name` record. */
export function resolveProductName(name: Record<string, string>): string {
  return name['en-US'] ?? name['en'] ?? Object.values(name)[0] ?? '';
}

const LOOKUP_CHUNK = 500;

/**
 * Names and SKUs of the given products, through the admin batch-by-id read in chunks of
 * its ceiling. A chunk that fails is left out, so its products fall back to whatever the
 * caller shows for an unnamed id.
 */
export async function lookupProductLabels(ids: readonly string[]): Promise<Record<string, ProductLabel>> {
  const map: Record<string, ProductLabel> = {};
  for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + LOOKUP_CHUNK);
    try {
      const res = await apiClient.post<{ data: Array<{ id: string; sku: string; name: Record<string, string> }> }>(
        '/api/v1/admin/catalog/products/batch-by-id',
        { ids: chunk, pageSize: LOOKUP_CHUNK },
      );
      for (const p of res.data ?? []) map[p.id] = { name: resolveProductName(p.name), sku: p.sku };
    } catch {
      /* fall back to the raw id for this chunk */
    }
  }
  return map;
}
