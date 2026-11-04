import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/**
 * Round B review — the rendered button: a click on a product with a minimum of 10 must send
 * `quantity: 10`. The storefront suite renders on the server only, so the button is held to
 * passing `cardAddToCartPayload` — tested above — straight to `addProductToCartAction`.
 */
describe('CompareAddToCartButton — wiring', () => {
  it('adds to cart with cardAddToCartPayload of the product and its minimum', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../components/CompareAddToCartButton.tsx'), 'utf8');
    expect(source).toMatch(
      /addProductToCartAction\(\s*cardAddToCartPayload\(props\.productId, props\.minOrderQuantity\),?\s*\)/,
    );
    expect(source.match(/addProductToCartAction\(/g)).toHaveLength(1);
  });
});

/**
 * Round B review — the button and the table it sits in once fell back to different
 * locales (`pl-PL` and `en-US`). The button now takes the table's resolved locale, always.
 */
describe('CompareAddToCartButton — locale', () => {
  it('is given the comparison table\'s resolved locale, with no default of its own', () => {
    const table = readFileSync(resolve(import.meta.dirname, '../../components/ComparisonTable.tsx'), 'utf8');
    const usage = table.slice(table.indexOf('<CompareAddToCartButton'), table.indexOf('/>', table.indexOf('<CompareAddToCartButton')));
    expect(usage).toContain('locale={locale}');
    const button = readFileSync(resolve(import.meta.dirname, '../../components/CompareAddToCartButton.tsx'), 'utf8');
    expect(button).not.toContain("'pl-PL'");
  });
});
