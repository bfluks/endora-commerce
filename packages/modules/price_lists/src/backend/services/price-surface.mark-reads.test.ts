import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceSurface } from './price-surface.js';
import type { SurfaceBookChange } from './surface-change.js';

/**
 * Review finding 9 (release 0.108.0) — marking a `books` change read every
 * profile (`#profileRefs`, a full scan of `price_profiles`) and the book's
 * channel set once **per book**, and the channel set once per fact. Both are
 * read once per change now: the profiles again only after a retire removed
 * some, the channel set once per book.
 */
describe('PriceSurface.markChanged — the reads of a books change', () => {
  function surface() {
    const reads = { profiles: 0, channels: [] as string[], retired: 0 };
    const em = {
      execute: async (sql: string) => {
        if (/^\s*select "id", "sales_channel_id", "currency_code", "book_vector" from "price_profiles"/.test(sql)) {
          reads.profiles += 1;
          return [{ id: 'everyone-ch1', sales_channel_id: 'ch1', currency_code: 'PLN', book_vector: [] }];
        }
        if (sql.includes('delete from "price_profiles"')) reads.retired += 1;
        return [];
      },
      transactional: async (work: (em: unknown) => Promise<unknown>) => work(em),
    };
    const priceSurface = new PriceSurface({
      emFactory: () => em as unknown as EntityManager,
      books: {} as never,
      listProducts: async () => [],
      productsByIds: async () => [],
      categories: {
        listProductIdsInCategory: async () => [],
        listProductIdsInSubtree: async () => [],
        listAssignmentsForProducts: async () => [],
      },
      bookChannels: async (bookId) => {
        reads.channels.push(bookId);
        return ['ch1'];
      },
    });
    return { priceSurface, reads };
  }

  const change = (bookId: string, retire = false): SurfaceBookChange => ({
    facts: [
      { bookId, currencyCode: 'PLN', audienceKind: 'everyone', isSystem: false, live: true },
      { bookId, currencyCode: 'PLN', audienceKind: 'everyone', isSystem: false, live: true },
    ],
    selections: [{ productId: 'p1', categoryId: null, attributeKey: null }],
    ...(retire ? { retire } : {}),
  });

  it('reads the profiles once and each book’s channel set once, however many books and facts', async () => {
    const { priceSurface, reads } = surface();
    await priceSurface.markChanged({ kind: 'books', books: [change('a'), change('b'), change('c')] });
    expect(reads.profiles).toBe(1);
    expect(reads.channels.sort()).toEqual(['a', 'b', 'c']);
  });

  it('re-reads the profiles after a retire, and only then', async () => {
    const { priceSurface, reads } = surface();
    await priceSurface.markChanged({ kind: 'books', books: [change('a'), change('b', true), change('c')] });
    expect(reads.retired).toBe(1);
    expect(reads.profiles).toBe(2);
  });
});
