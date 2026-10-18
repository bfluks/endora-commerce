import type { ConversionSkip } from './shopping-list-service.js';

/** One line of the carts bridge's `droppedLines`, as a shopping-list append reports it. */
export interface ShoppingListDroppedLine {
  productId: string;
  /** The id: a skip carries no name, and the storefront resolves it. */
  productName: string;
  reason: 'below_minimum' | 'not_purchasable';
  minimum?: number;
}

/**
 * Feature 155 (FR-011, US4 #3) — `convertToCart`'s skipped items as the carts
 * bridge's `droppedLines`, the uniform shape of the three conversions into a
 * cart. A line below a minimum says so, with the minimum it missed; every other
 * skip is `not_purchasable`. Pure, and the one mapping both composition roots
 * call, so production and the test harness cannot answer an append differently.
 */
export function toCartDroppedLines(
  skipped: ReadonlyArray<Pick<ConversionSkip, 'productId' | 'minimum'> & { reason: string }>,
): ShoppingListDroppedLine[] {
  return skipped.map((skip) =>
    skip.reason === 'below_minimum'
      ? {
          productId: skip.productId,
          productName: skip.productId,
          reason: 'below_minimum',
          ...(skip.minimum !== undefined ? { minimum: skip.minimum } : {}),
        }
      : { productId: skip.productId, productName: skip.productId, reason: 'not_purchasable' },
  );
}
