import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { BelowMinimumSummary } from '../../components/checkout/BelowMinimumSummary';
import { canPlaceOrder, checkoutBelowMinimumRows } from '../../lib/cartMinimum';
import { blockTitle, placeOrderBlock } from '../../lib/checkout/place-order-gate';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Feature 155, T120 — the checkout preview's `belowMinimumLines` (contract §8): placement will
 * refuse them, so the page says which lines and why before the buyer tries (FR-013, FR-037).
 */

const ITEM_A = '00000000-0000-4000-8000-0000000000a1';
const ITEM_B = '00000000-0000-4000-8000-0000000000b1';
const ITEM_GONE = '00000000-0000-4000-8000-0000000000c1';
const PRODUCT = '00000000-0000-4000-8000-0000000000f1';

const CART_ITEMS = [
  { id: ITEM_A, productId: PRODUCT, productName: 'Anchor bolt M8', displayName: 'Anchor bolt M8' },
  { id: ITEM_B, productId: PRODUCT, productName: 'Anchor bolt M8', displayName: 'Anchor bolt M8 (Pallet)' },
  { id: ITEM_GONE, productId: PRODUCT, productName: null, displayName: null, productSku: 'GONE-1' },
];

describe('canPlaceOrder', () => {
  it('is true with no belowMinimumLines, and when the preview could not be read (placement binds)', () => {
    expect(canPlaceOrder({ belowMinimumLines: [] })).toBe(true);
    expect(canPlaceOrder({})).toBe(true);
    expect(canPlaceOrder(null)).toBe(true);
  });

  it('is false with any belowMinimumLines', () => {
    expect(
      canPlaceOrder({ belowMinimumLines: [{ cartItemId: ITEM_A, productId: PRODUCT, kind: 'pieces', minimum: 10 }] }),
    ).toBe(false);
  });

  it('is false for a product_unavailable line', () => {
    expect(
      canPlaceOrder({ belowMinimumLines: [{ cartItemId: ITEM_GONE, productId: PRODUCT, kind: 'product_unavailable' }] }),
    ).toBe(false);
  });
});

describe('checkoutBelowMinimumRows', () => {
  it('groups a line that breaks two minima under one row (contract §8)', () => {
    const rows = checkoutBelowMinimumRows(
      [
        { cartItemId: ITEM_B, productId: PRODUCT, productName: 'Anchor bolt M8', kind: 'pieces', minimum: 10 },
        {
          cartItemId: ITEM_B,
          productId: PRODUCT,
          productName: 'Anchor bolt M8',
          kind: 'packaging_unit',
          minimum: 2,
          packagingUnitName: 'Pallet',
        },
      ],
      CART_ITEMS,
      'en-US',
    );
    expect(rows).toEqual([
      {
        cartItemId: ITEM_B,
        name: 'Anchor bolt M8 (Pallet)',
        reasons: ['Below the minimum (10 pcs)', 'Below the minimum (2 × Pallet)'],
      },
    ]);
  });

  it("names a product_unavailable line by the cart's own line name, as no longer available", () => {
    const rows = checkoutBelowMinimumRows(
      [{ cartItemId: ITEM_GONE, productId: PRODUCT, kind: 'product_unavailable' }],
      CART_ITEMS,
      'en-US',
    );
    expect(rows).toEqual([{ cartItemId: ITEM_GONE, name: 'GONE-1', reasons: ['No longer available'] }]);
  });
});

describe('BelowMinimumSummary', () => {
  const lines = [
    { cartItemId: ITEM_A, productId: PRODUCT, productName: 'Anchor bolt M8', kind: 'pieces' as const, minimum: 10 },
    { cartItemId: ITEM_GONE, productId: PRODUCT, kind: 'product_unavailable' as const },
  ];

  it('lists every line placement will refuse, and links back to the cart (EN)', () => {
    const html = renderToString(
      <BelowMinimumSummary id="below-minimum" rows={checkoutBelowMinimumRows(lines, CART_ITEMS, 'en-US')} locale="en-US" />,
    );
    expect(html).toContain('id="below-minimum"');
    expect(html).toContain('Anchor bolt M8');
    expect(html).toContain('Below the minimum (10 pcs)');
    expect(html).toContain('GONE-1');
    expect(html).toContain('No longer available');
    expect(html).toContain('href="/cart"');
    expect(html).toContain(tForLocale('en-US')('checkout.belowMinimum.heading'));
  });

  it('renders in Polish', () => {
    const html = renderToString(
      <BelowMinimumSummary id="below-minimum" rows={checkoutBelowMinimumRows(lines, CART_ITEMS, 'pl-PL')} locale="pl-PL" />,
    );
    expect(html).toContain('Poniżej minimum (10 szt.)');
    expect(html).toContain(tForLocale('pl-PL')('checkout.belowMinimum.heading'));
  });

  it('renders nothing without rows', () => {
    expect(renderToString(<BelowMinimumSummary id="below-minimum" rows={[]} locale="en-US" />)).toBe('');
  });
});

describe('the place-order gate', () => {
  it('blocks on lines below a minimum, after moderation and before the delivery gap', () => {
    const base = { canTransact: true, deliveryMethodCount: 1, paymentMethodCount: 1 };
    expect(placeOrderBlock({ ...base, belowMinimum: true })).toBe('below-minimum');
    expect(placeOrderBlock({ ...base, canTransact: false, belowMinimum: true })).toBe('moderation');
    expect(placeOrderBlock({ ...base, deliveryMethodCount: 0, belowMinimum: true })).toBe('below-minimum');
    expect(placeOrderBlock(base)).toBeNull();
  });

  it('carries its own sentence', () => {
    const t = tForLocale('en-US');
    expect(blockTitle('below-minimum', t, null)).toBe(t('checkout.belowMinimum.blocked'));
  });
});
