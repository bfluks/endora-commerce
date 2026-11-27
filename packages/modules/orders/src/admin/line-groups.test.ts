import { describe, expect, it } from 'vitest';
import { orderSectionTotals } from './line-groups.js';

/**
 * Issue #417 — a section summary on the admin order screens, in exact decimal
 * arithmetic under the order's own rule (`specs/pricing/worked-examples.md`
 * §10.17): the one VAT method — per rate, on the sum of the nets — on the
 * create screen and for a placed order alike (issue #428).
 */
describe('orderSectionTotals', () => {
  it('rounds the create screen VAT half-up on the exact sum, not the binary 0.03 (T1)', () => {
    // `Math.round(0.7 * 0.05 * 100) / 100` is 0.03; the exact tax is 0.035.
    expect(orderSectionTotals([{ net: 0.7, taxRate: 0.05 }])).toEqual({ count: 1, net: 0.7, vat: 0.04, gross: 0.74 });
  });

  it('takes VAT per rate on the sum of the nets (V2, owner ruling of 2026-10-24)', () => {
    expect(
      orderSectionTotals([
        { net: 29.5, taxRate: 0.23 },
        { net: 4.3, taxRate: 0.05 },
      ]),
    ).toEqual({ count: 2, net: 33.8, vat: 7.01, gross: 40.81 });
    const line = { net: 0.02, taxRate: 0.23 };
    expect(orderSectionTotals([line, line, line])).toEqual({ count: 3, net: 0.06, vat: 0.01, gross: 0.07 });
  });

  it('never adds up a placed order’s line grosses, which may be a cent away (#428, L1)', () => {
    // The stored line totals 36.29 + 4.31 = 40.60 are each line's own rounding;
    // the section is 33.00 net at 23 %, 7.59 VAT, 40.59 gross.
    expect(
      orderSectionTotals([
        { net: 29.5, taxRate: 0.23 },
        { net: 3.5, taxRate: 0.23 },
      ]),
    ).toEqual({ count: 2, net: 33, vat: 7.59, gross: 40.59 });
  });

  it('is null unless every line is priced', () => {
    expect(orderSectionTotals([{ net: null, taxRate: 0.23 }])).toEqual({ count: 1, net: null, vat: null, gross: null });
  });
});
