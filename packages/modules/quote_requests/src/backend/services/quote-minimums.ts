import {
  ERROR_CODES,
  evaluateOrderMinimums,
  minimumRefusal,
  type OrderMinimumBelowViolation,
  type OrderMinimumLine,
  type OrderMinimumRules,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { referenceInputsUnchanged, type ReferenceInputs } from './line-carry-over.js';

/**
 * Feature 155 (FR-012, FR-027, FR-029, FR-031; research R13.2–R13.4;
 * `contracts/quote-requests-api.md` §2, §3) — a quote request's lines as the
 * minimum rule (`evaluateOrderMinimums`) reads them, and the refusal a buyer's
 * write gets. Pure; the caller reads the records and calls this after the
 * product 404 and the packaging resolution, before any reference price is
 * resolved or anything is written.
 */

/** One line of a buyer's write, its packaging already resolved against the catalogue. */
export interface QuoteMinimumLineSource {
  productId: string;
  variantId: string | null;
  /** Base pieces. */
  quantity: number;
  packagingUnitId: string | null;
  packagingUnitName: string | null;
  packagingUnitBaseQuantity: number | null;
}

/**
 * Keys are the line indexes (the `index` of `details.lines[]`). A line carries
 * its resolved unit id and its own base-quantity snapshot (FR-027). `exempt` is
 * index-aligned; absent = nothing exempt.
 */
export function quoteMinimumLines(
  lines: ReadonlyArray<Pick<QuoteMinimumLineSource, 'productId' | 'quantity' | 'packagingUnitId' | 'packagingUnitBaseQuantity'>>,
  exempt: readonly boolean[] = [],
): OrderMinimumLine[] {
  return lines.map((line, index) => ({
    key: String(index),
    productId: line.productId,
    quantity: line.quantity,
    packagingUnitId: line.packagingUnitId,
    packagingUnitBaseQuantity: line.packagingUnitBaseQuantity,
    exempt: exempt[index] === true,
  }));
}

/**
 * FR-031 (b) — on a draft edit a line is exempt exactly when the customer-side
 * pairing matched it to a stored row **and** product, variant, quantity and
 * packaging are unchanged (`referenceInputsUnchanged`, the rule that also keeps
 * its stored reference). It still counts toward its product's total.
 */
export function draftEditExemptions(
  paired: ReadonlyArray<ReferenceInputs | null>,
  lines: readonly ReferenceInputs[],
): boolean[] {
  return lines.map((line, index) => {
    const row = paired[index] ?? null;
    return row !== null && referenceInputsUnchanged(row, line);
  });
}

/**
 * FR-031 (c) — a resubmission is judged as a new submission: pieces only
 * (`resubmit` copies no packaging), no exemption.
 */
export function resubmitMinimumLines(
  items: ReadonlyArray<{ productId: string; quantity: number }>,
): OrderMinimumLine[] {
  return quoteMinimumLines(
    items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      packagingUnitId: null,
      packagingUnitBaseQuantity: null,
    })),
  );
}

/**
 * Refuses a buyer's write whose lines miss a minimum.
 *
 * - A line whose product has no record → `404 PRODUCT_NOT_FOUND`, naming
 *   nothing, whatever the mode (FR-037: fail-closed, never "no minimum").
 * - `'enforce'` → `422 PRODUCT_BELOW_MINIMUM_QUANTITY` /
 *   `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (first line's kind), every offending
 *   line in `details.lines` keyed by `index`.
 * - `'warn'` — a representative writing through the buyer's path (FR-012) — is
 *   never refused for a minimum.
 */
export function assertQuoteMeetsMinimums(
  lines: readonly OrderMinimumLine[],
  rules: OrderMinimumRules,
  productNameById: ReadonlyMap<string, string>,
  mode: 'enforce' | 'warn',
): void {
  const violations = evaluateOrderMinimums(lines, rules);
  if (violations.some((v) => v.kind === 'product_unavailable')) {
    throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'One or more products do not exist.');
  }
  if (mode === 'warn') return;
  const refusal = minimumRefusal(violations as OrderMinimumBelowViolation[], productNameById, 'index');
  if (refusal === null) return;
  throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, refusal.details);
}

/** Feature 155 (FR-030) — what the admin read says about one line. */
export type QuoteLineMinimumWarning =
  | { kind: 'pieces'; minimum: number }
  | { kind: 'packaging_unit'; minimum: number; packagingUnitName: string };

/**
 * FR-030 (research R13.5) — the admin read's per-line warning: the request's
 * current lines evaluated with no exemption (product totals across the
 * request), the first violation of each line (`pieces` before
 * `packaging_unit`). Index-aligned with `lines`; `null` = the line meets its
 * minimums. A line whose product has no record gets `null` — the read informs
 * and never fails (the buyer's write is where a missing product is refused).
 */
export function quoteMinimumWarnings(
  lines: readonly OrderMinimumLine[],
  rules: OrderMinimumRules,
): Array<QuoteLineMinimumWarning | null> {
  const byKey = new Map<string, QuoteLineMinimumWarning>();
  for (const violation of evaluateOrderMinimums(lines, rules)) {
    if (violation.kind === 'product_unavailable' || byKey.has(violation.key)) continue;
    byKey.set(
      violation.key,
      violation.kind === 'pieces'
        ? { kind: 'pieces', minimum: violation.minimum }
        : { kind: 'packaging_unit', minimum: violation.minimum, packagingUnitName: violation.packagingUnitName },
    );
  }
  return lines.map((line) => byKey.get(line.key) ?? null);
}
