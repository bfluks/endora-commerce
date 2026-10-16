import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ProductBuyActions } from '../../components/ProductBuyActions';
import type { AddToCartResult } from '../../lib/cartAddState';
import {
  clampQuantity,
  minimumStatement,
  orderFloor,
  quantityOnUnitChange,
} from '../../lib/orderMinimum';

/**
 * Feature 148 / FR-014 (US1 #2, #6; US2 #2) — the product page states the applicable minimum,
 * starts the quantity input at it and does not offer less.
 */
const noop = (): AddToCartResult => ({ status: 'idle' });

const PALLET = { id: 'u-pallet', name: 'Pallet', baseQuantity: 64, isDefault: false, minOrderUnits: 2 };
const CARTON = { id: 'u-carton', name: 'Carton', baseQuantity: 8, isDefault: false, minOrderUnits: null };

describe('orderFloor', () => {
  it('is the pieces minimum when no unit is selected', () => {
    expect(orderFloor({ minOrderQuantity: 10 }, null)).toBe(10);
  });

  it('is 1 when there is no minimum, or a minimum of 1', () => {
    expect(orderFloor({ minOrderQuantity: null }, null)).toBe(1);
    expect(orderFloor({}, null)).toBe(1);
    expect(orderFloor({ minOrderQuantity: 1 }, null)).toBe(1);
  });

  it('is the unit minimum when a packaging unit is selected', () => {
    expect(orderFloor({ minOrderQuantity: null }, PALLET)).toBe(2);
    expect(orderFloor({ minOrderQuantity: 10 }, PALLET)).toBe(2);
  });

  it('is 1 unit when the unit has no minimum and one unit meets the pieces minimum', () => {
    expect(orderFloor({ minOrderQuantity: null }, CARTON)).toBe(1);
    expect(orderFloor({ minOrderQuantity: 8 }, CARTON)).toBe(1);
  });

  it('never offers a unit count whose pieces fall below the pieces minimum (US3 #4: each rule is checked)', () => {
    // 10 pcs minimum, 8-pc carton: 1 carton = 8 pcs is refused by the cart, 2 cartons = 16 pcs is not.
    expect(orderFloor({ minOrderQuantity: 10 }, CARTON)).toBe(2);
    expect(orderFloor({ minOrderQuantity: 200 }, PALLET)).toBe(4);
  });
});

describe('minimumStatement', () => {
  it('states the pieces minimum (EN and PL)', () => {
    expect(minimumStatement({ minOrderQuantity: 10 }, null, 'en-US')).toBe('Minimum order: 10 pcs');
    expect(minimumStatement({ minOrderQuantity: 10 }, null, 'pl-PL')).toBe('Minimalne zamówienie: 10 szt.');
  });

  it('states the unit minimum with its pieces (EN and PL)', () => {
    expect(minimumStatement({ minOrderQuantity: null }, PALLET, 'en-US')).toBe(
      'Minimum order: 2 × Pallet = 128 pcs',
    );
    expect(minimumStatement({ minOrderQuantity: null }, PALLET, 'pl-PL')).toBe(
      'Minimalne zamówienie: 2 × Pallet = 128 szt.',
    );
  });

  it('is null when nothing is required beyond one piece or one unit', () => {
    expect(minimumStatement({ minOrderQuantity: null }, null, 'en-US')).toBeNull();
    expect(minimumStatement({ minOrderQuantity: 1 }, null, 'pl-PL')).toBeNull();
    expect(minimumStatement({ minOrderQuantity: 8 }, CARTON, 'en-US')).toBeNull();
  });
});

describe('clampQuantity', () => {
  it('lifts a value below the floor to the floor and accepts messy input', () => {
    expect(clampQuantity('3', 10)).toBe(10);
    expect(clampQuantity('', 10)).toBe(10);
    expect(clampQuantity('abc', 1)).toBe(1);
    expect(clampQuantity(' 15 ', 10)).toBe(15);
    expect(clampQuantity('12.7', 10)).toBe(12);
  });
});

describe('quantityOnUnitChange', () => {
  it('moves a quantity sitting at the old floor to the new floor', () => {
    expect(quantityOnUnitChange(10, 10, 2)).toBe(2);
    expect(quantityOnUnitChange(1, 1, 2)).toBe(2);
  });

  it('keeps a quantity the buyer chose, lifted to the new floor when below it', () => {
    expect(quantityOnUnitChange(5, 1, 1)).toBe(5);
    expect(quantityOnUnitChange(15, 10, 2)).toBe(15);
    expect(quantityOnUnitChange(3, 2, 10)).toBe(10);
  });
});

describe('ProductBuyActions — minimum (SSR)', () => {
  function render(props: { minOrderQuantity: number | null; locale: string; units?: typeof PALLET[] }): string {
    return renderToString(
      <ProductBuyActions
        productId="p1"
        productSlug="p-slug"
        productName="Product 1"
        showCart
        showQuote={false}
        minOrderQuantity={props.minOrderQuantity}
        locale={props.locale}
        {...(props.units ? { packagingUnits: props.units } : {})}
        addToCartAction={noop}
        addToCartLabel="Add to cart"
      />,
    );
  }

  it('starts the input at the minimum, floors it there and states it (EN)', () => {
    const html = render({ minOrderQuantity: 10, locale: 'en-US' });
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*min="10"/);
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*value="10"/);
    expect(html).toMatch(/<input type="hidden" name="quantity" value="10"/);
    expect(html).toContain('Minimum order: 10 pcs');
    // The statement is linked to the input for assistive technology.
    expect(html).toMatch(/<input[^>]*aria-describedby="buy-min-p1"/);
    expect(html).toMatch(/id="buy-min-p1"/);
  });

  it('states the minimum in Polish', () => {
    expect(render({ minOrderQuantity: 10, locale: 'pl-PL' })).toContain('Minimalne zamówienie: 10 szt.');
  });

  it('uses the unit minimum when the default packaging unit is selected', () => {
    const html = render({ minOrderQuantity: null, locale: 'en-US', units: [{ ...PALLET, isDefault: true }] });
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*min="2"/);
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*value="2"/);
    expect(html).toContain('Minimum order: 2 × Pallet = 128 pcs');
  });

  it('is unchanged for a product without a minimum', () => {
    const html = render({ minOrderQuantity: null, locale: 'en-US' });
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*min="1"/);
    expect(html).toMatch(/<input[^>]*id="buy-qty-p1"[^>]*value="1"/);
    expect(html).not.toContain('Minimum order');
    expect(html).not.toContain('aria-describedby="buy-min-p1"');
  });
});
