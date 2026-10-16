import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CartLine, type CartLineViewModel } from '../../components/CartLine';
import {
  belowMinimumText,
  cartBlocksCheckout,
  cartLineDisplayName,
  cartLineFloor,
} from '../../lib/cartMinimum';

/**
 * Feature 148, T119 — the cart line below a minimum (US1 #4, #5; FR-013) and the line whose
 * product record is gone (FR-037). SSR-only: the markup is the assertion.
 */

const noop = async (): Promise<void> => undefined;

const STRINGS = {
  qtyLabel: 'Quantity',
  unitPriceLabel: 'Unit price',
  lineTotalLabel: 'Line total',
  removeLabel: 'Remove',
  saveToListLabel: 'Save to list',
  netSuffix: 'net',
  grossSuffix: 'gross',
  unavailable: {
    out_of_stock: 'Out of stock.',
    not_purchasable: 'No longer available.',
    no_price_in_customer_list: 'Pricing unavailable for your account.',
  },
};

function line(overrides: Partial<CartLineViewModel> = {}): CartLineViewModel {
  return {
    id: 'item-1',
    productId: 'prod-1',
    variantId: null,
    quantity: 3,
    unitPrice: { amount: 2, currency: 'PLN' },
    lineTotal: { amount: 6, currency: 'PLN' },
    productName: 'Anchor bolt M8',
    ...overrides,
  };
}

function render(model: CartLineViewModel, locale = 'en-US'): string {
  return renderToString(
    <CartLine
      line={model}
      updateAction={noop}
      removeAction={noop}
      saveToListAction={noop}
      locale={locale}
      strings={STRINGS}
    />,
  );
}

describe('belowMinimumText', () => {
  it('states the pieces minimum (EN and PL)', () => {
    const below = { belowMinimum: { kind: 'pieces' as const, minimum: 10 } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (10 pcs)');
    expect(belowMinimumText(below, 'pl-PL')).toBe('Poniżej minimum (10 szt.)');
  });

  it('states the packaging-unit minimum with the unit name (EN and PL)', () => {
    const below = { belowMinimum: { kind: 'packaging_unit' as const, minimum: 2, packagingUnitName: 'Pallet' } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (2 × Pallet)');
    expect(belowMinimumText(below, 'pl-PL')).toBe('Poniżej minimum (2 × Pallet)');
  });

  it('never reads a brace in the unit name as a placeholder', () => {
    const below = { belowMinimum: { kind: 'packaging_unit' as const, minimum: 2, packagingUnitName: 'Box {units}' } };
    expect(belowMinimumText(below, 'en-US')).toBe('Below the minimum (2 × Box {units})');
  });

  it('is null for a line that is not below a minimum', () => {
    expect(belowMinimumText({ belowMinimum: null }, 'en-US')).toBeNull();
    expect(belowMinimumText({}, 'en-US')).toBeNull();
  });
});

describe('cartLineFloor', () => {
  it('is the pieces minimum for a line below it', () => {
    expect(cartLineFloor({ quantity: 3, minOrderQuantity: 10, belowMinimum: { kind: 'pieces', minimum: 10 } })).toBe(10);
  });

  it('is the pieces minimum for a line at or above it', () => {
    expect(cartLineFloor({ quantity: 12, minOrderQuantity: 10, belowMinimum: null })).toBe(10);
  });

  it('never rises above the quantity of a line the server does not flag (a quote-exempt line, FR-028)', () => {
    expect(cartLineFloor({ quantity: 5, minOrderQuantity: 10, belowMinimum: null })).toBe(5);
  });

  it('is 1 without a minimum', () => {
    expect(cartLineFloor({ quantity: 3 })).toBe(1);
    expect(cartLineFloor({ quantity: 3, minOrderQuantity: null, belowMinimum: null })).toBe(1);
  });
});

describe('CartLine below the minimum', () => {
  const below = line({ minOrderQuantity: 10, belowMinimum: { kind: 'pieces', minimum: 10 } });

  it('says so beside the line and floors the input at the minimum (US1 #4)', () => {
    const html = render(below);
    expect(html).toContain('Below the minimum (10 pcs)');
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="10"/);
  });

  it('offers a one-step fix to the minimum, exempt from native validation', () => {
    const html = render(below);
    expect(html).toMatch(/<button[^>]*name="quantity"[^>]*value="10"[^>]*formNoValidate=""[^>]*>Set to 10 pcs</);
  });

  it('states the pallet variant (US1 #5)', () => {
    const html = render(
      line({ quantity: 64, belowMinimum: { kind: 'packaging_unit', minimum: 2, packagingUnitName: 'Pallet' } }),
    );
    expect(html).toContain('Below the minimum (2 × Pallet)');
  });

  it('renders in Polish', () => {
    expect(render(below, 'pl-PL')).toContain('Poniżej minimum (10 szt.)');
  });

  it('keeps an unflagged line free of the warning, and a quote-exempt line editable at its quantity', () => {
    const html = render(line({ quantity: 5, minOrderQuantity: 10, belowMinimum: null }));
    expect(html).not.toContain('Below the minimum');
    expect(html).toMatch(/<input[^>]*type="number"[^>]*min="5"/);
  });
});

describe('CartLine whose product is gone (FR-037)', () => {
  const gone = line({
    productName: cartLineDisplayName({ productId: 'prod-1' }, 'en-US'),
    unavailable: true,
    unavailableReason: 'not_purchasable',
    belowMinimum: null,
  });

  it('renders "no longer available" with remove only', () => {
    const html = render(gone);
    expect(html).toContain('No longer available.');
    expect(html).toContain('aria-label="Remove"');
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('Save to list');
  });

  it('never shows a raw id as the line name', () => {
    expect(cartLineDisplayName({ productId: 'prod-1' }, 'en-US')).not.toContain('prod-1');
    expect(render(gone)).not.toContain('>prod-1<');
  });
});

describe('cartBlocksCheckout', () => {
  it('is true for a line whose product is gone', () => {
    expect(cartBlocksCheckout({ items: [{ unavailable: true, unavailableReason: 'not_purchasable' }] })).toBe(true);
  });

  it('is true for a line below a minimum', () => {
    expect(cartBlocksCheckout({ items: [{ belowMinimum: { kind: 'pieces', minimum: 10 } }] })).toBe(true);
  });

  it('is false for a cart of ordinary lines', () => {
    expect(cartBlocksCheckout({ items: [{ unavailable: false, belowMinimum: null }, {}] })).toBe(false);
  });
});
