import {
  ERROR_CODES,
  evaluateOrderMinimums,
  isOrderMinimumEligibleType,
  isQuoteSeededLineExempt,
  minimumRefusal,
  type CartRecord,
  type CartItemRecord,
  type CatalogPackagingUnitRecord,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type OrderMinimumBelowViolation,
  type OrderMinimumLine,
  type OrderMinimumViolation,
  type OrderPreviewTotalResponse,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 155 (FR-008, FR-028, FR-036, FR-037; research R19;
 * `contracts/cart-and-checkout-api.md` §8–§9) — the basket's order minimums as
 * placement and the checkout preview judge them.
 *
 * The rule is `evaluateOrderMinimums` in `@endora-commerce/contracts`; what
 * lives here is how a basket feeds it at checkout: every line keyed by its cart
 * item id, a quote-seeded line exempt only when the caller has confirmed the
 * basket's quote source honours exemptions **now** (`quoteSourceHonoursExemptions`)
 * — never on the basket's mark alone, which is what the cart trusts.
 */

/** The product and packaging-unit records a basket's minimums are judged against. */
export interface BasketCatalogueRecords {
  products: CatalogProductRecord[];
  packagingUnits: CatalogPackagingUnitRecord[];
}

/**
 * One read of the basket's products and, for the eligible ones, their
 * packaging units — ids taken from the buyer's own basket (R7). A failed read
 * propagates: the placement fails rather than placing unchecked.
 */
export async function readBasketCatalogue(
  catalogProducts: Pick<CatalogProductReadPort, 'findByIds' | 'listPackagingUnitsByProductIds'>,
  items: ReadonlyArray<Pick<CartItemRecord, 'productId'>>,
): Promise<BasketCatalogueRecords> {
  const productIds = Array.from(new Set(items.map((item) => item.productId)));
  if (productIds.length === 0) return { products: [], packagingUnits: [] };
  const products = await catalogProducts.findByIds(productIds);
  const eligibleIds = products.filter((p) => isOrderMinimumEligibleType(p.type)).map((p) => p.id);
  const packagingUnits =
    eligibleIds.length > 0 ? await catalogProducts.listPackagingUnitsByProductIds(eligibleIds) : [];
  return { products, packagingUnits };
}

/**
 * Every violation of the basket, in basket order. `honoursExemptions` is the
 * caller's answer about the quote source; without it no line is exempt.
 */
export function evaluateBasketMinimums(
  cart: Pick<CartRecord, 'sourceQuoteRequestId'>,
  items: ReadonlyArray<
    Pick<
      CartItemRecord,
      'id' | 'productId' | 'quantity' | 'packagingUnitId' | 'packagingUnitBaseQuantity' | 'quoteSeededQuantity'
    >
  >,
  records: BasketCatalogueRecords,
  honoursExemptions: boolean,
): OrderMinimumViolation[] {
  const lines: OrderMinimumLine[] = items.map((item) => ({
    key: item.id,
    productId: item.productId,
    quantity: item.quantity,
    packagingUnitId: item.packagingUnitId ?? null,
    packagingUnitBaseQuantity: item.packagingUnitBaseQuantity ?? null,
    exempt:
      honoursExemptions &&
      isQuoteSeededLineExempt(cart, {
        quantity: item.quantity,
        quoteSeededQuantity: item.quoteSeededQuantity ?? null,
      }),
  }));
  return evaluateOrderMinimums(lines, records);
}

/**
 * Refuses the placement when the basket has any violation (§9):
 *
 * - a line whose product record is gone → `404 PRODUCT_NOT_FOUND` with every
 *   such line's `cartItemIds` and no name (FR-037, fail-closed);
 * - otherwise → the first violation's minimum code, the product named through
 *   `nameOf`, every violation in `details.lines` with its `cartItemId`.
 */
export function assertBasketMeetsMinimums(
  violations: readonly OrderMinimumViolation[],
  nameOf: (productId: string) => string,
): void {
  if (violations.length === 0) return;
  const unavailable = violations.filter((v) => v.kind === 'product_unavailable');
  if (unavailable.length > 0) {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.', {
      cartItemIds: unavailable.map((v) => v.key),
    });
  }
  const below = violations as readonly OrderMinimumBelowViolation[];
  const names = new Map(below.map((v) => [v.productId, nameOf(v.productId)]));
  const refusal = minimumRefusal(below, names, 'cartItemId');
  if (refusal === null) return;
  throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, refusal.details);
}

/** The preview's report of the same violations (§8): unavailable lines carry no name or minimum. */
export function belowMinimumLinesOf(
  violations: readonly OrderMinimumViolation[],
  nameOf: (productId: string) => string,
): OrderPreviewTotalResponse['belowMinimumLines'] {
  return violations.map((v) => {
    if (v.kind === 'product_unavailable') {
      return { cartItemId: v.key, productId: v.productId, kind: v.kind };
    }
    return {
      cartItemId: v.key,
      productId: v.productId,
      productName: nameOf(v.productId),
      kind: v.kind,
      minimum: v.minimum,
      ...(v.kind === 'packaging_unit' ? { packagingUnitName: v.packagingUnitName } : {}),
    };
  });
}
