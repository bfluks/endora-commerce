/**
 * Feature 155 (FR-001, FR-002, FR-006a, FR-028, FR-037; research R6, R6.1, R9, R10) — the
 * one implementation of the minimum-order rule: a pieces minimum per product and a
 * minimum number of units per packaging unit.
 *
 * Pure, synchronous and I/O-free. Consumers (`carts`, `orders`, `quote_requests`,
 * `quick_order`) fetch the records through the ports they already resolve and call
 * {@link evaluateOrderMinimums}; none of them re-implements the rule.
 *
 * This file imports nothing: `catalog.ts` bounds its request schemas with
 * {@link ORDER_MINIMUM_MAX}, so an import back into it would be a cycle evaluated at load.
 */

/** Feature 155 (FR-001, FR-002) — the upper bound of both minimums. */
export const ORDER_MINIMUM_MAX = 1_000_000;

/** Integer in 1…{@link ORDER_MINIMUM_MAX}. `null` (clear) is the caller's to allow. */
export function isValidOrderMinimum(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= ORDER_MINIMUM_MAX;
}

/** Product types the minimums apply to (spec edge case *Product types*). */
const ELIGIBLE_PRODUCT_TYPES: ReadonlySet<string> = new Set(['simple', 'configurable']);

/**
 * Whether a product of `type` may carry a pieces minimum (D5) — the one predicate the
 * catalogue write path, the storefront projections and the rule below share.
 */
export function isOrderMinimumEligibleType(type: string): boolean {
  return ELIGIBLE_PRODUCT_TYPES.has(type);
}

/** One line as the rule sees it. `quantity` is always base pieces. */
export interface OrderMinimumLine {
  /** Caller's identity for the line: a cart item id, a request line index, a row number. */
  key: string;
  productId: string;
  quantity: number;
  packagingUnitId: string | null;
  /** The line's own base-quantity snapshot; `null` = use the unit's current value. */
  packagingUnitBaseQuantity: number | null;
  /** Counted toward totals, never itself refused (FR-028, FR-031 (b)). */
  exempt: boolean;
}

/** The fields of a product record the rule reads. */
export interface OrderMinimumProduct {
  id: string;
  /** The product type; minimums apply to `simple` and `configurable` only. */
  type: string;
  /** Pieces minimum; `null` or `≤ 1` = none. */
  minOrderQuantity: number | null;
}

/** The fields of a packaging-unit record the rule reads. */
export interface OrderMinimumPackagingUnit {
  id: string;
  productId: string;
  name: string;
  baseQuantity: number;
  /** Minimum units of this unit per order of the product; `null` = none. */
  minOrderUnits: number | null;
}

export interface OrderMinimumRules {
  /** Records of the lines' products. A line whose product is absent here is `product_unavailable`. */
  products: ReadonlyArray<OrderMinimumProduct>;
  packagingUnits: ReadonlyArray<OrderMinimumPackagingUnit>;
}

export type OrderMinimumViolation =
  /** FR-037 — no record for the product: fail-closed, reported as an unknown product. */
  | { key: string; productId: string; kind: 'product_unavailable' }
  | { key: string; productId: string; kind: 'pieces'; minimum: number; total: number }
  | {
      key: string;
      productId: string;
      kind: 'packaging_unit';
      packagingUnitId: string;
      packagingUnitName: string;
      minimum: number;
      /** Real number: 96 pieces on a 64-piece unit = 1.5. */
      units: number;
    };

/** A violation of an actual minimum — what {@link minimumRefusal} accepts. */
export type OrderMinimumBelowViolation = Exclude<OrderMinimumViolation, { kind: 'product_unavailable' }>;

/**
 * Pure, O(lines + products + units). Violations in input-line order; for one line,
 * `product_unavailable` alone, else `pieces` before `packaging_unit`.
 *
 * - A line whose product has no record → `product_unavailable`, counted toward nothing.
 * - Minimums apply to `simple` / `configurable` products only; `minOrderQuantity ≤ 1` and
 *   `minOrderUnits = null` are "no rule".
 * - Pieces: the product's total over every line (all variants, exempt lines included); below
 *   the minimum, every non-exempt line of the product is flagged.
 * - Packaging unit: for a line naming a current unit of its own product, the units over the
 *   product's lines in that unit (each line by its own base-quantity snapshot, else the unit's
 *   current value); below the minimum, every non-exempt line in that unit is flagged. A unit
 *   that no longer exists (or belongs to another product) gives no unit rule.
 */
export function evaluateOrderMinimums(
  lines: readonly OrderMinimumLine[],
  rules: OrderMinimumRules,
): OrderMinimumViolation[] {
  // Pass 1 — index the records.
  const productsById = new Map<string, OrderMinimumProduct>();
  for (const product of rules.products) productsById.set(product.id, product);
  const unitsById = new Map<string, OrderMinimumPackagingUnit>();
  for (const unit of rules.packagingUnits) unitsById.set(unit.id, unit);

  // The unit rule that applies to a line, or `null`.
  const unitOf = (line: OrderMinimumLine): OrderMinimumPackagingUnit | null => {
    if (line.packagingUnitId === null) return null;
    const unit = unitsById.get(line.packagingUnitId);
    return unit !== undefined && unit.productId === line.productId ? unit : null;
  };

  // Pass 2 — accumulate per-product pieces and per-(product, unit) units.
  // Units are summed as exact fractions (D2): `7/10 + 1/10 + 1/10 + 1/10` is one
  // unit, where the floating-point sum is 0.9999999999999999 and would refuse it.
  const piecesByProduct = new Map<string, number>();
  const unitsByProductUnit = new Map<string, Fraction>();
  for (const line of lines) {
    if (!productsById.has(line.productId)) continue;
    piecesByProduct.set(line.productId, (piecesByProduct.get(line.productId) ?? 0) + line.quantity);
    const unit = unitOf(line);
    if (unit === null) continue;
    const baseQuantity = line.packagingUnitBaseQuantity ?? unit.baseQuantity;
    const unitKey = productUnitKey(line.productId, unit.id);
    unitsByProductUnit.set(
      unitKey,
      addFractions(unitsByProductUnit.get(unitKey) ?? ZERO_FRACTION, fractionOf(line.quantity, baseQuantity)),
    );
  }

  // Pass 3 — emit, in input order.
  const violations: OrderMinimumViolation[] = [];
  for (const line of lines) {
    const product = productsById.get(line.productId);
    if (product === undefined) {
      violations.push({ key: line.key, productId: line.productId, kind: 'product_unavailable' });
      continue;
    }
    if (line.exempt || !isOrderMinimumEligibleType(product.type)) continue;

    const minimum = product.minOrderQuantity;
    if (minimum !== null && minimum > 1) {
      const total = piecesByProduct.get(product.id) ?? 0;
      if (total < minimum) {
        violations.push({ key: line.key, productId: product.id, kind: 'pieces', minimum, total });
      }
    }

    const unit = unitOf(line);
    if (unit !== null && unit.minOrderUnits !== null) {
      const units = unitsByProductUnit.get(productUnitKey(product.id, unit.id)) ?? ZERO_FRACTION;
      if (fractionBelow(units, unit.minOrderUnits)) {
        violations.push({
          key: line.key,
          productId: product.id,
          kind: 'packaging_unit',
          packagingUnitId: unit.id,
          packagingUnitName: unit.name,
          minimum: unit.minOrderUnits,
          units: fractionValue(units),
        });
      }
    }
  }
  return violations;
}

function productUnitKey(productId: string, unitId: string): string {
  return `${productId}\u0000${unitId}`;
}

/**
 * A non-negative rational number of units, in lowest terms. `bigint`, because the
 * common denominator of lines snapshotted on different bases is their product,
 * which passes 2^53 after three bases near the {@link ORDER_MINIMUM_MAX} bound.
 */
interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

const ZERO_FRACTION: Fraction = { numerator: 0n, denominator: 1n };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function reduce(numerator: bigint, denominator: bigint): Fraction {
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/**
 * `quantity / baseQuantity` as a fraction. Both are integers by contract (pieces and
 * a unit's pieces); a non-integer is scaled to an integer ratio rather than refused,
 * so a malformed snapshot is judged, never thrown.
 */
function fractionOf(quantity: number, baseQuantity: number): Fraction {
  if (Number.isInteger(quantity) && Number.isInteger(baseQuantity) && baseQuantity > 0) {
    return reduce(BigInt(quantity), BigInt(baseQuantity));
  }
  const scale = 1_000_000;
  return reduce(BigInt(Math.round(quantity * scale)), BigInt(Math.max(1, Math.round(baseQuantity * scale))));
}

function addFractions(a: Fraction, b: Fraction): Fraction {
  return reduce(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

/** `value < minimum`, compared exactly. */
function fractionBelow(value: Fraction, minimum: number): boolean {
  return value.numerator < BigInt(minimum) * value.denominator;
}

/** The fraction as the real number the violation reports (`units`). */
function fractionValue(value: Fraction): number {
  return Number(value.numerator) / Number(value.denominator);
}

/**
 * Builds the refusal for a single- or multi-line case (R10) from **minimum** violations
 * (`product_unavailable` is the caller's 404, never passed here): the first violation's code; its
 * `productName`, `minimum` and `packagingUnitName` at the top level of `details` (what the bundle
 * sentence interpolates — SC-004); every violation in `details.lines`, each with its `productName`
 * and the caller's key under `keyName` (`cartItemId`, or `index` as a number). Names are resolved
 * by the caller in the request's language; `message` is the English fallback the envelope
 * replaces with the translated bundle sentence. Returns `null` for no violations.
 */
export function minimumRefusal(
  violations: readonly OrderMinimumBelowViolation[],
  productNameById: ReadonlyMap<string, string>,
  keyName: 'cartItemId' | 'index',
): {
  code: 'PRODUCT_BELOW_MINIMUM_QUANTITY' | 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY';
  message: string;
  details: Record<string, unknown>;
} | null {
  const first = violations[0];
  if (first === undefined) return null;

  const nameOf = (productId: string): string => productNameById.get(productId) ?? productId;
  const lines = violations.map((v) => ({
    [keyName]: keyName === 'index' ? Number(v.key) : v.key,
    productId: v.productId,
    productName: nameOf(v.productId),
    kind: v.kind,
    minimum: v.minimum,
    ...(v.kind === 'packaging_unit' ? { packagingUnitName: v.packagingUnitName } : {}),
  }));
  const productName = nameOf(first.productId);

  if (first.kind === 'pieces') {
    return {
      code: 'PRODUCT_BELOW_MINIMUM_QUANTITY',
      message: `"${productName}" has a minimum order quantity of ${first.minimum} pcs.`,
      details: {
        productId: first.productId,
        productName,
        minimum: first.minimum,
        total: first.total,
        lines,
      },
    };
  }
  return {
    code: 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY',
    message: `"${productName}" must be ordered in at least ${first.minimum} × ${first.packagingUnitName}.`,
    details: {
      productId: first.productId,
      productName,
      packagingUnitId: first.packagingUnitId,
      packagingUnitName: first.packagingUnitName,
      minimum: first.minimum,
      units: first.units,
      lines,
    },
  };
}
