import { describe, expect, it } from 'vitest';
import {
  checkRequestedQuantities,
  isLineReturnable,
  nonReturnableRequestedLines,
  requestedTotals,
  returnableVerdict,
  type EligibilityContextLine,
} from './return-eligibility.js';

/**
 * Feature 155, Phase 12a (T089) — the returns policy for the line-level
 * returnable flag (`specs/155-catalog-order-constraints/contracts/returns-api.md`
 * §2–§3; FR-017 – FR-020, FR-025, FR-033).
 */

const R = 'aaaaaaaa-0000-4000-8000-000000000001';
const N = 'aaaaaaaa-0000-4000-8000-000000000002';
const P = 'aaaaaaaa-0000-4000-8000-000000000003';
const UNKNOWN = 'aaaaaaaa-0000-4000-8000-0000000000ff';

const ctx: EligibilityContextLine[] = [
  { orderItemId: R, name: 'Returnable', purchasedQty: 4, returnableAtPurchase: true },
  { orderItemId: N, name: 'Final sale', purchasedQty: 3, returnableAtPurchase: false },
  { orderItemId: P, name: 'Pre-feature', purchasedQty: 2, returnableAtPurchase: null },
];

describe('isLineReturnable (FR-017, FR-025)', () => {
  it('a line stamped true is returnable', () => {
    expect(isLineReturnable(true)).toBe(true);
  });
  it('a line stamped false is not returnable (incl. the fail-closed stamp, US6 #9)', () => {
    expect(isLineReturnable(false)).toBe(false);
  });
  it('a line placed before the feature (null) is returnable', () => {
    expect(isLineReturnable(null)).toBe(true);
  });
});

describe('returnableVerdict — reason precedence', () => {
  it('order_not_completing wins over everything', () => {
    expect(
      returnableVerdict(false, [
        { remainingReturnableQty: 0, returnable: false },
      ]),
    ).toEqual({ eligible: false, reason: 'order_not_completing' });
  });

  it('fully_returned wins over no_returnable_lines', () => {
    expect(
      returnableVerdict(true, [
        { remainingReturnableQty: 0, returnable: false },
        { remainingReturnableQty: 0, returnable: true },
      ]),
    ).toEqual({ eligible: false, reason: 'fully_returned' });
  });

  it('no_returnable_lines when every line is non-returnable', () => {
    expect(
      returnableVerdict(true, [
        { remainingReturnableQty: 2, returnable: false },
        { remainingReturnableQty: 1, returnable: false },
      ]),
    ).toEqual({ eligible: false, reason: 'no_returnable_lines' });
  });

  it('no_returnable_lines when the returnable lines are used up and only non-returnable quantity is left', () => {
    expect(
      returnableVerdict(true, [
        { remainingReturnableQty: 0, returnable: true },
        { remainingReturnableQty: 3, returnable: false },
      ]),
    ).toEqual({ eligible: false, reason: 'no_returnable_lines' });
  });

  it('eligible with at least one returnable line with quantity left', () => {
    expect(
      returnableVerdict(true, [
        { remainingReturnableQty: 1, returnable: true },
        { remainingReturnableQty: 3, returnable: false },
      ]),
    ).toEqual({ eligible: true });
  });
});

describe('requestedTotals (FR-033)', () => {
  it('sums the requested quantities per orderItemId', () => {
    const totals = requestedTotals([
      { orderItemId: R, quantity: 2 },
      { orderItemId: N, quantity: 1 },
      { orderItemId: R, quantity: 2 },
    ]);
    expect(Object.fromEntries(totals)).toEqual({ [R]: 4, [N]: 1 });
  });
});

describe('checkRequestedQuantities — per-line totals, both kinds (FR-033, SC-006)', () => {
  const none = new Map<string, number>();

  it('refuses 3 + 3 against 4 remaining, judged on the sum', () => {
    expect(
      checkRequestedQuantities(
        [
          { orderItemId: R, quantity: 3 },
          { orderItemId: R, quantity: 3 },
        ],
        ctx,
        none,
      ),
    ).toEqual({ code: 'qty_exceeds_returnable', orderItemId: R, requested: 6, remaining: 4 });
  });

  it('accepts 2 + 2 against 4 remaining', () => {
    expect(
      checkRequestedQuantities(
        [
          { orderItemId: R, quantity: 2 },
          { orderItemId: R, quantity: 2 },
        ],
        ctx,
        none,
      ),
    ).toBeNull();
  });

  it('counts what live cases already consumed', () => {
    expect(
      checkRequestedQuantities([{ orderItemId: R, quantity: 1 }], ctx, new Map([[R, 4]])),
    ).toEqual({ code: 'qty_exceeds_returnable', orderItemId: R, requested: 1, remaining: 0 });
  });

  it('keeps unknown_line for an orderItemId that is not on the order', () => {
    expect(checkRequestedQuantities([{ orderItemId: UNKNOWN, quantity: 1 }], ctx, none)).toEqual({
      code: 'unknown_line',
    });
  });

  it('does not consider returnability — a non-returnable line within its quantity passes', () => {
    expect(checkRequestedQuantities([{ orderItemId: N, quantity: 3 }], ctx, none)).toBeNull();
  });
});

describe('nonReturnableRequestedLines (FR-019, FR-020)', () => {
  it('a return including a non-returnable line lists every such line once, in request order', () => {
    expect(
      nonReturnableRequestedLines(
        'return',
        [
          { orderItemId: N, quantity: 1 },
          { orderItemId: R, quantity: 1 },
          { orderItemId: N, quantity: 1 },
        ],
        [...ctx, { orderItemId: UNKNOWN, name: 'Other final', purchasedQty: 1, returnableAtPurchase: false }],
      ),
    ).toEqual([{ orderItemId: N, productName: 'Final sale' }]);
  });

  it('lists two distinct non-returnable lines each once', () => {
    const second = 'aaaaaaaa-0000-4000-8000-000000000004';
    expect(
      nonReturnableRequestedLines(
        'return',
        [
          { orderItemId: second, quantity: 1 },
          { orderItemId: N, quantity: 1 },
          { orderItemId: second, quantity: 1 },
        ],
        [...ctx, { orderItemId: second, name: 'Second final', purchasedQty: 2, returnableAtPurchase: false }],
      ),
    ).toEqual([
      { orderItemId: second, productName: 'Second final' },
      { orderItemId: N, productName: 'Final sale' },
    ]);
  });

  it('a return of returnable and pre-feature lines is not refused', () => {
    expect(
      nonReturnableRequestedLines(
        'return',
        [
          { orderItemId: R, quantity: 1 },
          { orderItemId: P, quantity: 1 },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it('a complaint is never checked', () => {
    expect(nonReturnableRequestedLines('complaint', [{ orderItemId: N, quantity: 1 }], ctx)).toEqual([]);
  });
});
