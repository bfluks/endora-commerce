import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { BookPricing } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` research R-4, T009) — the catalogue
 * reference price: the engine's own resolver over a fixed profile `[base book,
 * designated book]`, quantity 1, no buyer. The designated book stands where it has a
 * row; the base book where it is silent (OQ-1 b). Sale books, buyer books and other
 * everyone books are never in the profile. Uncached, and no display mode is read.
 */
describe('BookPricing.catalogueReference — the catalogue price of a currency', () => {
  type Row = {
    id: string;
    price_list_id: string;
    variant_id: string | null;
    product_id: string | null;
    category_id: string | null;
    attribute_key: string | null;
    attribute_value: string | null;
    min_quantity: number;
    max_quantity: number | null;
    price_type: 'fixed' | 'percent' | 'amount';
    amount: string | null;
    percent: string | null;
  };
  const row = (over: Partial<Row> & Pick<Row, 'id' | 'price_list_id'>): Row => ({
    variant_id: null,
    product_id: null,
    category_id: null,
    attribute_key: null,
    attribute_value: null,
    min_quantity: 1,
    max_quantity: null,
    price_type: 'fixed',
    amount: null,
    percent: null,
    ...over,
  });

  const BOOKS = [
    { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true, currency_code: 'PLN' },
    { id: 'cat', name: 'Catalogue', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: false, currency_code: 'PLN' },
    { id: 'other', name: 'Other everyone', type: 'regular', audience_kind: 'everyone', priority: 9, is_system: false, currency_code: 'PLN' },
    { id: 'sale', name: 'Sale', type: 'sale', audience_kind: 'everyone', priority: 0, is_system: false, currency_code: 'PLN' },
    { id: 'org', name: 'Org', type: 'regular', audience_kind: 'organizations', priority: 0, is_system: false, currency_code: 'PLN' },
  ];

  function engine(rows: Row[]) {
    const reads = { productModes: 0, viewerModes: 0, channelReads: 0, bookQueries: [] as unknown[][] };
    const em = {
      findOne: async () => {
        reads.channelReads += 1;
        return { currencies: ['PLN'] };
      },
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        if (sql.includes('from "price_lists"')) {
          reads.bookQueries.push(params);
          // A careless statement would hand back every book of the currency.
          return BOOKS;
        }
        if (sql.includes('price_list_matrix_entries')) return rows;
        return [];
      },
    } as unknown as EntityManager;
    const variants = [
      { id: 'v1', parentProductId: 'p5', sku: 'p5-a', variantAttributeValues: {} },
      { id: 'v2', parentProductId: 'p5', sku: 'p5-b', variantAttributeValues: {} },
    ];
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({
        listVariantsByProductIds: async (ids: readonly string[]) => variants.filter((v) => ids.includes(v.parentProductId)) as never,
      }),
      productDisplayModes: async () => {
        reads.productModes += 1;
        return new Map();
      },
      viewerDisplayMode: async () => {
        reads.viewerModes += 1;
        return 'gross_only';
      },
    });
    return { books, reads };
  }

  const products = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, attributeValues: {} }));
  const designation = { priceListId: 'cat', salesChannelId: 'ch' };

  const BASE_ROWS = [
    row({ id: 'b1', price_list_id: 'base', product_id: 'p1', amount: '100.0000' }),
    row({ id: 'b2', price_list_id: 'base', product_id: 'p2', amount: '50.0000' }),
    row({ id: 'b4', price_list_id: 'base', product_id: 'p4', amount: '0.0000' }),
    row({ id: 'b5', price_list_id: 'base', product_id: 'p5', amount: '80.0000' }),
    row({ id: 'b5v1', price_list_id: 'base', product_id: 'p5', variant_id: 'v1', amount: '85.0000' }),
    row({ id: 'b5v2', price_list_id: 'base', product_id: 'p5', variant_id: 'v2', price_type: 'amount', amount: '10.0000' }),
  ];

  it('the designated row wins; where the designated book is silent the base stands (OQ-1 b)', async () => {
    const { books } = engine([...BASE_ROWS, row({ id: 'c1', price_list_id: 'cat', product_id: 'p1', amount: '90.0000' })]);
    const out = await books.catalogueReference({ currencyCode: 'PLN', designation, products });
    expect(out.get('p1')).toEqual([{ variantId: null, amount: '90.0000' }]);
    expect(out.get('p2')).toEqual([{ variantId: null, amount: '50.0000' }]);
  });

  it('without a designation the base book alone prices', async () => {
    const { books } = engine([...BASE_ROWS, row({ id: 'c1', price_list_id: 'cat', product_id: 'p1', amount: '90.0000' })]);
    const out = await books.catalogueReference({ currencyCode: 'PLN', designation: null, products });
    expect(out.get('p1')).toEqual([{ variantId: null, amount: '100.0000' }]);
  });

  it('a product with variants answers one line per variant — fixed, and an adjustment of the base', async () => {
    const { books } = engine([...BASE_ROWS, row({ id: 'c5', price_list_id: 'cat', product_id: 'p5', variant_id: 'v1', amount: '70.0000' })]);
    const out = await books.catalogueReference({ currencyCode: 'PLN', designation, products });
    expect(out.get('p5')).toEqual([
      { variantId: 'v1', amount: '70.0000' },
      { variantId: 'v2', amount: '90.0000' },
    ]);
  });

  it('zero is a price; no row is unpriced', async () => {
    const { books } = engine(BASE_ROWS);
    const out = await books.catalogueReference({ currencyCode: 'PLN', designation, products });
    expect(out.get('p4')).toEqual([{ variantId: null, amount: '0.0000' }]);
    expect(out.get('p3')).toEqual([{ variantId: null, amount: null }]);
  });

  it('sale, buyer and other everyone books never price, whatever their rows', async () => {
    const { books } = engine([
      ...BASE_ROWS,
      row({ id: 's1', price_list_id: 'sale', product_id: 'p1', amount: '10.0000' }),
      row({ id: 'o1', price_list_id: 'org', product_id: 'p1', amount: '11.0000' }),
      row({ id: 'e1', price_list_id: 'other', product_id: 'p2', amount: '12.0000' }),
    ]);
    const out = await books.catalogueReference({ currencyCode: 'PLN', designation, products });
    expect(out.get('p1')).toEqual([{ variantId: null, amount: '100.0000' }]);
    expect(out.get('p2')).toEqual([{ variantId: null, amount: '50.0000' }]);
  });

  it('a designated book that is no longer regular is left out: the base stands', async () => {
    const { books } = engine([...BASE_ROWS, row({ id: 's1', price_list_id: 'sale', product_id: 'p1', amount: '10.0000' })]);
    const out = await books.catalogueReference({
      currencyCode: 'PLN',
      designation: { priceListId: 'sale', salesChannelId: 'ch' },
      products,
    });
    expect(out.get('p1')).toEqual([{ variantId: null, amount: '100.0000' }]);
  });

  it('reads no display mode and no channel, and asks for the base and the designated book only', async () => {
    const { books, reads } = engine(BASE_ROWS);
    await books.catalogueReference({ currencyCode: 'pln', designation, products });
    expect(reads.productModes).toBe(0);
    expect(reads.viewerModes).toBe(0);
    expect(reads.channelReads).toBe(0);
    expect(reads.bookQueries).toEqual([['PLN', 'cat']]);
  });

  it('answers nothing for no product', async () => {
    const { books } = engine(BASE_ROWS);
    expect((await books.catalogueReference({ currencyCode: 'PLN', designation, products: [] })).size).toBe(0);
  });
});
