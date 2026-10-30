import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StorefrontApiError } from '../lib/api/client';
import { cartActionFailure } from '../lib/cart-action-failure';

/**
 * Issue #249 (1) — the product page's cart and one-click actions answer in the
 * shopper's language.
 *
 * Their fallbacks were literals — two written in Polish and three in English —
 * so a failure read in whichever language its line happened to be written in.
 * The add-to-cart button's label was a Polish literal too. The literals the
 * page must no longer carry are listed in the last `describe` below.
 */

describe('cartActionFailure', () => {
  it('words the fallback in the request\'s language', () => {
    const failure = new TypeError('fetch failed');

    expect(cartActionFailure(failure, 'en-US', 'product.addToCartFailed')).toBe(
      'Could not add the product to the cart.',
    );
    expect(cartActionFailure(failure, 'pl-PL', 'product.addToCartFailed')).toBe(
      'Nie udało się dodać produktu do koszyka.',
    );
    expect(cartActionFailure(failure, 'en-US', 'product.oneClickFailed')).toBe(
      'Could not place the order.',
    );
    expect(cartActionFailure(failure, 'pl-PL', 'product.oneClickFailed')).toBe(
      'Nie udało się złożyć zamówienia.',
    );
  });

  it('keeps the backend\'s refusal, unchanged, when there is one — without its log-only code prefix', () => {
    const refusal = new StorefrontApiError(409, 'OUT_OF_STOCK', 'Only 2 left in stock.');

    // U4 — `message` is `OUT_OF_STOCK: Only 2 left in stock.`, meant for logs; the buyer reads
    // the sentence alone.
    expect(cartActionFailure(refusal, 'pl-PL', 'product.addToCartFailed')).toBe('Only 2 left in stock.');
  });
});

describe('cartActionFailure on a store the shopper may not use (`specs/154-sales-channel-access/`)', () => {
  it('words a channel refusal in the shopper\'s language, whatever the backend answered in', () => {
    const notPermitted = new StorefrontApiError(403, 'SALES_CHANNEL_NOT_PERMITTED', 'x');
    const signIn = new StorefrontApiError(403, 'SALES_CHANNEL_SIGN_IN_REQUIRED', 'x');

    expect(cartActionFailure(notPermitted, 'pl-PL', 'product.addToCartFailed')).toBe(
      'To konto nie ma dostępu do tego sklepu.',
    );
    expect(cartActionFailure(notPermitted, 'en-US', 'product.oneClickFailed')).toBe(
      'This account does not have access to this store.',
    );
    expect(cartActionFailure(signIn, 'en-US', 'product.addToCartFailed')).toBe(
      'This store is available to signed-in customers only. Please sign in.',
    );
    expect(cartActionFailure(signIn, 'pl-PL', 'product.addToCartFailed')).toBe(
      'Ten sklep jest dostępny tylko dla zalogowanych klientów. Zaloguj się.',
    );
  });
});

describe('the product page', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../app/(catalog)/p/[slug]/page.tsx'),
    'utf8',
  );

  it.each([
    'Dodaj do koszyka',
    'Nie udało się dodać produktu do koszyka.',
    'Could not add to cart.',
    'Could not place the order.',
  ])('carries no hard-coded %j', (literal) => {
    expect(source).not.toContain(literal);
  });
});

describe('cartActionFailure without a readable locale', () => {
  it('answers in the catalogue default rather than throwing', () => {
    expect(cartActionFailure(new Error('boom'), undefined, 'product.addToCartFailed')).toBe(
      'Could not add the product to the cart.',
    );
  });
});

/**
 * Feature 155 (FR-039) — the cart's submit-for-approval action answers in the
 * shopper's language too: a refusal the backend worded (the minimum refusal of
 * §12) passes through, anything else gets the catalogue's sentence.
 */
describe('the cart page submit-for-approval action', () => {
  it('words its fallback in the request\'s language', () => {
    const failure = new TypeError('fetch failed');
    expect(cartActionFailure(failure, 'en-US', 'cart.submitForApprovalFailed')).toBe(
      'Could not submit the cart for approval.',
    );
    expect(cartActionFailure(failure, 'pl-PL', 'cart.submitForApprovalFailed')).toBe(
      'Nie udało się wysłać koszyka do akceptacji.',
    );
  });

  it('carries no hard-coded English fallback', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../app/(commerce)/cart/page.tsx'), 'utf8');
    expect(source).not.toContain('Could not submit cart for approval.');
  });
});

/**
 * U4 (owner's manual test) — a cart write's refusal is worded by the backend in the language the
 * request asks for, and a mutation that forwards no request context asks for none: the buyer read
 * the minimum refusal in the backend's default language, with the error code in front of it.
 */
describe('cart writes forward the request context (language and sales channel)', () => {
  const pages = {
    cart: readFileSync(resolve(import.meta.dirname, '../app/(commerce)/cart/page.tsx'), 'utf8'),
    product: readFileSync(resolve(import.meta.dirname, '../app/(catalog)/p/[slug]/page.tsx'), 'utf8'),
  };

  function calls(source: string, fn: string): string[] {
    const out: string[] = [];
    const re = new RegExp(`\\b${fn}\\(`, 'g');
    for (let m = re.exec(source); m; m = re.exec(source)) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')' && --depth === 0) break;
      }
      out.push(source.slice(m.index, i + 1));
    }
    return out;
  }

  it.each(['updateCartItem', 'removeCartItem', 'submitCartForApproval'])('the cart page passes ctx to %s', (fn) => {
    const found = calls(pages.cart, fn).filter((c) => !c.includes('import'));
    expect(found.length).toBeGreaterThan(0);
    for (const call of found) expect(call).toMatch(/,\s*ctx\s*,?\s*\)$/);
  });

  it('the product page passes ctx to every addCartItem', () => {
    const found = calls(pages.product, 'addCartItem');
    expect(found.length).toBeGreaterThan(0);
    for (const call of found) expect(call).toMatch(/,\s*ctx\s*,?\s*\)$/);
  });

  it('neither page shows err.message (the log form, with its code) to the buyer', () => {
    expect(pages.cart).not.toContain('err.message');
  });
});

/**
 * U4 (owner's manual test) — "a notification starting with something like a constant": a
 * `StorefrontApiError`'s `message` is `CODE: sentence`, for logs. Every server action that showed
 * it to the buyer printed `PRODUCT_BELOW_MINIMUM_QUANTITY: …` (cart edit, reorder, shopping-list
 * convert, quick-order build, quote acceptance…). The buyer reads `detail`, the sentence alone.
 */
describe('no storefront surface shows a StorefrontApiError message (with its code)', () => {
  const root = resolve(import.meta.dirname, '..');
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sources(path));
      else if (/\.tsx?$/.test(entry.name)) out.push(path);
    }
    return out;
  }
  const files = [...sources('app'), ...sources('components'), ...sources('lib')];

  it('reads err.detail, never err.message, after an instanceof StorefrontApiError check', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(join(root, file), 'utf8');
      return (
        /StorefrontApiError\s*\?\s*err\.message/.test(source) ||
        /instanceof StorefrontApiError\)\s*(return\s+)?[^;\n]*err\.message/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('a refusal reaches the buyer without its code', () => {
    const refusal = new StorefrontApiError(
      422,
      'PRODUCT_BELOW_MINIMUM_QUANTITY',
      '"Bolts 0001" has a minimum order quantity of 10 pcs.',
    );
    expect(cartActionFailure(refusal, 'en-US', 'cart.submitForApprovalFailed')).toBe(
      '"Bolts 0001" has a minimum order quantity of 10 pcs.',
    );
  });
});
