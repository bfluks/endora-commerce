import { describe, expect, it } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE } from '@endora-commerce/contracts';
import { parseCsvRows } from './import-rows.js';
import {
  QUICK_ORDER_IMPORT_ROWS_CEILING,
  QuickOrderImportPipeline,
  type ProductLike,
  type QuickOrderCatalogLookup,
  type VariantBySku,
} from './import-pipeline.js';
import type { VariantLike } from './variant-resolver.js';

/** In-memory catalog stub — no DB. */
function lookupOf(opts: {
  products?: ProductLike[];
  variantsBySku?: VariantBySku[];
  variantsByParent?: Array<VariantLike & { parentProductId: string }>;
}): QuickOrderCatalogLookup {
  const products = opts.products ?? [];
  const variantsBySku = opts.variantsBySku ?? [];
  const variantsByParent = opts.variantsByParent ?? [];
  return {
    findProductsBySku: async (skus) => products.filter((p) => skus.includes(p.sku)),
    findVariantsBySku: async (skus) => variantsBySku.filter((v) => skus.includes(v.sku)),
    findVariantsByParent: async (ids) =>
      variantsByParent.filter((v) => ids.includes(v.parentProductId)),
  };
}

/**
 * The pipeline's stub lookup applies no visibility of its own, so the audience
 * these tests pass is inert here — the filtering lives in `CatalogPortLookup`,
 * which is where the record's two columns are. What this constant pins is that
 * the audience is a *required* argument: a `run` that could be called without
 * one would fail open on every path that forgot it.
 */
const AUDIENCE = ANONYMOUS_PRODUCT_AUDIENCE;

const ACTIVE = (id: string, sku: string): ProductLike => ({ id, sku, status: 'active', deletedAt: null });

describe('QuickOrderImportPipeline', () => {
  it('recognizes valid rows and rejects unknown / archived / bad-qty / missing-sku rows', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'ABC'), { id: 'p2', sku: 'OLD', status: 'inactive', deletedAt: null }],
      }),
    );
    const csv = ['sku,quantity', 'ABC,2', 'NOPE,1', 'OLD,1', 'ABC,0', ',3'].join('\n');
    const result = await pipeline.run(parseCsvRows(csv), { maxRows: 100, audience: AUDIENCE });

    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0]).toMatchObject({ productId: 'p1', variantId: null, quantity: 2 });
    const reasons = result.rejected.map((r) => r.reason).sort();
    expect(reasons).toEqual(['product_archived', 'product_not_found', 'quantity_invalid', 'sku_missing']);
  });

  it('rejects every data row as malformed when the header is unusable', async () => {
    const pipeline = new QuickOrderImportPipeline(lookupOf({}));
    const result = await pipeline.run(parseCsvRows('foo,bar\n1,2\n3,4'), { audience: AUDIENCE });
    expect(result.recognized).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason)).toEqual(['malformed_row', 'malformed_row']);
  });

  it('resolves a variant from attribute columns', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'TS')],
        variantsByParent: [
          { id: 'v1', sku: 'TS-RED', parentProductId: 'p1', variantAttributeValues: { color: 'Red' } },
          { id: 'v2', sku: 'TS-BLUE', parentProductId: 'p1', variantAttributeValues: { color: 'Blue' } },
        ],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity,color\nTS,1,Blue'), { maxRows: 100, audience: AUDIENCE });
    expect(result.recognized[0]).toMatchObject({
      productId: 'p1',
      variantId: 'v2',
      resolvedVariantSku: 'TS-BLUE',
    });
  });

  it('rejects ambiguous and unresolvable variant rows', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        products: [ACTIVE('p1', 'TS')],
        variantsByParent: [
          { id: 'v1', sku: 'TS-RED-S', parentProductId: 'p1', variantAttributeValues: { color: 'Red', size: 'S' } },
          { id: 'v2', sku: 'TS-RED-L', parentProductId: 'p1', variantAttributeValues: { color: 'Red', size: 'L' } },
        ],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity,color\nTS,1,Red\nTS,1,Green'), {
      maxRows: 100,
      audience: AUDIENCE,
    });
    expect(result.recognized).toHaveLength(0);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual([
      'variant_ambiguous',
      'variant_not_resolved',
    ]);
  });

  it('resolves a row whose SKU is itself a variant SKU', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({
        variantsBySku: [{ id: 'v9', sku: 'TS-RED-L', parentProductId: 'p1' }],
        products: [],
      }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity\nTS-RED-L,4'), { maxRows: 100, audience: AUDIENCE });
    expect(result.recognized[0]).toMatchObject({
      productId: 'p1',
      variantId: 'v9',
      resolvedVariantSku: 'TS-RED-L',
      quantity: 4,
    });
  });

  it('merges duplicate SKUs summing quantity', async () => {
    const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [ACTIVE('p1', 'ABC')] }));
    const result = await pipeline.run(parseCsvRows('sku,quantity\nABC,2\nABC,3'), { maxRows: 100, audience: AUDIENCE });
    expect(result.recognized).toHaveLength(1);
    expect(result.recognized[0]).toMatchObject({ quantity: 5, mergedFromLines: [3] });
    expect(result.summary.mergedCount).toBe(1);
  });

  it('caps rows and reports overflow as row_limit_exceeded', async () => {
    const pipeline = new QuickOrderImportPipeline(
      lookupOf({ products: [ACTIVE('p1', 'A'), ACTIVE('p2', 'B'), ACTIVE('p3', 'C')] }),
    );
    const result = await pipeline.run(parseCsvRows('sku,quantity\nA,1\nB,1\nC,1'), { maxRows: 2, audience: AUDIENCE });
    expect(result.summary.truncated).toBe(true);
    expect(result.rejected.map((r) => r.reason)).toEqual(['row_limit_exceeded']);
    expect(result.recognized).toHaveLength(2);
  });

  /**
   * Feature 155 (P1, US4 #1a–#1d, FR-011 (a)) — the preview judges each
   * product's total across the file, all variants summed after the merge,
   * never with the cart.
   */
  describe('order minimums (feature 155)', () => {
    const A = (minOrderQuantity: number | null = 10): ProductLike => ({
      id: 'pA',
      sku: 'A',
      status: 'active',
      deletedAt: null,
      type: 'configurable',
      minOrderQuantity,
    });
    const D: ProductLike = { id: 'pD', sku: 'D', status: 'active', deletedAt: null, type: 'simple', minOrderQuantity: null };
    const VARIANTS: VariantBySku[] = [
      { id: 'vRed', sku: 'A-RED', parentProductId: 'pA', parent: { type: 'configurable', minOrderQuantity: 10 } },
      { id: 'vBlue', sku: 'A-BLUE', parentProductId: 'pA', parent: { type: 'configurable', minOrderQuantity: 10 } },
    ];
    const BUYER = { organizationId: 'org-1', authenticated: true } as const;

    it('recognises A-red × 4 and A-blue × 6 — the file total is 10', async () => {
      const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [A()], variantsBySku: VARIANTS }));
      const result = await pipeline.run(parseCsvRows('sku,quantity\nA-RED,4\nA-BLUE,6'), { audience: BUYER });
      expect(result.recognized.map((r) => [r.variantId, r.quantity])).toEqual([
        ['vRed', 4],
        ['vBlue', 6],
      ]);
      expect(result.recognized.every((r) => r.warning === undefined)).toBe(true);
      expect(result.rejected).toEqual([]);
    });

    it('buyer: rejects both A-red × 4 and A-blue × 3 below_minimum with minimum 10 and productTotal 7', async () => {
      const pipeline = new QuickOrderImportPipeline(
        lookupOf({ products: [A(), D], variantsBySku: VARIANTS }),
      );
      const result = await pipeline.run(parseCsvRows('sku,quantity\nA-RED,4\nA-BLUE,3\nD,1'), {
        audience: BUYER,
      });
      expect(result.recognized.map((r) => r.productId)).toEqual(['pD']);
      expect(result.rejected).toEqual([
        { line: 2, raw: 'A-RED,4', reason: 'below_minimum', minimum: 10, productTotal: 7 },
        { line: 3, raw: 'A-BLUE,3', reason: 'below_minimum', minimum: 10, productTotal: 7 },
      ]);
      expect(result.summary).toMatchObject({ recognizedCount: 1, rejectedCount: 2, mergedCount: 0 });
      expect(result.summary.warningCount).toBeUndefined();
    });

    it('sums duplicate rows before judging; the merged row is rejected once, at its first line', async () => {
      const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [A()] }));
      const ok = await pipeline.run(parseCsvRows('sku,quantity\nA,5\nA,5'), { audience: BUYER });
      expect(ok.recognized).toHaveLength(1);
      expect(ok.recognized[0]).toMatchObject({ quantity: 10, mergedFromLines: [3] });

      const below = await pipeline.run(parseCsvRows('sku,quantity\nA,2\nA,3'), { audience: BUYER });
      expect(below.recognized).toEqual([]);
      expect(below.rejected).toEqual([
        { line: 2, raw: 'A,2', reason: 'below_minimum', minimum: 10, productTotal: 5 },
      ]);
      expect(below.summary).toMatchObject({ recognizedCount: 0, rejectedCount: 1, mergedCount: 1 });
    });

    it('a row rejected for an existing reason counts toward no total', async () => {
      const pipeline = new QuickOrderImportPipeline(
        lookupOf({
          products: [A()],
          variantsByParent: [
            { id: 'vRed', sku: 'A-RED', parentProductId: 'pA', variantAttributeValues: { color: 'Red' } },
          ],
        }),
      );
      // Line 3 names a colour A does not have — rejected `variant_not_resolved`,
      // so its 6 pieces never reach A's total.
      const csv = 'sku,quantity,color\nA,4,Red\nA,6,Green';
      const result = await pipeline.run(parseCsvRows(csv), { audience: BUYER });
      const byReason = new Map(result.rejected.map((r) => [r.reason, r]));
      expect(byReason.get('variant_not_resolved')).toMatchObject({ line: 3 });
      expect(byReason.get('below_minimum')).toMatchObject({ line: 2, minimum: 10, productTotal: 4 });
    });

    it('ignores a product with no minimum, a minimum of 1, and a stored minimum on an ineligible type', async () => {
      const bundle: ProductLike = { id: 'pB', sku: 'B', status: 'active', deletedAt: null, type: 'bundle', minOrderQuantity: 10 };
      const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [A(1), D, bundle] }));
      const result = await pipeline.run(parseCsvRows('sku,quantity\nA,1\nD,1\nB,1'), { audience: BUYER });
      expect(result.recognized).toHaveLength(3);
      expect(result.rejected).toEqual([]);
    });

    it('operator (unrestricted): keeps the rows recognised with a warning and counts warningCount', async () => {
      const pipeline = new QuickOrderImportPipeline(
        lookupOf({ products: [A(), D], variantsBySku: VARIANTS }),
      );
      const result = await pipeline.run(parseCsvRows('sku,quantity\nA-RED,4\nA-BLUE,3\nD,1'), {
        audience: 'unrestricted',
      });
      expect(result.rejected).toEqual([]);
      expect(result.recognized.map((r) => [r.variantId ?? r.productId, r.warning ?? null])).toEqual([
        ['vRed', { reason: 'below_minimum', minimum: 10, productTotal: 7 }],
        ['vBlue', { reason: 'below_minimum', minimum: 10, productTotal: 7 }],
        ['pD', null],
      ]);
      expect(result.summary).toMatchObject({ recognizedCount: 3, rejectedCount: 0, warningCount: 2 });
    });

    it('operator: warningCount is 0 when nothing is below a minimum', async () => {
      const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [A()] }));
      const result = await pipeline.run(parseCsvRows('sku,quantity\nA,10'), { audience: 'unrestricted' });
      expect(result.summary.warningCount).toBe(0);
    });
  });

  /** Feature 155 (R20, threat F4) — the resolved row cap never exceeds the ceiling. */
  it('clamps maxRows to the 10 000-row ceiling', async () => {
    expect(QUICK_ORDER_IMPORT_ROWS_CEILING).toBe(10_000);
    const pipeline = new QuickOrderImportPipeline(lookupOf({ products: [ACTIVE('p1', 'A')] }));
    const rows = Array.from({ length: QUICK_ORDER_IMPORT_ROWS_CEILING + 2 }, () => 'A,1');
    const result = await pipeline.run(parseCsvRows(['sku,quantity', ...rows].join('\n')), {
      maxRows: 1_000_000,
      audience: AUDIENCE,
    });
    expect(result.summary.truncated).toBe(true);
    expect(result.rejected.filter((r) => r.reason === 'row_limit_exceeded')).toHaveLength(2);
  });
});
