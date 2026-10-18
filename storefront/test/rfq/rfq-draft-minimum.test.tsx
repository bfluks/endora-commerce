import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DraftLine, strings } from '../../components/rfq/RfqDraftView';
import { AddToRfqButton } from '../../components/rfq/AddToRfqButton';
import { addToRfqDraft, clampDraftQuantity, type RfqDraftItem } from '../../lib/rfqDraft';
import { quoteAddQuantity } from '../../lib/orderMinimum';

/**
 * Feature 154, FR-032 (US4 #13, #14) — the storefront quote-request draft mirrors the cart
 * for the pieces minimum.
 *
 * `RfqDraftView` reads its lines from `localStorage` in an effect, so a server render of the
 * whole view shows an empty draft and would pass vacuously (146 T078). The units the minimum
 * reaches are tested on their own: the line, the quantity clamp, the pure add, and the
 * quantity every "add to quote" starts at.
 */
const line: RfqDraftItem = {
  productId: 'prod-1',
  slug: 'widget',
  name: 'Widget',
  unitPrice: { amount: 12, currency: 'PLN' },
  proposedUnitPrice: null,
  quantity: 3,
};

function renderLine(input: {
  quantity: number;
  minimum: number | null;
  locale: string;
}): string {
  return renderToString(
    <DraftLine
      line={{ ...line, quantity: input.quantity }}
      t={strings(input.locale.startsWith('pl'))}
      locale={input.locale}
      minimum={input.minimum}
      proposalsAllowed
      onQty={(): void => undefined}
      onProposedPrice={(): void => undefined}
      onRemove={(): void => undefined}
    />,
  );
}

/** The quantity input of the line, found by its accessible name (the price input is a number too). */
function qtyInput(html: string, label: string): string {
  const match = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`));
  expect(match, `quantity input "${label}"`).not.toBeNull();
  return match![0];
}

describe('DraftLine — a line below the minimum (US4 #14)', () => {
  it.each([
    ['en-US', 'Quantity', 'Below the minimum (10 pcs)', 'Set to 10 pcs', 'Remove'],
    ['pl-PL', 'Ilość', 'Poniżej minimum (10 szt.)', 'Ustaw 10 szt.', 'Usuń'],
  ])('is shown as such, with the minimum, and can still be removed (%s)', (locale, qty, below, fix, remove) => {
    const html = renderLine({ quantity: 3, minimum: 10, locale });
    const input = qtyInput(html, qty);
    expect(input).toContain('min="10"');
    expect(input).toContain('value="3"');
    expect(input).toContain('aria-invalid="true"');
    expect(html).toContain(below);
    expect(html).toContain(fix);
    expect(html).toContain(`aria-label="${remove}"`);
  });

  it('links the warning to the quantity input', () => {
    const html = renderLine({ quantity: 3, minimum: 10, locale: 'en-US' });
    const describedBy = qtyInput(html, 'Quantity').match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });
});

describe('DraftLine — a line at or above the minimum (US4 #14)', () => {
  it('floors the input at the minimum and offers no step below it', () => {
    const html = renderLine({ quantity: 10, minimum: 10, locale: 'en-US' });
    const input = qtyInput(html, 'Quantity');
    expect(input).toContain('min="10"');
    expect(input).not.toContain('aria-invalid');
    expect(html).not.toContain('Below the minimum');
    // The "−" step is disabled at the floor.
    const minus = html.match(/<button[^>]*aria-label="−"[^>]*>/)?.[0] ?? '';
    expect(minus).toContain('disabled=""');
    // The minimum is still stated beside the line.
    expect(html).toContain('Minimum order: 10 pcs');
  });

  it('is unchanged without a minimum', () => {
    const html = renderLine({ quantity: 3, minimum: null, locale: 'en-US' });
    expect(qtyInput(html, 'Quantity')).toContain('min="1"');
    expect(html).not.toContain('Below the minimum');
    expect(html).not.toContain('Minimum order');
  });
});

describe('clampDraftQuantity', () => {
  it('never goes below the minimum', () => {
    expect(clampDraftQuantity(9, 10)).toBe(10);
    expect(clampDraftQuantity(2, 10)).toBe(10);
    expect(clampDraftQuantity(15, 10)).toBe(15);
  });

  it('floors at 1 without a minimum and normalises what was typed', () => {
    expect(clampDraftQuantity(0, null)).toBe(1);
    expect(clampDraftQuantity(4.7, null)).toBe(4);
    expect(clampDraftQuantity(Number.NaN, 10)).toBe(10);
    expect(clampDraftQuantity(Number.NaN, null)).toBe(1);
  });
});

describe('addToRfqDraft (pure)', () => {
  const item = { productId: 'prod-1', slug: 'widget', name: 'Widget', unitPrice: null };

  it('starts a new line at the minimum when asked for less', () => {
    const next = addToRfqDraft([], { ...item, quantity: 1 }, 10);
    expect(next).toHaveLength(1);
    expect(next[0]?.quantity).toBe(10);
  });

  it('keeps a requested quantity above the minimum', () => {
    expect(addToRfqDraft([], { ...item, quantity: 25 }, 10)[0]?.quantity).toBe(25);
  });

  it('adds 1 (unchanged) without a minimum', () => {
    expect(addToRfqDraft([], item)[0]?.quantity).toBe(1);
  });

  it('adds onto an existing line and leaves the passed-in array untouched', () => {
    const existing: RfqDraftItem[] = [{ ...line, quantity: 3 }];
    const next = addToRfqDraft(existing, { ...item, quantity: 10 }, 10);
    expect(next[0]?.quantity).toBe(13);
    expect(existing[0]?.quantity).toBe(3);
  });

  it('lifts an existing line to the minimum when the sum is still below it', () => {
    const existing: RfqDraftItem[] = [{ ...line, quantity: 3 }];
    expect(addToRfqDraft(existing, { ...item, quantity: 1 }, 10)[0]?.quantity).toBe(10);
  });
});

describe('quoteAddQuantity — what every "add to quote" starts at (US4 #13)', () => {
  it('is the minimum when the product has one, else 1', () => {
    expect(quoteAddQuantity(10)).toBe(10);
    expect(quoteAddQuantity(null)).toBe(1);
    expect(quoteAddQuantity(undefined)).toBe(1);
    expect(quoteAddQuantity(1)).toBe(1);
  });
});

describe('AddToRfqButton — the quote CTA shown when prices are hidden (US4 #13)', () => {
  it('starts its quantity input at the minimum and does not offer less', () => {
    const html = renderToString(
      <AddToRfqButton
        productId="prod-1"
        productSlug="widget"
        productName="Widget"
        withQuantity
        minOrderQuantity={10}
        locale="en-US"
      />,
    );
    const input = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('min="10"');
    expect(input).toContain('value="10"');
  });

  it('starts at 1 without a minimum', () => {
    const html = renderToString(
      <AddToRfqButton productId="prod-1" productSlug="widget" productName="Widget" withQuantity locale="en-US" />,
    );
    const input = html.match(/<input[^>]*type="number"[^>]*>/)?.[0] ?? '';
    expect(input).toContain('min="1"');
    expect(input).toContain('value="1"');
  });
});
