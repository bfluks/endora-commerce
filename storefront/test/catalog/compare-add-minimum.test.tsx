import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CompareAddToCartButton } from '../../components/CompareAddToCartButton';
import { cardAddToCartPayload, cardAddQuantity } from '../../lib/orderMinimum';

/**
 * Feature 155 / FR-016 (US4 #12) — the comparison's "add to cart" adds the minimum at once, and
 * says so next to the button.
 */
describe('comparison add-to-cart quantity', () => {
  it('adds the minimum, or 1 without one', () => {
    expect(cardAddQuantity(25)).toBe(25);
    expect(cardAddToCartPayload('p2', 25)).toEqual({ productId: 'p2', quantity: 25 });
    expect(cardAddToCartPayload('p2', null)).toEqual({ productId: 'p2', quantity: 1 });
  });
});

describe('CompareAddToCartButton — minimum (SSR)', () => {
  it('states the minimum under the button and links it (EN and PL)', () => {
    const en = renderToString(<CompareAddToCartButton productId="p2" minOrderQuantity={25} locale="en-US" />);
    expect(en).toContain('Minimum order: 25 pcs');
    expect(en).toMatch(/<button[^>]*aria-describedby="compare-min-p2"/);
    const pl = renderToString(<CompareAddToCartButton productId="p2" minOrderQuantity={25} locale="pl-PL" />);
    expect(pl).toContain('Minimalne zamówienie: 25 szt.');
  });

  it('renders no statement without a minimum', () => {
    const html = renderToString(<CompareAddToCartButton productId="p2" minOrderQuantity={null} locale="en-US" />);
    expect(html).not.toContain('Minimum order');
    expect(html).not.toContain('aria-describedby');
  });
});
