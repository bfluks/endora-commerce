// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { cardAddLabel, cardAddQuantity, cardAddToCartPayload } from '../../lib/orderMinimum';

const addProductToCartAction = vi.fn(async (_input: { productId: string; quantity: number }) => ({ ok: true }));
vi.mock('../../lib/actions/cart', () => ({ addProductToCartAction }));
vi.mock('../../lib/actions/shoppingList', () => ({
  addToDefaultListAction: vi.fn(),
  removeFromDefaultListAction: vi.fn(),
}));
vi.mock('../../lib/shoppingListMembership', () => ({
  loadShoppingListMembership: vi.fn(async () => ({ listId: null, byProduct: new Map() })),
  invalidateShoppingListMembership: vi.fn(),
}));
vi.mock('../../lib/rfqDraft', () => ({ addRfqDraftItem: vi.fn() }));

const { ProductCardActions } = await import('../../components/ProductCardActions');

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
 * Round B review — the rendered card, not only its helpers: clicking "add to cart" on a
 * product with a minimum of 10 calls `addProductToCartAction` with `quantity: 10`. jsdom
 * (no testing library: none is a storefront dependency), the server action mocked.
 */
describe('ProductCardActions — clicking "add to cart" adds the minimum (jsdom)', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    addProductToCartAction.mockClear();
    vi.unstubAllGlobals();
  });

  async function mount(minOrderQuantity: number | null, label: string | null): Promise<HTMLElement> {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { showAddToCart: true, showAddToShoppingList: true, showAddToQuote: true } }),
      })),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host);
      root.render(
        <ProductCardActions
          apiBase="http://api.test"
          productId="p1"
          productSlug="anchor"
          productName="Anchor"
          buyable
          minOrderQuantity={minOrderQuantity}
          addToCartMinimumLabel={label}
        />,
      );
    });
    // The buttons config resolves on a microtask after mount.
    await act(async () => undefined);
    return host;
  }

  async function clickAdd(host: HTMLElement, label: string): Promise<void> {
    const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button, label).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('sends quantity 10 for a product with a minimum of 10', async () => {
    const host = await mount(10, 'Add 10 pcs to cart');
    await clickAdd(host, 'Add 10 pcs to cart');
    expect(addProductToCartAction).toHaveBeenCalledTimes(1);
    expect(addProductToCartAction).toHaveBeenCalledWith({ productId: 'p1', quantity: 10 });
  });

  it('sends quantity 1 for a product without one', async () => {
    const host = await mount(null, null);
    await clickAdd(host, 'Dodaj do koszyka');
    expect(addProductToCartAction).toHaveBeenCalledWith({ productId: 'p1', quantity: 1 });
  });
});
