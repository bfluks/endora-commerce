import { describe, expect, it } from 'vitest';
import { formatMoney } from '@endora-commerce/admin-kit/lib';

/**
 * Owner ruling of 2026-10-25 (`specs/pricing/worked-examples.md` §10.18) — a
 * unit price shows two places when its third and fourth are zero, otherwise
 * its significant places, up to four; a line value or a total always shows two.
 */
describe('formatMoney — the unit-price display rule', () => {
  it.each([
    [0.0125, /^0,0125\s*zł$/],
    [1.5, /^1,50\s*zł$/],
    [1.505, /^1,505\s*zł$/],
    [29.495, /^29,495\s*zł$/],
    [10, /^10,00\s*zł$/],
  ])('unit price %s', (amount, shown) => {
    expect(formatMoney(amount, 'PLN', undefined, { unitPrice: true })).toMatch(shown);
  });

  it('an amount keeps two places', () => {
    expect(formatMoney(0.0125, 'PLN')).toMatch(/^0,01\s*zł$/);
    expect(formatMoney(125, 'PLN')).toMatch(/^125,00\s*zł$/);
  });

  it('a currency Intl cannot format falls back to the number at the same places', () => {
    expect(formatMoney(0.0125, 'X1', undefined, { unitPrice: true })).toBe('0.0125 X1');
    expect(formatMoney(1.5, 'X1', undefined, { unitPrice: true })).toBe('1.50 X1');
  });
});
