import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cardAddLabel, cardAddQuantity, cardAddToCartLabel, cardAddToCartPayload } from '../../lib/orderMinimum';

/**
 * Feature 155 / FR-016 (US4 #12) — the product card's "add to cart" adds the minimum at once.
 */
describe('cardAddQuantity', () => {
  it('is the minimum when the product has one', () => {
    expect(cardAddQuantity(10)).toBe(10);
  });

  it('is 1 when the product has none (unchanged behaviour)', () => {
    expect(cardAddQuantity(null)).toBe(1);
    expect(cardAddQuantity(undefined)).toBe(1);
    expect(cardAddQuantity(1)).toBe(1);
  });
});

describe('cardAddToCartPayload', () => {
  it('is what the card passes to addProductToCartAction', () => {
    expect(cardAddToCartPayload('p1', 10)).toEqual({ productId: 'p1', quantity: 10 });
    expect(cardAddToCartPayload('p1', null)).toEqual({ productId: 'p1', quantity: 1 });
  });
});

describe('cardAddLabel', () => {
  it('names the quantity the icon button adds (EN and PL)', () => {
    expect(cardAddLabel(10, 'en-US')).toBe('Add 10 pcs to cart');
    expect(cardAddLabel(10, 'pl-PL')).toBe('Dodaj 10 szt. do koszyka');
  });

  it('is null without a minimum, so the existing label stays', () => {
    expect(cardAddLabel(null, 'en-US')).toBeNull();
    expect(cardAddLabel(1, 'pl-PL')).toBeNull();
  });
});

/**
 * U4 translation sweep — the card's icon button was labelled in the storefront's language only
 * when the product had a minimum; without one it fell back to a Polish literal.
 */
describe('cardAddToCartLabel', () => {
  it('is the minimum label when the product has one', () => {
    expect(cardAddToCartLabel(10, 'en-US')).toBe('Add 10 pcs to cart');
  });

  it("is the catalogue's add-to-cart label otherwise, in the request's language", () => {
    expect(cardAddToCartLabel(null, 'en-US')).toBe('Add to cart');
    expect(cardAddToCartLabel(1, 'pl-PL')).toBe('Dodaj do koszyka');
  });

  it('is what the card passes to its actions', () => {
    const card = readFileSync(resolve(import.meta.dirname, '../../components/ProductCard.tsx'), 'utf8');
    expect(card).toContain('addToCartMinimumLabel={cardAddToCartLabel(product.minOrderQuantity, locale)}');
  });
});

/**
 * Round B review — the rendered card, not only its helpers: clicking "add to cart" on a
 * product with a minimum of 10 must send `quantity: 10`. The storefront suite renders on the
 * server only, so the card is held to passing `cardAddToCartPayload` — tested above — straight
 * to `addProductToCartAction`.
 */
describe('ProductCardActions — wiring', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../../components/ProductCardActions.tsx'), 'utf8');

  it('adds to cart with cardAddToCartPayload of the product and its minimum', () => {
    expect(source).toMatch(
      /addProductToCartAction\(\s*cardAddToCartPayload\(props\.productId, props\.minOrderQuantity\),?\s*\)/,
    );
    expect(source.match(/addProductToCartAction\(/g)).toHaveLength(1);
  });
});
