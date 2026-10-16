import {
  ERROR_CODES,
  evaluateOrderMinimums,
  isOrderMinimumEligibleType,
  isQuoteSeededLineExempt,
  minimumRefusal,
  type CartRecord,
  type CatalogPackagingUnitRecord,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type OrderMinimumLine,
  type OrderMinimumRules,
  type OrderMinimumViolation,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { pickLocalized } from './localized-name.js';

/**
 * Feature 148 (FR-006, FR-006a, FR-007, FR-013, FR-028, FR-037; research R11) —
 * the cart's side of the catalogue's order minimums.
 *
 * The rule itself is `evaluateOrderMinimums` in `@endora-commerce/contracts`; what
 * lives here is how the cart feeds it: the basket as it *would be* after one add
 * or edit (the prospective lines), the quote-line exemption applied to the
 * prospective quantity, and the refusal of the one line the change touches.
 */

/** The key of the line an add appends when nothing in the basket matches it. */
export const NEW_CART_LINE_KEY = 'new';

/** The fields of a basket line the minimum rule reads. */
export interface CartMinimumItem {
  id: string;
  productId: string;
  variantId: string | null;
  /** Base pieces. */
  quantity: number;
  packagingUnitId: string | null;
  packagingUnitBaseQuantity: number | null;
  quoteSeededQuantity: number | null;
}

/** One change to the basket, as the cart applies it. */
export type CartLineChange =
  | {
      kind: 'add';
      productId: string;
      variantId: string | null;
      packagingUnitId: string | null;
      packagingUnitBaseQuantity: number | null;
      /** Base pieces — the units already multiplied out. */
      quantity: number;
    }
  | { kind: 'edit'; itemId: string; quantity: number };

export interface ProspectiveCartLines {
  lines: OrderMinimumLine[];
  /** The key of the line the change lands on: an item id, or {@link NEW_CART_LINE_KEY}. */
  touchedKey: string;
}

type CartQuoteMark = Pick<CartRecord, 'sourceQuoteRequestId'>;

/** A cart entity row (optional columns as `undefined`) as the rule reads it. */
export function toCartMinimumItem(item: {
  id: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  packagingUnitId?: string | null;
  packagingUnitBaseQuantity?: number | null;
  quoteSeededQuantity?: number | null;
}): CartMinimumItem {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity: item.quantity,
    packagingUnitId: item.packagingUnitId ?? null,
    packagingUnitBaseQuantity: item.packagingUnitBaseQuantity ?? null,
    quoteSeededQuantity: item.quoteSeededQuantity ?? null,
  };
}

function lineOf(cart: CartQuoteMark, key: string, item: CartMinimumItem, quantity: number): OrderMinimumLine {
  return {
    key,
    productId: item.productId,
    quantity,
    packagingUnitId: item.packagingUnitId,
    packagingUnitBaseQuantity: item.packagingUnitBaseQuantity,
    // FR-028 — judged on the quantity the line *will* have (owner ruling P2).
    exempt: isQuoteSeededLineExempt(cart, { quantity, quoteSeededQuantity: item.quoteSeededQuantity }),
  };
}

/**
 * The basket after `change`, as minimum lines. An add bumps the line matching its
 * `(product, variant, unit)` — the line `CartService.addItem` would bump — or
 * appends a new, never-exempt line; an edit replaces one line's quantity.
 */
export function buildProspectiveCartLines(
  cart: CartQuoteMark,
  items: readonly CartMinimumItem[],
  change: CartLineChange,
): ProspectiveCartLines {
  let touchedKey: string | null = null;
  const lines = items.map((item) => {
    let quantity = item.quantity;
    if (touchedKey === null) {
      if (change.kind === 'edit' && item.id === change.itemId) {
        quantity = change.quantity;
        touchedKey = item.id;
      } else if (
        change.kind === 'add' &&
        item.productId === change.productId &&
        item.variantId === change.variantId &&
        item.packagingUnitId === change.packagingUnitId
      ) {
        quantity = item.quantity + change.quantity;
        touchedKey = item.id;
      }
    }
    return lineOf(cart, item.id, item, quantity);
  });
  if (touchedKey !== null) return { lines, touchedKey };
  if (change.kind === 'edit') {
    throw new Error(`[carts] the edited line ${change.itemId} is not among the basket's lines.`);
  }
  lines.push({
    key: NEW_CART_LINE_KEY,
    productId: change.productId,
    quantity: change.quantity,
    packagingUnitId: change.packagingUnitId,
    packagingUnitBaseQuantity: change.packagingUnitBaseQuantity,
    exempt: false,
  });
  return { lines, touchedKey: NEW_CART_LINE_KEY };
}

/**
 * The touched line's first violation (`product_unavailable` alone, else pieces
 * before packaging unit), or `null`. Other lines' violations never refuse a
 * change — the read model flags them and placement refuses them (FR-013, FR-008).
 */
export function judgeTouchedCartLine(
  prospective: ProspectiveCartLines,
  rules: OrderMinimumRules,
): OrderMinimumViolation | null {
  return evaluateOrderMinimums(prospective.lines, rules).find((v) => v.key === prospective.touchedKey) ?? null;
}

/**
 * Refuses an add or edit that leaves the touched line below a minimum
 * (`contracts/cart-and-checkout-api.md` §1 step 4, §2).
 *
 * `product` is the touched line's product record: on an add, the one the line
 * resolver has already vetted (visibility, channel); on an edit, the record of
 * the product on the buyer's own basket line, `null` when it is gone. Products
 * never couple, so only that product's lines and units are read and judged — one
 * `listPackagingUnitsByProductIds` over that one vetted id.
 *
 * - No record → `404 PRODUCT_NOT_FOUND` with no name and no minimum (FR-037,
 *   fail-closed — never "no minimum").
 * - Below a minimum → `422 PRODUCT_BELOW_MINIMUM_QUANTITY` or
 *   `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, naming the product in `language`.
 *
 * Writes nothing and calls no pricing. No `catch`: a failed catalogue read fails
 * the change.
 */
export async function assertCartChangeMeetsMinimums(
  catalogProducts: Pick<CatalogProductReadPort, 'listPackagingUnitsByProductIds'>,
  input: {
    cart: CartQuoteMark;
    items: readonly CartMinimumItem[];
    change: CartLineChange;
    productId: string;
    product: CatalogProductRecord | null;
    language?: string | undefined;
  },
): Promise<void> {
  const { product } = input;
  const ownLines = input.items.filter((item) => item.productId === input.productId);
  const prospective = buildProspectiveCartLines(input.cart, ownLines, input.change);
  const packagingUnits =
    product !== null && isOrderMinimumEligibleType(product.type)
      ? await catalogProducts.listPackagingUnitsByProductIds([product.id])
      : [];
  const violation = judgeTouchedCartLine(prospective, {
    products: product !== null ? [product] : [],
    packagingUnits,
  });
  if (violation === null) return;
  if (violation.kind === 'product_unavailable' || product === null) {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
  }
  const refusal = minimumRefusal(
    [violation],
    new Map([[product.id, pickLocalized(product.name, input.language)]]),
    'cartItemId',
  );
  if (refusal === null) return;
  // A single-line refusal: the touched line is the whole story, so the top-level
  // details are the answer (§1) and the multi-line `lines` list is left out.
  const details: Record<string, unknown> = { ...refusal.details };
  delete details['lines'];
  throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, details);
}

/** What the full cart view reports per line (`contracts/cart-and-checkout-api.md` §3). */
export interface CartLineMinimumView {
  /** The product's current pieces minimum for the eligible types; `null` = none. */
  minOrderQuantity: number | null;
  belowMinimum: { kind: 'pieces' | 'packaging_unit'; minimum: number; packagingUnitName?: string } | null;
  /** FR-037 — the line's product record is gone. */
  unavailable: boolean;
}

/**
 * Evaluates every line of the basket for the full view (FR-013, FR-028, FR-037).
 *
 * `products` are the records the view has already read for the basket's ids;
 * the units are read here, once, for the eligible ones — ids taken from the
 * buyer's own basket. A failed read propagates: the view fails rather than
 * answering a cart without flags (D7).
 */
export async function evaluateCartViewMinimums(
  catalogProducts: Pick<CatalogProductReadPort, 'listPackagingUnitsByProductIds'>,
  cart: CartQuoteMark,
  items: readonly CartMinimumItem[],
  products: readonly CatalogProductRecord[],
): Promise<Map<string, CartLineMinimumView>> {
  const views = new Map<string, CartLineMinimumView>();
  if (items.length === 0) return views;
  const eligibleIds = products.filter((p) => isOrderMinimumEligibleType(p.type)).map((p) => p.id);
  const packagingUnits: CatalogPackagingUnitRecord[] =
    eligibleIds.length > 0 ? await catalogProducts.listPackagingUnitsByProductIds(eligibleIds) : [];
  const lines = items.map((item) => lineOf(cart, item.id, item, item.quantity));
  const violations = evaluateOrderMinimums(lines, { products, packagingUnits });
  const firstByKey = new Map<string, OrderMinimumViolation>();
  for (const violation of violations) {
    if (!firstByKey.has(violation.key)) firstByKey.set(violation.key, violation);
  }
  const productsById = new Map(products.map((p) => [p.id, p]));
  for (const item of items) {
    const product = productsById.get(item.productId);
    const violation = firstByKey.get(item.id);
    views.set(item.id, {
      minOrderQuantity:
        product !== undefined && isOrderMinimumEligibleType(product.type) ? (product.minOrderQuantity ?? null) : null,
      belowMinimum:
        violation === undefined || violation.kind === 'product_unavailable'
          ? null
          : violation.kind === 'pieces'
            ? { kind: 'pieces', minimum: violation.minimum }
            : { kind: 'packaging_unit', minimum: violation.minimum, packagingUnitName: violation.packagingUnitName },
      unavailable: violation?.kind === 'product_unavailable',
    });
  }
  return views;
}
