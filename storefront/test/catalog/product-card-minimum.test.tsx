import { describe, expect, it } from 'vitest';
import { cardAddLabel, cardAddQuantity, cardAddToCartPayload } from '../../lib/orderMinimum';

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
