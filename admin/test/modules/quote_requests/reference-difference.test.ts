import { describe, expect, it } from 'vitest';
import { referenceDifference } from '../../../../packages/modules/quote_requests/src/admin/reference-difference';
import {
  adminNumberLocale,
  rfqNumberFormat,
} from '../../../../packages/modules/quote_requests/src/admin/number-format';

/**
 * Feature 146, T046 — the difference between a price (the customer's proposal
 * on Overview, the agreed price being typed in Modify) and the line's reference
 * price: an amount and a percentage of the reference, 2 decimals, signed, and
 * every "not computable" rule of FR-005 (analyze finding L7).
 */
describe('referenceDifference', () => {
  const ref = (amount: number, currency = 'PLN') => ({ amount, currency });

  it('answers amount and percentage for a lower proposal (US1 #1: 100 vs 120)', () => {
    expect(referenceDifference(100, 'PLN', ref(120))).toEqual({ amount: -20, percent: -16.67 });
  });

  it('answers a positive difference for a higher proposal', () => {
    expect(referenceDifference(132, 'PLN', ref(120))).toEqual({ amount: 12, percent: 10 });
  });

  it('issue #430: keeps a sub-cent unit difference at its four places, as the unit prices are', () => {
    expect(referenceDifference(0.0124, 'PLN', ref(0.0125))).toEqual({ amount: -0.0001, percent: -0.8 });
    expect(referenceDifference(9.045, 'PLN', ref(9))).toEqual({ amount: 0.045, percent: 0.5 });
  });

  it('rounds the percentage to two decimals', () => {
    expect(referenceDifference(10.01, 'PLN', ref(3))).toEqual({ amount: 7.01, percent: 233.67 });
    expect(referenceDifference(1, 'PLN', ref(3))).toEqual({ amount: -2, percent: -66.67 });
  });

  it('answers zero, not negative zero, for an equal or nearly equal price', () => {
    const equal = referenceDifference(120, 'PLN', ref(120));
    expect(Object.is(equal?.amount, 0)).toBe(true);
    expect(Object.is(equal?.percent, 0)).toBe(true);
    // Past a unit price's four places (§10.18) there is no difference left.
    const tiny = referenceDifference(119.99999, 'PLN', ref(120));
    expect(Object.is(tiny?.amount, 0)).toBe(true);
  });

  it('answers null when there is no price to compare (no proposal)', () => {
    expect(referenceDifference(null, 'PLN', ref(120))).toBeNull();
  });

  it('answers null when there is no reference', () => {
    expect(referenceDifference(100, 'PLN', null)).toBeNull();
  });

  it('answers null when the reference currency differs from the line currency', () => {
    expect(referenceDifference(100, 'PLN', ref(120, 'EUR'))).toBeNull();
  });

  it('answers the amount and no percentage for a zero reference', () => {
    expect(referenceDifference(5, 'PLN', ref(0))).toEqual({ amount: 5, percent: null });
  });

  it('answers null for a non-finite price', () => {
    expect(referenceDifference(Number.NaN, 'PLN', ref(120))).toBeNull();
  });
});

describe('signed formatting', () => {
  it('prefixes a minus sign (U+2212) and a plus sign, two decimals', () => {
    const f = rfqNumberFormat('en-GB');
    expect(f.signedAmount(-20)).toBe('−20.00');
    expect(f.signedAmount(12)).toBe('+12.00');
    expect(f.signedAmount(0)).toBe('0.00');
    expect(f.signedPercent(-16.67)).toBe('−16.67 %');
    expect(f.signedPercent(10)).toBe('+10.00 %');
    expect(f.signedPercent(0)).toBe('0.00 %');
  });

  it('issue #430: a unit difference shows its significant places, up to four, never a 0.00 for a real one', () => {
    const f = rfqNumberFormat('pl-PL');
    expect(f.signedUnitAmount(-0.0001)).toBe('−0,0001');
    expect(f.signedUnitAmount(0.045)).toBe('+0,045');
    expect(f.signedUnitAmount(12)).toBe('+12,00');
    expect(f.signedUnitAmount(0)).toBe('0,00');
  });
});

/** Review fix round 1 (part B, N3) — one formatting, in the admin's language. */
describe('rfqNumberFormat', () => {
  it('formats in the admin language’s conventions', () => {
    expect(adminNumberLocale('en')).toBe('en-GB');
    expect(adminNumberLocale('pl')).toBe('pl-PL');
    const en = rfqNumberFormat(adminNumberLocale('en'));
    expect(en.money(1234.5, 'PLN')).toBe('1,234.50 PLN');
    const pl = rfqNumberFormat(adminNumberLocale('pl'));
    expect(pl.amount(120)).toBe('120,00');
    expect(pl.signedAmount(-20)).toBe('−20,00');
    expect(pl.signedPercent(-16.67)).toBe('−16,67 %');
    expect(pl.money(1234.5, 'PLN')).toBe(
      `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2 }).format(1234.5)} PLN`,
    );
  });
});
