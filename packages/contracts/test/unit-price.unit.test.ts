import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  UNIT_PRICE_PRECISION_EXCEEDED,
  fourDecimalUnitPrice,
  fourDecimalUnitPriceString,
  grossUnitPriceHalfUp,
  hasAtMostFourDecimals,
  isAmountPrecisionIssue,
  isUnitPricePrecisionIssue,
  lineAmountHalfUp,
  unitPriceFractionDigits,
  unitPriceHalfUp,
  unitPriceDisplayText,
  vatByRate,
} from '../src/index.js';

/**
 * Owner ruling of 2026-10-25 — a unit price keeps up to four decimal places,
 * unrounded, from the price book to the invoice line; only the line value
 * (`unit × quantity`) is rounded, to two places, once
 * (`specs/pricing/worked-examples.md` §10.18).
 */
describe('a four-place unit price is rounded only at the line value', () => {
  it('charges 0.0125 × 10 000 as 125.00, not 100.00', () => {
    expect(lineAmountHalfUp('0.0125', 10_000)).toBe('125.00');
    // The two-place intake it replaces: 0.0125 → 0.01 → 100.00.
    expect(lineAmountHalfUp('0.01', 10_000)).toBe('100.00');
  });

  it('charges 0.0150 × 3 as 0.05 (0.045 half-up), not 0.06', () => {
    expect(lineAmountHalfUp('0.0150', 3)).toBe('0.05');
    expect(lineAmountHalfUp('0.02', 3)).toBe('0.06');
  });

  it('taxes per rate on the sum of the rounded line nets', () => {
    // 0.0125 × 10 000 = 125.00 at 23 %; 0.0150 × 333 = 4.995 → 5.00 at 8 %.
    const nets = [lineAmountHalfUp('0.0125', 10_000), lineAmountHalfUp('0.0150', 333)];
    expect(nets).toEqual(['125.00', '5.00']);
    const vat = vatByRate(
      [
        { net: nets[0]!, rate: '0.23' },
        { net: nets[1]!, rate: '0.08' },
      ],
      'fraction',
    );
    expect(vat.rows.map((r) => [r.rate, r.net, r.vat, r.gross])).toEqual([
      ['0.08', '5.00', '0.40', '5.40'],
      ['0.23', '125.00', '28.75', '153.75'],
    ]);
    expect([vat.net, vat.vat, vat.gross]).toEqual(['130.00', '29.15', '159.15']);
  });
});

describe('unitPriceHalfUp', () => {
  it('normalises a unit price to four places without rounding a four-place one', () => {
    expect(unitPriceHalfUp('0.0125')).toBe('0.0125');
    expect(unitPriceHalfUp(0.0125)).toBe('0.0125');
    expect(unitPriceHalfUp('1.5')).toBe('1.5000');
    expect(unitPriceHalfUp(29.495)).toBe('29.4950');
    // Five places do not come from a price book; read at four, half-up.
    expect(unitPriceHalfUp('0.01255')).toBe('0.0126');
  });
});

describe('unitPriceFractionDigits / unitPriceDisplayText — the display rule', () => {
  it('shows two places when places three and four are zero', () => {
    expect(unitPriceFractionDigits('1.5000')).toBe(2);
    expect(unitPriceFractionDigits(1.5)).toBe(2);
    expect(unitPriceFractionDigits('10')).toBe(2);
    expect(unitPriceDisplayText('1.5000')).toBe('1.50');
    expect(unitPriceDisplayText('29.5000')).toBe('29.50');
  });

  it('shows its significant places, up to four, otherwise', () => {
    expect(unitPriceFractionDigits('0.0125')).toBe(4);
    expect(unitPriceFractionDigits('1.5050')).toBe(3);
    expect(unitPriceFractionDigits(1.505)).toBe(3);
    expect(unitPriceDisplayText('0.0125')).toBe('0.0125');
    expect(unitPriceDisplayText('1.5050')).toBe('1.505');
    expect(unitPriceDisplayText('0.0150')).toBe('0.015');
  });

  it('reads more than four places at four, half-up', () => {
    expect(unitPriceDisplayText('0.01254')).toBe('0.0125');
    expect(unitPriceDisplayText('1.50001')).toBe('1.50');
  });
});

describe('grossUnitPriceHalfUp', () => {
  it('keeps a two-place net at two places (§10.16 G1)', () => {
    expect(grossUnitPriceHalfUp('29.5000', 23)).toBe('36.29');
    expect(grossUnitPriceHalfUp(16.5, 0.23, 'fraction')).toBe('20.30');
  });

  it('carries a sub-cent net to four places', () => {
    // 0.0125 × 1.23 = 0.015375 → 0.0154; 1.505 × 1.23 = 1.85115 → 1.8512.
    expect(grossUnitPriceHalfUp('0.0125', 23)).toBe('0.0154');
    expect(grossUnitPriceHalfUp('1.5050', 0.23, 'fraction')).toBe('1.8512');
  });
});

describe('hasAtMostFourDecimals', () => {
  it('reads a number as the decimal it is written as; trailing zeros are not significant', () => {
    for (const ok of [0, 1, 0.0125, 1.505, '0.0150', '10', '1.500000']) expect(hasAtMostFourDecimals(ok)).toBe(true);
    for (const bad of [0.00125, '1.50001', 2.67501]) expect(hasAtMostFourDecimals(bad)).toBe(false);
  });
});

describe('fourDecimalUnitPrice', () => {
  const schema = z.object({ price: fourDecimalUnitPrice(z.number().finite().nonnegative()) });

  it('accepts four places and refuses five with the unit-price precision issue', () => {
    expect(schema.safeParse({ price: 0.0125 }).success).toBe(true);
    expect(schema.safeParse({ price: 1.05 }).success).toBe(true);
    const refused = schema.safeParse({ price: 0.01255 });
    expect(refused.success).toBe(false);
    const issue = refused.error!.issues[0]!;
    expect(issue.path).toEqual(['price']);
    expect(issue.message).toBe(UNIT_PRICE_PRECISION_EXCEEDED);
    expect(isUnitPricePrecisionIssue(issue)).toBe(true);
    expect(isAmountPrecisionIssue(issue)).toBe(false);
  });

  it('composes with optional and nullable and keeps the schema’s own checks', () => {
    const optional = z.object({ price: fourDecimalUnitPrice(z.number().nonnegative()).nullable().optional() });
    expect(optional.safeParse({}).success).toBe(true);
    expect(optional.safeParse({ price: null }).success).toBe(true);
    expect(optional.safeParse({ price: -1 }).success).toBe(false);
  });

  it('is the error code the envelope answers with', () => {
    expect(ERROR_CODES.UNIT_PRICE_PRECISION_EXCEEDED).toBe(UNIT_PRICE_PRECISION_EXCEEDED);
  });
});

describe('fourDecimalUnitPriceString', () => {
  const schema = fourDecimalUnitPriceString(z.string().trim());
  const issues = (value: string) => schema.safeParse(value).error?.issues ?? [];

  it('accepts four places, trailing zeros and surrounding whitespace (trimmed)', () => {
    for (const ok of ['0.0125', '1.50', '1.500000', '10', ' 0.0150 ']) expect(issues(ok), ok).toEqual([]);
    expect(schema.parse(' 0.0150 ')).toBe('0.0150');
  });

  it('refuses a significant fifth place with the unit-price precision issue', () => {
    expect(issues('0.01255').map((i) => i.message)).toEqual([UNIT_PRICE_PRECISION_EXCEEDED]);
  });

  it('refuses a malformed string with a format issue only', () => {
    for (const bad of ['', 'abc', '1e3', '1 234,56', '.5']) {
      const found = issues(bad);
      expect(found, bad).toHaveLength(1);
      expect(found[0]!.message, bad).toBe('Not a decimal amount');
    }
  });
});
