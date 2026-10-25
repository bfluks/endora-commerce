import { describe, expect, it, vi } from 'vitest';
import type { ImportExportPorts } from '../adapter.js';
import { productsAdapter } from './products.adapter.js';

/**
 * Feature 163 (FR-092, FR-112, spec Session 2026-10-25 O-1) — an imported status is
 * `active` or `inactive`. `draft` no longer exists and the legacy `archived` alias is
 * refused per record rather than mapped: archiving is its own action, not a status.
 */
function adapterWith(importProducts = vi.fn(async () => ({ imported: 1, errors: [] }))) {
  const ports = { catalogBulkImport: { importProducts } } as unknown as ImportExportPorts;
  const adapter = productsAdapter(ports);
  const importRows = adapter.importRows?.bind(adapter);
  if (!importRows) throw new Error('the products adapter imports');
  return { importRows, importProducts };
}

describe('products adapter — status column (FR-092)', () => {
  it.each(['draft', 'archived'])('refuses %s per record with invalid status', async (status) => {
    const { importRows, importProducts } = adapterWith();
    const report = await importRows([{ sku: 'A', status }]);
    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([{ index: 0, reason: `invalid status: ${status}` }]);
    expect(importProducts).not.toHaveBeenCalled();
  });

  it.each(['active', 'inactive'])('passes %s through unchanged', async (status) => {
    const { importRows, importProducts } = adapterWith();
    await importRows([{ sku: 'A', status }]);
    expect(importProducts).toHaveBeenCalledWith([{ sku: 'A', status }]);
  });
});
