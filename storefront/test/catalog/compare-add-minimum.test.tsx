// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cardAddToCartPayload, cardAddQuantity } from '../../lib/orderMinimum';

const addProductToCartAction = vi.fn(async (_input: { productId: string; quantity: number }) => ({ ok: true }));
vi.mock('../../lib/actions/cart', () => ({ addProductToCartAction }));

const { CompareAddToCartButton } = await import('../../components/CompareAddToCartButton');

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
 * Round B review — the rendered button: a click on a product with a minimum of 10 calls
 * `addProductToCartAction` with `quantity: 10`. jsdom, the server action mocked.
 */
describe('CompareAddToCartButton — clicking adds the minimum (jsdom)', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = '';
    addProductToCartAction.mockClear();
  });

  async function clickFor(minOrderQuantity: number | null): Promise<void> {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host);
      root.render(<CompareAddToCartButton productId="p2" minOrderQuantity={minOrderQuantity} locale="en-US" />);
    });
    const button = host.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('sends quantity 10 for a product with a minimum of 10', async () => {
    await clickFor(10);
    expect(addProductToCartAction).toHaveBeenCalledWith({ productId: 'p2', quantity: 10 });
  });

  it('sends quantity 1 for a product without one', async () => {
    await clickFor(null);
    expect(addProductToCartAction).toHaveBeenCalledWith({ productId: 'p2', quantity: 1 });
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
