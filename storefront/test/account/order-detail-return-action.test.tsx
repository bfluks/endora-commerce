import { describe, expect, it } from 'vitest';
import type { ReturnableResponse } from '../../lib/api/returns';
import { orderReturnAction } from '../../lib/returns/returnForm';

/**
 * Feature 155, FR-021 / FR-018 — the order detail page offers the action the order's
 * returnability allows: a return (with complaints) when any line is returnable, a complaint
 * only when none is (`no_returnable_lines`), nothing otherwise. Until this feature the page
 * read `eligible` alone and hid the entry for an order whose products are all non-returnable,
 * though a complaint about it is still accepted.
 */
function answer(input: Partial<ReturnableResponse>): ReturnableResponse {
  return { eligible: false, freeReturnEligible: false, lines: [], ...input };
}

describe('orderReturnAction', () => {
  it.each([
    ['en-US', 'Request return / complaint'],
    ['pl-PL', 'Zgłoś zwrot / reklamację'],
  ])('is a return when the order is eligible (%s)', (locale, label) => {
    const action = orderReturnAction(answer({ eligible: true }), 'order-1', locale);
    expect(action).toEqual({
      kind: 'return',
      label,
      href: '/returns/new?orderId=order-1',
    });
  });

  it.each([
    ['en-US', 'File a complaint'],
    ['pl-PL', 'Złóż reklamację'],
  ])('is a complaint for no_returnable_lines (%s)', (locale, label) => {
    const action = orderReturnAction(answer({ reason: 'no_returnable_lines' }), 'order-1', locale);
    expect(action).toEqual({
      kind: 'complaint',
      label,
      href: '/returns/new?orderId=order-1&kind=complaint',
    });
  });

  it.each(['order_not_completing', 'fully_returned', 'window_passed'] as const)(
    'is null for %s',
    (reason) => {
      expect(orderReturnAction(answer({ reason }), 'order-1', 'en-US')).toBeNull();
    },
  );

  it('is null for an ineligible answer without a reason', () => {
    expect(orderReturnAction(answer({}), 'order-1', 'en-US')).toBeNull();
  });

  it('encodes the order id in the link', () => {
    expect(orderReturnAction(answer({ eligible: true }), 'a b', 'en-US')?.href).toBe(
      '/returns/new?orderId=a%20b',
    );
  });
});
