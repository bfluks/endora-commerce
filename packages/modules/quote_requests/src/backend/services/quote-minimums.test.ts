import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { pairLines } from './line-carry-over.js';
import {
  assertQuoteMeetsMinimums,
  draftEditExemptions,
  quoteMinimumLines,
  quoteMinimumWarnings,
  resubmitMinimumLines,
  type QuoteMinimumLineSource,
} from './quote-minimums.js';

/**
 * Feature 155, Phase 10 (T076) — the quote line builder for the minimum rule
 * (FR-012, FR-027, FR-031; research R13.2–R13.4).
 */

const A = 'product-a';
const B = 'product-b';
const PALLET = 'unit-pallet';

const line = (extra: Partial<QuoteMinimumLineSource> & { productId: string; quantity: number }): QuoteMinimumLineSource => ({
  variantId: null,
  packagingUnitId: null,
  packagingUnitName: null,
  packagingUnitBaseQuantity: null,
  ...extra,
});

describe('quoteMinimumLines', () => {
  it('keys are the line indexes; the resolved unit id and snapshot base travel; nothing is exempt by default', () => {
    const lines = quoteMinimumLines([
      line({ productId: A, quantity: 5 }),
      line({ productId: B, quantity: 128, packagingUnitId: PALLET, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 }),
    ]);
    expect(lines).toEqual([
      { key: '0', productId: A, quantity: 5, packagingUnitId: null, packagingUnitBaseQuantity: null, exempt: false },
      { key: '1', productId: B, quantity: 128, packagingUnitId: PALLET, packagingUnitBaseQuantity: 64, exempt: false },
    ]);
  });

  it('carries the exemptions index by index', () => {
    const lines = quoteMinimumLines([line({ productId: A, quantity: 5 }), line({ productId: A, quantity: 3 })], [true, false]);
    expect(lines.map((l) => l.exempt)).toEqual([true, false]);
  });
});

describe('draftEditExemptions (FR-031 (b))', () => {
  const stored = [
    { id: 'row-a', productId: A, variantId: null, quantity: 5, packagingUnitName: null, packagingUnitBaseQuantity: null },
    {
      id: 'row-b',
      productId: B,
      variantId: null,
      quantity: 128,
      packagingUnitName: 'Pallet',
      packagingUnitBaseQuantity: 64,
    },
  ];

  const exemptionsFor = (incoming: QuoteMinimumLineSource[]) => {
    const { paired } = pairLines(stored, incoming, 'customer');
    return draftEditExemptions(paired, incoming);
  };

  it('a paired line with the same product, variant, packaging and quantity is exempt', () => {
    expect(
      exemptionsFor([
        line({ productId: A, quantity: 5 }),
        line({ productId: B, quantity: 128, packagingUnitId: PALLET, packagingUnitName: 'Pallet', packagingUnitBaseQuantity: 64 }),
      ]),
    ).toEqual([true, true]);
  });

  it('a changed quantity, a changed packaging or a new line is not', () => {
    expect(
      exemptionsFor([
        line({ productId: A, quantity: 6 }),
        line({ productId: B, quantity: 128 }),
        line({ productId: A, quantity: 5, variantId: 'variant-x' }),
      ]),
    ).toEqual([false, false, false]);
  });
});

describe('resubmitMinimumLines (FR-031 (c))', () => {
  it('pieces only, no exemption, keyed by index', () => {
    expect(
      resubmitMinimumLines([
        { productId: A, quantity: 5 },
        { productId: B, quantity: 128 },
      ]),
    ).toEqual([
      { key: '0', productId: A, quantity: 5, packagingUnitId: null, packagingUnitBaseQuantity: null, exempt: false },
      { key: '1', productId: B, quantity: 128, packagingUnitId: null, packagingUnitBaseQuantity: null, exempt: false },
    ]);
  });
});

describe('assertQuoteMeetsMinimums', () => {
  const products = [
    { id: A, type: 'simple', minOrderQuantity: 10 },
    { id: B, type: 'simple', minOrderQuantity: null },
  ];
  const packagingUnits = [{ id: PALLET, productId: B, name: 'Pallet', baseQuantity: 64, minOrderUnits: 2 }];
  const names = new Map([
    [A, 'Anchor'],
    [B, 'Brick'],
  ]);
  const refusalOf = (fn: () => void): HttpError => {
    try {
      fn();
    } catch (error) {
      return error as HttpError;
    }
    throw new Error('expected a refusal');
  };

  it('refuses every offending line, pieces first, with the product name and minimum', () => {
    const error = refusalOf(() =>
      assertQuoteMeetsMinimums(
        quoteMinimumLines([
          line({ productId: A, quantity: 5 }),
          line({ productId: B, quantity: 64, packagingUnitId: PALLET, packagingUnitBaseQuantity: 64 }),
        ]),
        { products, packagingUnits },
        names,
        'enforce',
      ),
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe(ERROR_CODES.PRODUCT_BELOW_MINIMUM_QUANTITY);
    expect(error.details).toMatchObject({
      productName: 'Anchor',
      minimum: 10,
      lines: [
        { index: 0, productId: A, productName: 'Anchor', kind: 'pieces', minimum: 10 },
        { index: 1, productId: B, productName: 'Brick', kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' },
      ],
    });
  });

  it('an exempt line is not refused but counts toward its product total', () => {
    expect(() =>
      assertQuoteMeetsMinimums(
        quoteMinimumLines([line({ productId: A, quantity: 5 }), line({ productId: A, quantity: 5 })], [true, false]),
        { products, packagingUnits },
        names,
        'enforce',
      ),
    ).not.toThrow();
    const error = refusalOf(() =>
      assertQuoteMeetsMinimums(
        quoteMinimumLines([line({ productId: A, quantity: 5 }), line({ productId: A, quantity: 3 })], [true, false]),
        { products, packagingUnits },
        names,
        'enforce',
      ),
    );
    expect((error.details as { lines: Array<{ index: number }> }).lines.map((l) => l.index)).toEqual([1]);
  });

  it("'warn' refuses nothing for minimums", () => {
    expect(() =>
      assertQuoteMeetsMinimums(quoteMinimumLines([line({ productId: A, quantity: 5 })]), { products, packagingUnits }, names, 'warn'),
    ).not.toThrow();
  });

  it('a line whose product has no record is the unknown-product 404, naming nothing (FR-037)', () => {
    for (const mode of ['enforce', 'warn'] as const) {
      const error = refusalOf(() =>
        assertQuoteMeetsMinimums(
          quoteMinimumLines([line({ productId: 'gone', quantity: 1 })]),
          { products, packagingUnits },
          names,
          mode,
        ),
      );
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(error.details).toBeUndefined();
    }
  });
});

describe('quoteMinimumWarnings (FR-030, Phase 11)', () => {
  const products = [
    { id: A, type: 'simple', minOrderQuantity: 10 },
    { id: B, type: 'simple', minOrderQuantity: 100 },
  ];
  const packagingUnits = [{ id: PALLET, productId: B, name: 'Pallet', baseQuantity: 64, minOrderUnits: 2 }];

  it('flags each below-minimum line over the request totals, first violation per line, null otherwise', () => {
    const warnings = quoteMinimumWarnings(
      quoteMinimumLines([
        line({ productId: A, quantity: 4 }),
        line({ productId: A, quantity: 3 }),
        line({ productId: B, quantity: 64, packagingUnitId: PALLET, packagingUnitBaseQuantity: 64 }),
      ]),
      { products, packagingUnits },
    );
    expect(warnings).toEqual([
      { kind: 'pieces', minimum: 10 },
      { kind: 'pieces', minimum: 10 },
      { kind: 'pieces', minimum: 100 },
    ]);
  });

  it('a pallet line meeting the pieces minimum warns on the unit; a line at its minimum is null', () => {
    const warnings = quoteMinimumWarnings(
      quoteMinimumLines([
        line({ productId: A, quantity: 10 }),
        line({ productId: B, quantity: 64, packagingUnitId: PALLET, packagingUnitBaseQuantity: 64 }),
        line({ productId: B, quantity: 40 }),
      ]),
      { products, packagingUnits },
    );
    expect(warnings).toEqual([null, { kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' }, null]);
  });

  it('a line whose product has no record is null, never a failure', () => {
    expect(quoteMinimumWarnings(quoteMinimumLines([line({ productId: 'gone', quantity: 1 })]), { products, packagingUnits })).toEqual([
      null,
    ]);
  });
});
