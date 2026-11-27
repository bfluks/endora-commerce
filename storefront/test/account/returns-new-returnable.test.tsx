import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ReturnableResponse } from '../../lib/api/returns';
import { returnFormModel } from '../../lib/returns/returnForm';
import { ReturnFormLines } from '../../components/returns/ReturnFormLines';

/**
 * Feature 155, FR-021 (US6 #1, #3, #4) — the storefront return form reads the per-line
 * returnability (`contracts/returns-api.md` §2).
 *
 * A non-returnable line is shown, not selectable for a return, with its reason; complaints
 * are never restricted (FR-020), so in complaint mode every line is selectable. When no line
 * is returnable (`eligible: false`, `reason: 'no_returnable_lines'`) the page no longer
 * replaces the whole form: it offers a complaint only (FR-018, analyze F13).
 */
function line(
  id: string,
  overrides: Partial<ReturnableResponse['lines'][number]> = {},
): ReturnableResponse['lines'][number] {
  return {
    orderItemId: id,
    productId: `prod-${id}`,
    name: `Product ${id}`,
    purchasedQty: 4,
    remainingReturnableQty: 4,
    paidUnitAmount: 10,
    currency: 'PLN',
    returnable: true,
    ...overrides,
  };
}

const mixed: ReturnableResponse = {
  eligible: true,
  freeReturnEligible: false,
  lines: [
    line('a'),
    line('b', { returnable: false, notReturnableReason: 'product_not_returnable' }),
    line('c', { remainingReturnableQty: 0 }),
  ],
};

const nothingReturnable: ReturnableResponse = {
  eligible: false,
  reason: 'no_returnable_lines',
  freeReturnEligible: false,
  lines: [line('b', { returnable: false, notReturnableReason: 'product_not_returnable' })],
};

describe('returnFormModel — mode (US6 #1, #3, #4)', () => {
  it('offers both kinds when at least one line is returnable', () => {
    const model = returnFormModel(mixed, 'en-US');
    expect(model.mode).toBe('return_and_complaint');
    expect(model.kind).toBe('return');
    expect(model.notice).toBeNull();
  });

  it.each([
    ['en-US', 'No products in this order are returnable'],
    ['pl-PL', 'Żaden produkt z tego zamówienia nie podlega zwrotowi'],
  ])('offers a complaint only for no_returnable_lines (%s)', (locale, sentence) => {
    const model = returnFormModel(nothingReturnable, locale);
    expect(model.mode).toBe('complaint_only');
    expect(model.kind).toBe('complaint');
    expect(model.notice).toContain(sentence);
    // A complaint about a non-returnable line is possible (FR-020).
    expect(model.lines.map((l) => [l.orderItemId, l.selectable])).toEqual([['b', true]]);
  });

  it('keeps complaint mode even when a return is asked for', () => {
    expect(returnFormModel(nothingReturnable, 'en-US', 'return').kind).toBe('complaint');
  });

  it.each([
    ['order_not_completing', 'not yet eligible'],
    ['fully_returned', 'already been returned'],
    ['window_passed', 'no longer'],
  ] as const)('offers nothing for %s', (reason, sentence) => {
    const model = returnFormModel(
      { eligible: false, reason, freeReturnEligible: false, lines: [line('a')] },
      'en-US',
    );
    expect(model.mode).toBe('none');
    expect(model.kind).toBeNull();
    expect(model.lines).toEqual([]);
    expect(model.notice).toContain(sentence);
  });

  it('words the "none" notice in Polish', () => {
    const model = returnFormModel(
      { eligible: false, reason: 'fully_returned', freeReturnEligible: false, lines: [] },
      'pl-PL',
    );
    expect(model.notice).toContain('zwrócone');
  });
});

describe('returnFormModel — lines', () => {
  it('drops lines with nothing left to return and marks the non-returnable ones', () => {
    const model = returnFormModel(mixed, 'en-US');
    expect(model.lines.map((l) => l.orderItemId)).toEqual(['a', 'b']);
    const [a, b] = model.lines;
    expect(a).toMatchObject({ returnable: true, selectable: true, notReturnableText: null });
    expect(b).toMatchObject({ returnable: false, selectable: false });
    expect(b?.notReturnableText).toContain('cannot be returned');
  });

  it('words the reason in Polish', () => {
    const b = returnFormModel(mixed, 'pl-PL').lines[1];
    expect(b?.notReturnableText).toContain('nie podlega zwrotowi');
  });

  it('makes every line selectable for a complaint (FR-020)', () => {
    const model = returnFormModel(mixed, 'en-US', 'complaint');
    expect(model.kind).toBe('complaint');
    expect(model.lines.every((l) => l.selectable)).toBe(true);
    // The reason stays visible, it just does not stop a complaint.
    expect(model.lines[1]?.notReturnableText).toContain('cannot be returned');
  });
});

describe('ReturnFormLines — rendered line list', () => {
  const reasons = [{ id: 'r1', label: { en: 'Damaged', pl: 'Uszkodzony' } }];

  it('renders a non-returnable line as not selectable, with its reason linked', () => {
    const html = renderToString(
      <ReturnFormLines lines={returnFormModel(mixed, 'en-US').lines} reasons={reasons} locale="en-US" />,
    );
    const checkboxA = html.match(/<input[^>]*name="include_a"[^>]*>/)?.[0] ?? '';
    const checkboxB = html.match(/<input[^>]*name="include_b"[^>]*>/)?.[0] ?? '';
    expect(checkboxA).not.toBe('');
    expect(checkboxA).not.toContain('disabled');
    expect(checkboxB).toContain('disabled');
    const describedBy = checkboxB.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain('cannot be returned');
    expect(html).toContain('Product b');
    expect(html).not.toContain('Product c');
  });

  it('renders every line selectable in complaint mode, in Polish', () => {
    const html = renderToString(
      <ReturnFormLines
        lines={returnFormModel(nothingReturnable, 'pl-PL').lines}
        reasons={reasons}
        locale="pl-PL"
      />,
    );
    const checkboxB = html.match(/<input[^>]*name="include_b"[^>]*>/)?.[0] ?? '';
    expect(checkboxB).not.toContain('disabled');
    expect(html).toContain('Uszkodzony');
    expect(html).toContain('nie podlega zwrotowi');
  });
});
