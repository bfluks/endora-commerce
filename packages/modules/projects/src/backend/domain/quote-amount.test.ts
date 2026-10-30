import { describe, expect, it } from 'vitest';
import { quoteRequestAmount } from './quote-amount.js';

/**
 * What a linked Quote Request is shown as worth (User Story 6): the sum over
 * its lines of quantity × the agreed unit price, or the asked one while none
 * is agreed — the two the quote desk shows per line — to two places, half up.
 */
describe('quoteRequestAmount', () => {
  it('sums quantity × unit price, preferring the agreed price, in the first line’s currency', () => {
    expect(
      quoteRequestAmount([
        { quantity: 3, agreedUnitPrice: null, desiredUnitPrice: '12.50', lineCurrency: 'PLN' },
        { quantity: 2, agreedUnitPrice: '10.00', desiredUnitPrice: '11.00', lineCurrency: 'PLN' },
      ]),
    ).toEqual({ amount: '57.50', currency: 'PLN' });
  });

  it('rounds to two places, half up, once on the sum', () => {
    expect(
      quoteRequestAmount([
        { quantity: 3, agreedUnitPrice: '0.3333', desiredUnitPrice: null, lineCurrency: 'EUR' },
        { quantity: 1, agreedUnitPrice: '0.0050', desiredUnitPrice: null, lineCurrency: 'EUR' },
      ]),
    ).toEqual({ amount: '1.00', currency: 'EUR' });
  });

  it('counts a line with no price as nothing, and has no currency with no lines', () => {
    expect(quoteRequestAmount([{ quantity: 4, agreedUnitPrice: null, desiredUnitPrice: null, lineCurrency: 'PLN' }])).toEqual({
      amount: '0.00',
      currency: 'PLN',
    });
    expect(quoteRequestAmount([])).toEqual({ amount: '0.00', currency: null });
  });
});
