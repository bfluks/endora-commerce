import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord, ProductImportRow, ScopedStatusExport } from '@endora-commerce/contracts';
import type { ImportExportPorts } from '../adapter.js';
import { productsAdapter } from './products.adapter.js';

/**
 * Feature 163 (T121, T123, FR-092) — the products file's `status@<channel code>` and
 * `status@<channel code>/<language>` columns: exported as the override at each scope
 * (empty where it inherits), read back into `scopedStatus` cells (empty = inherit),
 * a value that is not a status refusing the file. The `[PG]` round trip is
 * `backend/test/integration/catalog/bulk-import-scoped-status.test.ts`.
 */
function product(id: string, sku: string): CatalogProductRecord {
  return {
    id,
    sku,
    slug: sku.toLowerCase(),
    type: 'simple',
    status: 'active',
    visibility: 'public',
    name: { 'en-US': `Name ${sku}` },
    description: {},
  } as unknown as CatalogProductRecord;
}

function ports(imported: ProductImportRow[][]): ImportExportPorts {
  const scoped: ScopedStatusExport = {
    columns: [
      { channelCode: 'b2b', languageCode: null },
      { channelCode: 'b2b', languageCode: 'pl-PL' },
    ],
    values: { p1: { 'status@b2b': 'inactive' } },
  };
  return {
    catalogProducts: { listAll: async () => [product('p1', 'A'), product('p2', 'B')] },
    catalogBulkImport: {
      exportScopedStatuses: async () => scoped,
      importProducts: async (rows: readonly ProductImportRow[]) => {
        imported.push([...rows]);
        return { imported: rows.length, errors: [] };
      },
    },
  } as unknown as ImportExportPorts;
}

describe('products adapter — scoped status columns (163)', () => {
  it('exports one column per scope, the override or empty', async () => {
    const table = await productsAdapter(ports([])).exportTable!();
    expect(table.header.slice(-2)).toEqual(['status@b2b', 'status@b2b/pl-PL']);
    expect(table.rows.map((row) => row.slice(-2))).toEqual([
      ['inactive', ''],
      ['', ''],
    ]);
  });

  it('reads the cells back, an empty one as "use inherited", and leaves a row without them alone', async () => {
    const imported: ProductImportRow[][] = [];
    const report = await productsAdapter(ports(imported)).importRows!([
      { sku: 'A', 'status@b2b': 'inactive', 'status@b2b/pl-PL': '' },
      { sku: 'B' },
    ]);
    expect(report).toEqual({ imported: 2, errors: [] });
    expect(imported[0]).toEqual([
      {
        sku: 'A',
        scopedStatus: [
          { channelCode: 'b2b', languageCode: null, status: 'inactive' },
          { channelCode: 'b2b', languageCode: 'pl-PL', status: null },
        ],
      },
      { sku: 'B' },
    ]);
  });

  it('refuses the file for a value that is not a status', async () => {
    const imported: ProductImportRow[][] = [];
    const report = await productsAdapter(ports(imported)).importRows!([{ sku: 'A', 'status@b2b': 'sideways' }]);
    expect(report).toEqual({ imported: 0, errors: [{ index: 0, reason: 'invalid status@b2b: sideways' }] });
    expect(imported).toEqual([]);
  });
});
