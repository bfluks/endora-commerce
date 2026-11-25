import { describe, expect, it } from 'vitest';
import { CataloguePricesChangedEventSchema } from '@endora-commerce/contracts';
import { cataloguePricesChangeOf } from './catalogue-prices-changed.js';

const B = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

/** Spec 193 (R-6, T014) — the names-only form of a bump, as the event carries it. */
describe('cataloguePricesChangeOf', () => {
  const valid = (change: ReturnType<typeof cataloguePricesChangeOf>) =>
    CataloguePricesChangedEventSchema.parse({ eventId: 'e', occurredAt: new Date().toISOString(), change }).change;

  it('a change that moves nothing is not announced', () => {
    expect(cataloguePricesChangeOf({ kind: 'none' })).toBeNull();
  });

  it('a book change names the book, its currencies and the products of product rows', () => {
    const change = cataloguePricesChangeOf({
      kind: 'books',
      books: [
        {
          facts: [
            { bookId: B, currencyCode: 'pln', audienceKind: 'everyone', isSystem: false, live: true },
            { bookId: B, currencyCode: 'PLN', audienceKind: 'everyone', isSystem: false, live: false },
          ],
          selections: [
            { productId: P, categoryId: null, attributeKey: null },
            { productId: P, categoryId: null, attributeKey: null },
          ],
        },
      ],
    });
    expect(valid(change)).toEqual({ kind: 'books', books: [{ bookId: B, currencyCodes: ['PLN'], isSystem: false, productIds: [P] }] });
  });

  it('stored rows, or a selection-wide row, name no products', () => {
    const facts = [{ bookId: B, currencyCode: 'EUR', audienceKind: 'everyone' as const, isSystem: true, live: true }];
    expect(cataloguePricesChangeOf({ kind: 'books', books: [{ facts, selections: 'stored' }] })).toEqual({
      kind: 'books',
      books: [{ bookId: B, currencyCodes: ['EUR'], isSystem: true, productIds: null }],
    });
    expect(
      cataloguePricesChangeOf({ kind: 'books', books: [{ facts, selections: [{ productId: null, categoryId: C, attributeKey: null }] }] }),
    ).toMatchObject({ books: [{ productIds: null }] });
  });

  it('what it cannot name precisely is widened to everything', () => {
    expect(cataloguePricesChangeOf({ kind: 'channels', channelCodes: ['web'] })).toEqual({ kind: 'all' });
    expect(cataloguePricesChangeOf({ kind: 'channels' })).toEqual({ kind: 'all' });
    expect(cataloguePricesChangeOf({ kind: 'books', books: [{ facts: [], selections: 'stored' }] })).toEqual({ kind: 'all' });
  });

  it('passes products, categories, attributes and all through, valid against the schema', () => {
    expect(valid(cataloguePricesChangeOf({ kind: 'all' }))).toEqual({ kind: 'all' });
    expect(valid(cataloguePricesChangeOf({ kind: 'channels', channelIds: [C, C] }))).toEqual({ kind: 'channels', channelIds: [C] });
    expect(valid(cataloguePricesChangeOf({ kind: 'products', productIds: [P], currencyCodes: ['pln'] }))).toEqual({
      kind: 'products',
      productIds: [P],
      currencyCodes: ['PLN'],
    });
    expect(valid(cataloguePricesChangeOf({ kind: 'categories', categoryIds: [C] }))).toEqual({ kind: 'categories', categoryIds: [C] });
    expect(valid(cataloguePricesChangeOf({ kind: 'attributes', attributeKeys: ['color'] }))).toEqual({
      kind: 'attributes',
      attributeKeys: ['color'],
    });
  });
});
