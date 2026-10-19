import { tForLocale } from './i18n/messages';

/**
 * Feature 155 — the storefront's reading of a product's order minimums (FR-014, FR-016).
 *
 * Pure and React-free so the product page, the product card and the comparison share one
 * answer, and so it is testable in the storefront's node-only test environment. The binding
 * rule is the server's (`evaluateOrderMinimums` in `@endora-commerce/contracts`); these helpers
 * only keep the interface from offering a quantity the cart would refuse.
 */

/** The product fields the helpers read. `null`, absent or `≤ 1` = no pieces minimum. */
export interface MinimumProduct {
  minOrderQuantity?: number | null | undefined;
}

/** The packaging-unit fields the helpers read. `null` or absent = no unit minimum. */
export interface MinimumPackagingUnit {
  name: string;
  baseQuantity: number;
  minOrderUnits?: number | null | undefined;
}

/** The pieces minimum as a rule, or `null` when there is none (a minimum of 1 is none). */
function piecesMinimum(product: MinimumProduct): number | null {
  const minimum = product.minOrderQuantity;
  return typeof minimum === 'number' && minimum > 1 ? Math.floor(minimum) : null;
}

/**
 * The lowest quantity the product page offers, in the unit the input counts: pieces when no
 * packaging unit is selected, units of the selected one otherwise.
 *
 * With a unit selected both rules apply, as on the server (US3 #4 — each is checked
 * separately): at least the unit's own minimum, and enough units that their pieces reach the
 * pieces minimum.
 */
export function orderFloor(product: MinimumProduct, unit: MinimumPackagingUnit | null): number {
  const pieces = piecesMinimum(product);
  if (unit === null) return pieces ?? 1;
  const unitMinimum =
    typeof unit.minOrderUnits === 'number' && unit.minOrderUnits > 1 ? Math.floor(unit.minOrderUnits) : 1;
  const unitsForPieces = pieces !== null && unit.baseQuantity > 0 ? Math.ceil(pieces / unit.baseQuantity) : 1;
  return Math.max(unitMinimum, unitsForPieces, 1);
}

/** A whole count in the locale's digit grouping ("1 000" in Polish). */
export function formatCount(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}

/**
 * The sentence stated beside the quantity input — "Minimum order: 10 pcs", or with a unit
 * "Minimum order: 2 × Pallet = 128 pcs" — or `null` when nothing beyond one piece (or one
 * unit) is required.
 */
export function minimumStatement(
  product: MinimumProduct,
  unit: MinimumPackagingUnit | null,
  locale: string,
): string | null {
  const t = tForLocale(locale);
  const floor = orderFloor(product, unit);
  if (floor <= 1) return null;
  if (unit === null) {
    return t('product.minimum.pieces').replace('{count}', formatCount(floor, locale));
  }
  return t('product.minimum.units')
    .replace('{units}', formatCount(floor, locale))
    .replace('{count}', formatCount(floor * unit.baseQuantity, locale))
    // The operator-authored name goes in last, so a brace in it is never read as a placeholder.
    .replace('{unit}', () => unit.name);
}

/**
 * Normalises what the buyer typed into a whole quantity no lower than `floor` and no higher
 * than `max` (never below the floor, even when the floor exceeds the input's usual ceiling).
 */
export function clampQuantity(raw: string | number, floor: number, max = 9999): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  const ceiling = Math.max(max, floor);
  if (!Number.isFinite(n)) return floor;
  return Math.min(Math.max(Math.floor(n), floor), ceiling);
}

/**
 * Feature 155 (FR-014) — what the product page's quantity input reads once it loses focus:
 * the typed text normalised by `clampQuantity` (below the floor or empty → the floor, a valid
 * quantity kept). The input keeps what is typed until then.
 */
export function normaliseOnBlur(text: string, floor: number): string {
  return String(clampQuantity(text, floor));
}

/**
 * The quantity after the buyer switches packaging unit: a quantity still sitting at the old
 * floor follows to the new one (the buyer never chose it); any other quantity is kept, lifted
 * to the new floor when below it.
 */
export function quantityOnUnitChange(qty: number, oldFloor: number, newFloor: number): number {
  if (qty === oldFloor) return newFloor;
  return Math.max(qty, newFloor);
}

/** The quantity a one-click "add to cart" (product card, comparison) adds: the minimum, else 1. */
export function cardAddQuantity(minOrderQuantity: number | null | undefined): number {
  return piecesMinimum({ minOrderQuantity }) ?? 1;
}

/** The input the product card and the comparison pass to `addProductToCartAction`. */
export function cardAddToCartPayload(
  productId: string,
  minOrderQuantity: number | null | undefined,
): { productId: string; quantity: number } {
  return { productId, quantity: cardAddQuantity(minOrderQuantity) };
}

/**
 * The accessible name of the card's icon-only "add to cart" when it adds more than one piece
 * ("Add 10 pcs to cart"), or `null` to keep the existing label.
 */
export function cardAddLabel(minOrderQuantity: number | null | undefined, locale: string): string | null {
  const minimum = piecesMinimum({ minOrderQuantity });
  if (minimum === null) return null;
  return tForLocale(locale)('product.minimum.addToCart').replace('{count}', formatCount(minimum, locale));
}

/**
 * The product card's add-to-cart label: the quantity it adds when the product has a minimum,
 * else the catalogue's plain label — always in the request's language.
 */
export function cardAddToCartLabel(minOrderQuantity: number | null | undefined, locale: string): string {
  return cardAddLabel(minOrderQuantity, locale) ?? tForLocale(locale)('product.addToCart');
}

/**
 * The quantity every "add to quote request" starts at (FR-032, US4 #13): the product card's
 * one-click add, and the initial value of `AddToRfqButton`'s input — the minimum, else 1. The
 * quote-request draft mirrors the cart, so this is the cart's answer under the draft's name.
 */
export function quoteAddQuantity(minOrderQuantity: number | null | undefined): number {
  return cardAddQuantity(minOrderQuantity);
}
