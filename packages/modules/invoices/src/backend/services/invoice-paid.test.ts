import { describe, expect, it } from 'vitest';
import type { OrderReturnRefund } from '@endora-commerce/contracts';
import { invoicePaidPosition, type InvoicePaidInput } from './invoice-paid.js';

/**
 * Issue #428 points 1 and 6 — what an invoice records as paid, and whether the
 * order was refunded in full before it was invoiced (owner rulings of
 * 2026-10-24: paid = captured − refunded; no invoice for an order refunded in
 * full before invoicing). `specs/pricing/worked-examples.md` §10.17.
 */

function input(over: Partial<InvoicePaidInput>): InvoicePaidInput {
  return {
    orderTotal: '100.00',
    paymentStatus: 'paid',
    paymentKind: 'bank_transfer',
    payments: null,
    returnRefunds: [],
    ...over,
  };
}

const refund = (over: Partial<OrderReturnRefund>): OrderReturnRefund => ({
  resolutionType: 'refund',
  amount: '0.00',
  settlementState: 'issued',
  ...over,
});

describe('invoicePaidPosition — refunds through payments (#417)', () => {
  it('records what was captured less what was refunded from it', () => {
    expect(
      invoicePaidPosition(input({ paymentKind: 'gateway', payments: { captured: '100.00', refunded: '30.00' } })),
    ).toEqual({ paid: '70.00', refunded: '30.00', refundedInFull: false });
  });

  it('records the stored total for an order paid with nothing captured', () => {
    expect(invoicePaidPosition(input({}))).toEqual({ paid: '100.00', refunded: '0.00', refundedInFull: false });
  });

  it('records nothing for an order not paid', () => {
    expect(invoicePaidPosition(input({ paymentStatus: 'awaiting_payment' }))).toEqual({
      paid: '0.00',
      refunded: '0.00',
      refundedInFull: false,
    });
  });

  it('is refunded in full when the gateway refunds cover what was captured and the order', () => {
    expect(
      invoicePaidPosition(input({ paymentKind: 'gateway', payments: { captured: '100.00', refunded: '100.00' } })),
    ).toMatchObject({ paid: '0.00', refundedInFull: true });
  });
});

describe('invoicePaidPosition — refunds made outside payments (#428 point 1)', () => {
  it('deducts a manual bank-transfer refund of a settled return', () => {
    expect(
      invoicePaidPosition(input({ returnRefunds: [refund({ amount: '40.00' })] })),
    ).toEqual({ paid: '60.00', refunded: '40.00', refundedInFull: false });
  });

  it('deducts a credit-limit top-up of a settled return, whatever the payment method', () => {
    expect(
      invoicePaidPosition(
        input({
          paymentKind: 'gateway',
          payments: { captured: '100.00', refunded: '0.00' },
          returnRefunds: [refund({ resolutionType: 'credit', amount: '25.00' })],
        }),
      ),
    ).toEqual({ paid: '75.00', refunded: '25.00', refundedInFull: false });
  });

  it('does not count a gateway order’s refund twice: payments reports it', () => {
    // The settlement refunded 30.00 through the PSP, whose webhook recorded it on
    // the payment: the returns row and the payment row are one refund.
    expect(
      invoicePaidPosition(
        input({
          paymentKind: 'gateway',
          payments: { captured: '100.00', refunded: '30.00' },
          returnRefunds: [refund({ amount: '30.00' })],
        }),
      ),
    ).toEqual({ paid: '70.00', refunded: '30.00', refundedInFull: false });
  });

  it('does not count a refund still waiting for a person, or a credit nothing applied', () => {
    expect(
      invoicePaidPosition(
        input({
          returnRefunds: [
            refund({ amount: '40.00', settlementState: 'pending_manual' }),
            refund({ resolutionType: 'credit', amount: '10.00', settlementState: 'pending_manual' }),
          ],
        }),
      ),
    ).toEqual({ paid: '100.00', refunded: '0.00', refundedInFull: false });
  });

  it('is refunded in full when manual refunds return the whole order', () => {
    expect(
      invoicePaidPosition(input({ returnRefunds: [refund({ amount: '60.00' }), refund({ amount: '40.00' })] })),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });

  it('is refunded in full when a gateway refund and a store credit together return the whole order', () => {
    expect(
      invoicePaidPosition(
        input({
          paymentKind: 'gateway',
          payments: { captured: '100.00', refunded: '70.00' },
          returnRefunds: [refund({ amount: '70.00' }), refund({ resolutionType: 'credit', amount: '30.00' })],
        }),
      ),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });

  it('reads an order an operator marked refunded, with nothing captured, as refunded in full — once', () => {
    expect(invoicePaidPosition(input({ paymentStatus: 'refunded' }))).toEqual({
      paid: '0.00',
      refunded: '100.00',
      refundedInFull: true,
    });
    // The manual refund of a settled return is part of that same refund, not a second one.
    expect(
      invoicePaidPosition(input({ paymentStatus: 'refunded', returnRefunds: [refund({ amount: '100.00' })] })),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });
});

describe('invoicePaidPosition — on account (#428 point 6)', () => {
  it('records nothing paid for an order on credit terms, which is unpaid by arrangement', () => {
    expect(invoicePaidPosition(input({ paymentStatus: 'deferred', paymentKind: 'credit_limit' }))).toEqual({
      paid: '0.00',
      refunded: '0.00',
      refundedInFull: false,
    });
  });

  it('records paid 0 when the captured part was refunded in full and the on-account part is outstanding', () => {
    // 100.00 order: 40.00 captured by card and refunded, 60.00 on account. The
    // buyer keeps nothing paid and still owes the 60.00 on account, so paid 0 is
    // right — and the refunds (40.00) do not cover the order, so it is invoiced.
    expect(
      invoicePaidPosition(
        input({
          paymentStatus: 'deferred',
          paymentKind: 'gateway',
          payments: { captured: '40.00', refunded: '40.00' },
        }),
      ),
    ).toEqual({ paid: '0.00', refunded: '40.00', refundedInFull: false });
  });

  it('never records a negative paid amount when a store credit exceeds what was paid', () => {
    // On account, nothing paid, a return of 30.00 credited back to the credit limit.
    expect(
      invoicePaidPosition(
        input({
          paymentStatus: 'deferred',
          paymentKind: 'credit_limit',
          returnRefunds: [refund({ resolutionType: 'credit', amount: '30.00' })],
        }),
      ),
    ).toEqual({ paid: '0.00', refunded: '30.00', refundedInFull: false });
  });
});

describe('invoicePaidPosition — a zero-total order (review of PR #434)', () => {
  it('invoices a zero-total order with nothing paid: nothing was refunded', () => {
    // A 100 % coupon with free delivery: received 0.00, refunded 0.00. "Refunded
    // in full" needs a refund that happened; none did, so the sale is invoiced.
    expect(invoicePaidPosition(input({ orderTotal: '0.00', paymentStatus: 'paid' }))).toEqual({
      paid: '0.00',
      refunded: '0.00',
      refundedInFull: false,
    });
    expect(invoicePaidPosition(input({ orderTotal: '0.00', paymentStatus: 'awaiting_payment' }))).toMatchObject({
      refundedInFull: false,
    });
  });

  it('invoices a zero-total order an operator marked refunded: there was no money to return', () => {
    // The mark says the order's total was refunded, and that total is 0.00: no
    // money moved either way, so nothing was refunded and the sale (goods given
    // free) is still documented — paid 0.00, due 0.00.
    expect(invoicePaidPosition(input({ orderTotal: '0.00', paymentStatus: 'refunded' }))).toEqual({
      paid: '0.00',
      refunded: '0.00',
      refundedInFull: false,
    });
  });
});

describe('invoicePaidPosition — a captured order marked refunded by hand (owner ruling on PR #434)', () => {
  it('counts the mark as a refund of everything received', () => {
    // Captured 100.00 by the gateway, refunded by hand after a refund anomaly:
    // the payment row records nothing, the operator's mark says refunded.
    expect(
      invoicePaidPosition(
        input({ paymentStatus: 'refunded', paymentKind: 'gateway', payments: { captured: '100.00', refunded: '0.00' } }),
      ),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });

  it('does not add a gateway refund already on the payment row to the mark', () => {
    // 100.00 refunded through the gateway (which also marks the order refunded):
    // one refund, not two.
    expect(
      invoicePaidPosition(
        input({ paymentStatus: 'refunded', paymentKind: 'gateway', payments: { captured: '100.00', refunded: '100.00' } }),
      ),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });

  it('takes the larger of the recorded refunds and what was received, never their sum', () => {
    // 30.00 refunded through the gateway, 10.00 credited by a return, then the
    // rest refunded by hand and the order marked refunded: 100.00 refunded.
    expect(
      invoicePaidPosition(
        input({
          paymentStatus: 'refunded',
          paymentKind: 'gateway',
          payments: { captured: '100.00', refunded: '30.00' },
          returnRefunds: [refund({ resolutionType: 'credit', amount: '10.00' })],
        }),
      ),
    ).toEqual({ paid: '0.00', refunded: '100.00', refundedInFull: true });
  });
});
