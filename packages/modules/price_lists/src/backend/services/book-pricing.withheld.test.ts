import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode } from '@endora-commerce/contracts';
import {
  BookPricing,
  engineFromBook,
  lineFromBook,
  listingDetailFromBook,
  listingPriceFromBook,
  type BookLineAnswer,
} from './book-pricing.js';
import type { BookResolution } from './book-resolver.js';
import { PRECEDENCE_PRESETS } from './precedence.js';

/**
 * Issue #491 — display mode `none` withholds every amount on the server.
 *
 * The storefront hid the figures and the API sent them anyway: a visitor on a
 * shop that hides prices until sign-in could read the price, the sale, the
 * list price and every tier — the buyer's own included — from the network tab.
 * The rule lives in the pricing module's mapping onto the published shapes, so
 * every consumer of the listing and engine entry points gets the same answer:
 * no amount, and `displayMode: 'none'` so the storefront still says "price on
 * request".
 */

const tier = (amount: string, bookId: string) => ({
  amount,
  bookId,
  bookName: bookId,
  rowId: `row-${bookId}`,
  startQuantity: 1,
  endQuantity: null,
  cell: null,
  reference: null,
});

/** A buyer price under a catalogue price under a base, and a lower sale charged. */
const resolution: BookResolution = {
  price: {
    amount: '70.0000',
    source: 'sale',
    compareAt: '90.0000',
    bookId: 'sale',
    bookName: 'sale',
    rowId: 'row-sale',
    startQuantity: 1,
  },
  base: tier('120.0000', 'base'),
  catalogue: tier('100.0000', 'catalogue'),
  buyer: tier('90.0000', 'buyer'),
  sale: tier('70.0000', 'sale'),
  explanation: {
    tier: 'sale',
    cell: null,
    bookId: 'sale',
    bookName: 'sale',
    rowId: 'row-sale',
    reference: null,
    precedenceVersion: 1,
    candidates: [],
  },
};

const answer = (displayMode: DisplayMode): BookLineAnswer => ({ resolution, displayMode, currencyCode: 'PLN' });

describe('listing and engine mappings — `none` withholds every amount (#491)', () => {
  it('a listing detail under `none` carries no price, no base, no sale, no list price and no tier', () => {
    const detail = listingDetailFromBook(answer('none'), { maxAmount: '95.0000', variesByVariant: true }, true);
    expect(detail).toEqual({
      price: { source: 'none' },
      basePrice: null,
      salePrice: null,
      displayMode: 'none',
      tiers: { base: null, catalogue: null, buyer: null, sale: null },
    });
  });

  it('a listing price under `none` is the `none` arm, with no range', () => {
    expect(listingPriceFromBook(answer('none'), { maxAmount: '95.0000', variesByVariant: true })).toEqual({ source: 'none' });
  });

  it('the engine answer under `none` names no book, no bracket, no sale, no source and no list price', () => {
    const engine = engineFromBook(answer('none'), 'p1', 'PLN', true);
    expect(engine).toEqual({
      base: { listId: '', listName: '', bracket: null },
      sale: null,
      displayMode: 'none',
      currencyCode: 'PLN',
      source: null,
      compareAt: null,
    });
  });

  it.each(['gross_only', 'net_only', 'both'] as const)('a priced mode (%s) keeps every amount', (mode) => {
    const detail = listingDetailFromBook(answer(mode), undefined, true);
    expect(detail.price).toMatchObject({ source: 'price_list', amount: '70.0000', compareAtAmount: '90.0000' });
    expect(detail.basePrice).toEqual({ amount: '90.0000', currency: 'PLN' });
    expect(detail.salePrice).toEqual({ amount: '70.0000', currency: 'PLN' });
    expect(detail.listPrice).toEqual({ amount: '100.0000', currency: 'PLN' });
    expect(detail.tiers).toEqual({
      base: { amount: '120.0000', currency: 'PLN' },
      catalogue: { amount: '100.0000', currency: 'PLN' },
      buyer: { amount: '90.0000', currency: 'PLN' },
      sale: { amount: '70.0000', currency: 'PLN' },
    });
    const engine = engineFromBook(answer(mode), 'p1', 'PLN', true);
    expect(engine.base.bracket?.amount).toBe('90.0000');
    expect(engine.sale?.bracket.amount).toBe('70.0000');
    expect(engine.listPrice).toEqual({ amount: '100.0000', currency: 'PLN' });
  });

  it('a line keeps its amount under `none`: it is what a charging consumer refuses as quote-only', () => {
    // The cart and the admin order preview tell `QUOTE_ONLY` from `UNPRICED`
    // by the display mode beside a resolved amount; a line answer is never
    // published to a viewer as it is.
    expect(lineFromBook(answer('none'))).toMatchObject({ amount: '70.0000', displayMode: 'none' });
  });
});

/**
 * The price surface stores the amounts price sort and price range read. A
 * product whose own step of the display-mode chain (its override, else its
 * category's) is `none` is withheld from every viewer — that step precedes the
 * viewer's tail — so it has no place in the order: the surface leaves it out,
 * and the catalogue walks it in the unpriced tail.
 */
describe('BookPricing.resolveProfileListing — a product withheld by its own step is left out (#491)', () => {
  function engine(input: { anyWithholds: boolean; modes: Map<string, DisplayMode> }) {
    const reads = { guard: 0, productModes: 0 };
    const rows = [
      { id: 'r-p1', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
      { id: 'r-p2', price_list_id: 'base', variant_id: null, product_id: 'p2', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '50.0000', percent: null },
      { id: 'r-p3', price_list_id: 'base', variant_id: null, product_id: 'p3', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '30.0000', percent: null },
    ];
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        if (sql.includes('from "price_lists" l')) {
          return [{ id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true }];
        }
        if (sql.includes('price_list_matrix_entries')) return rows;
        return [];
      },
    } as unknown as EntityManager;
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({ listVariantsByProductIds: async () => [] }),
      productDisplayModes: async ({ productIds }) => {
        reads.productModes += 1;
        return new Map([...input.modes].filter(([id]) => productIds.includes(id)));
      },
      anyProductStepWithholds: async () => {
        reads.guard += 1;
        return input.anyWithholds;
      },
      viewerDisplayMode: async () => 'gross_only',
    });
    return { books, reads };
  }

  const products = [
    { id: 'p1', attributeValues: {} },
    { id: 'p2', attributeValues: {} },
    { id: 'p3', attributeValues: {} },
  ];
  const profileOf = (books: BookPricing) =>
    books.profileFromVector({ channelId: 'ch', currencyCode: 'PLN', precedenceVersion: 1, vector: [] });

  it('leaves out the product whose own step is `none`, and keeps one whose own step prices it', async () => {
    const { books } = engine({
      anyWithholds: true,
      modes: new Map<string, DisplayMode>([
        ['p1', 'none'],
        ['p3', 'net_only'],
      ]),
    });
    const listed = await books.resolveProfileListing(products, await profileOf(books));
    expect(listed.get('p1')?.resolution ?? null).toBeNull();
    expect(listed.get('p2')?.resolution?.price?.amount).toBe('50.0000');
    expect(listed.get('p3')?.resolution?.price?.amount).toBe('30.0000');
  });

  it('reads no display mode when no product or category override withholds anything', async () => {
    const { books, reads } = engine({ anyWithholds: false, modes: new Map([['p1', 'none']]) });
    const listed = await books.resolveProfileListing(products, await profileOf(books));
    expect(reads).toEqual({ guard: 1, productModes: 0 });
    expect(listed.get('p1')?.resolution?.price?.amount).toBe('100.0000');
  });
});
