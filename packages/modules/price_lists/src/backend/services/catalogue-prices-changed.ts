import type { CataloguePricesChangedEvent } from '@endora-commerce/contracts';
import type { SurfaceChange } from './surface-change.js';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` contracts/events-and-errors.md §1, R-6) —
 * the names-only form of a pricing-generation bump's `SurfaceChange`, as
 * `price_lists.catalogue_prices_changed` carries it. `null` for a change that moves nothing
 * a price is read from (`{ kind: 'none' }`): that bump is not announced.
 *
 * Nothing here is an amount. A change this cannot name precisely is widened, never
 * narrowed: a channel change named by code only, or a book change with no facts, becomes
 * `{ kind: 'all' }`; a book change over stored rows, or over a category or attribute
 * selection, names no products (`productIds: null`).
 */
export function cataloguePricesChangeOf(change: SurfaceChange): CataloguePricesChangedEvent['change'] | null {
  switch (change.kind) {
    case 'none':
      return null;
    case 'all':
      return { kind: 'all' };
    case 'channels':
      return change.channelIds && change.channelIds.length > 0 && !(change.channelCodes && change.channelCodes.length > 0)
        ? { kind: 'channels', channelIds: [...new Set(change.channelIds)] }
        : { kind: 'all' };
    case 'books': {
      const books: Extract<CataloguePricesChangedEvent['change'], { kind: 'books' }>['books'] = [];
      for (const book of change.books) {
        const first = book.facts[0];
        if (!first) return { kind: 'all' };
        const productIds =
          book.selections === 'stored' || book.selections.some((s) => s.productId === null)
            ? null
            : [...new Set(book.selections.map((s) => s.productId as string))];
        books.push({
          bookId: first.bookId,
          currencyCodes: [...new Set(book.facts.map((f) => f.currencyCode.toUpperCase()))],
          isSystem: book.facts.some((f) => f.isSystem),
          productIds,
        });
      }
      return { kind: 'books', books };
    }
    case 'products':
      return {
        kind: 'products',
        productIds: [...new Set(change.productIds)],
        ...(change.currencyCodes ? { currencyCodes: [...new Set(change.currencyCodes.map((c) => c.toUpperCase()))] } : {}),
      };
    case 'categories':
      return { kind: 'categories', categoryIds: [...new Set(change.categoryIds)] };
    case 'attributes':
      return { kind: 'attributes', attributeKeys: [...new Set(change.attributeKeys)] };
  }
}
