import { describe, expect, it } from 'vitest';
import { evaluateOrderMinimums, type OrderMinimumLine, type OrderMinimumRules } from './order-minimums.js';

/**
 * Feature 155 QA — the exact boundary of both minimums (FR-006a): a quantity one
 * below the minimum is refused, the quantity exactly at it is admitted, and the
 * exemption of a quote-seeded line (FR-028) flips at the quote's quantity, not
 * at the minimum. The sibling `order-minimums.test.ts` covers the scenario rows;
 * this file pins the off-by-one edges they only sit next to.
 */

const P = 'product-p';
const U = 'unit-pallet';

const line = (
  key: string,
  quantity: number,
  extra: Partial<Omit<OrderMinimumLine, 'key' | 'productId' | 'quantity'>> = {},
): OrderMinimumLine => ({
  key,
  productId: P,
  quantity,
  packagingUnitId: null,
  packagingUnitBaseQuantity: null,
  exempt: false,
  ...extra,
});

const piecesRules = (minOrderQuantity: number | null): OrderMinimumRules => ({
  products: [{ id: P, type: 'simple', minOrderQuantity }],
  packagingUnits: [],
});

const unitRules = (minOrderUnits: number | null, baseQuantity = 64): OrderMinimumRules => ({
  products: [{ id: P, type: 'simple', minOrderQuantity: null }],
  packagingUnits: [{ id: U, productId: P, name: 'Pallet', baseQuantity, minOrderUnits }],
});

describe('pieces minimum — the edge', () => {
  it('minimum − 1 is refused, the minimum itself and minimum + 1 are admitted', () => {
    expect(evaluateOrderMinimums([line('l', 9)], piecesRules(10))).toEqual([
      { key: 'l', productId: P, kind: 'pieces', minimum: 10, total: 9 },
    ]);
    expect(evaluateOrderMinimums([line('l', 10)], piecesRules(10))).toEqual([]);
    expect(evaluateOrderMinimums([line('l', 11)], piecesRules(10))).toEqual([]);
  });

  it('the minimum is met by the product total across lines: 4 + 6 is admitted, 4 + 5 is not', () => {
    expect(evaluateOrderMinimums([line('a', 4), line('b', 6)], piecesRules(10))).toEqual([]);
    const violations = evaluateOrderMinimums([line('a', 4), line('b', 5)], piecesRules(10));
    expect(violations.map((v) => v.key)).toEqual(['a', 'b']);
  });

  it('a minimum of 2 (the smallest that is a rule) refuses 1 and admits 2', () => {
    expect(evaluateOrderMinimums([line('l', 1)], piecesRules(2))).toHaveLength(1);
    expect(evaluateOrderMinimums([line('l', 2)], piecesRules(2))).toEqual([]);
  });
});

describe('packaging-unit minimum — the edge', () => {
  it('2 pallets − 1 piece is refused, exactly 2 pallets is admitted', () => {
    const below = evaluateOrderMinimums([line('l', 127, { packagingUnitId: U, packagingUnitBaseQuantity: 64 })], unitRules(2));
    expect(below).toHaveLength(1);
    expect(below[0]).toMatchObject({ kind: 'packaging_unit', minimum: 2, units: 127 / 64 });
    expect(
      evaluateOrderMinimums([line('l', 128, { packagingUnitId: U, packagingUnitBaseQuantity: 64 })], unitRules(2)),
    ).toEqual([]);
  });

  it('a minimum of 1 unit admits exactly one unit', () => {
    expect(
      evaluateOrderMinimums([line('l', 64, { packagingUnitId: U, packagingUnitBaseQuantity: 64 })], unitRules(1)),
    ).toEqual([]);
  });

  it('two variants, one pallet each, meet a minimum of 2; one of them alone does not', () => {
    const both = [
      line('red', 64, { packagingUnitId: U, packagingUnitBaseQuantity: 64 }),
      line('blue', 64, { packagingUnitId: U, packagingUnitBaseQuantity: 64 }),
    ];
    expect(evaluateOrderMinimums(both, unitRules(2))).toEqual([]);
    expect(evaluateOrderMinimums([both[0]!], unitRules(2))).toHaveLength(1);
  });

  it('D2 — lines of 7, 1, 1 and 1 pieces on a base of 10 make exactly one unit (no float drift)', () => {
    // 0.7 + 0.1 + 0.1 + 0.1 is 0.9999999999999999 in floating point.
    const lines = [7, 1, 1, 1].map((quantity, i) =>
      line(`l${i}`, quantity, { packagingUnitId: U, packagingUnitBaseQuantity: 10 }),
    );
    expect(evaluateOrderMinimums(lines, unitRules(1, 10))).toEqual([]);
    expect(evaluateOrderMinimums(lines.slice(0, 3), unitRules(1, 10))).toHaveLength(3);
  });

  it('D2 — lines snapshotted on different bases are summed exactly: 32/64 + 5/10 is one unit', () => {
    const lines = [
      line('old', 32, { packagingUnitId: U, packagingUnitBaseQuantity: 64 }),
      line('new', 5, { packagingUnitId: U, packagingUnitBaseQuantity: 10 }),
    ];
    expect(evaluateOrderMinimums(lines, unitRules(1, 10))).toEqual([]);
    const below = evaluateOrderMinimums([lines[0]!, line('new', 4, { packagingUnitId: U, packagingUnitBaseQuantity: 10 })], unitRules(1, 10));
    expect(below).toHaveLength(2);
    expect(below[0]).toMatchObject({ kind: 'packaging_unit', units: 0.9 });
  });
});

describe('quote-seeded exemption — the edge (FR-028)', () => {
  it('an exempt line at 5 with a minimum of 10 is never flagged; the same line judged non-exempt is', () => {
    expect(evaluateOrderMinimums([line('q', 5, { exempt: true })], piecesRules(10))).toEqual([]);
    expect(evaluateOrderMinimums([line('q', 5, { exempt: false })], piecesRules(10))).toHaveLength(1);
  });

  it('exempt 5 + new 5 = exactly 10 admits the new line; exempt 5 + new 4 = 9 flags only the new line', () => {
    expect(evaluateOrderMinimums([line('q', 5, { exempt: true }), line('n', 5)], piecesRules(10))).toEqual([]);
    const violations = evaluateOrderMinimums([line('q', 5, { exempt: true }), line('n', 4)], piecesRules(10));
    expect(violations.map((v) => v.key)).toEqual(['n']);
  });
});
