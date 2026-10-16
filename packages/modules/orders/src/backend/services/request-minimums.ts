import {
  ADMIN_ORDER_MAX_ITEMS,
  ERROR_CODES,
  minimumRefusal,
  type CartBatchLineInput,
  type CartBatchLineOutcome,
  type OrderMinimumBelowViolation,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 148 — the two request-level rules of the order paths that build a
 * transient basket from a request (admin create-order, its preview, and the API
 * order intake): the item bound (FR-038, research R20) and the refusal of a
 * batch with a line below a minimum (FR-009, research R8,
 * `contracts/cart-and-checkout-api.md` §5, §10).
 */

/**
 * Refuses a request carrying more than `ADMIN_ORDER_MAX_ITEMS` items — `422
 * VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum }`. Called as
 * the caller's first step, before any line is resolved, evaluated or added. The
 * request schemas stay unbounded on purpose: a Zod refusal answers 400.
 */
export function assertWithinAdminOrderItemBound(count: number): void {
  if (count <= ADMIN_ORDER_MAX_ITEMS) return;
  throw new HttpError(
    422,
    ERROR_CODES.VALIDATION_FAILED,
    `At most ${ADMIN_ORDER_MAX_ITEMS} items can be ordered at once.`,
    { code: 'too_many_items', maximum: ADMIN_ORDER_MAX_ITEMS },
  );
}

/**
 * Refuses the whole request when the batch reported any line `below_minimum`:
 * the first such line's minimum code, every offending line in `details.lines`
 * keyed by its request `index` (a number). Names are the ones the batch
 * resolved in the request's language; a line that failed resolution never
 * reaches here (`onLineError: 'throw'` threw it, with the unknown id's answer).
 *
 * The figures the refusal reports beside the minimum — a pieces `total`, a
 * unit's `units` — are the batch's own: both callers clear the basket before the
 * batch runs, so the product's lines in this request are all the judgement
 * counted. Neither caller sends a packaging unit today (FR-009), so a line's
 * `quantity` is pieces.
 */
export function assertBatchMeetsMinimums(
  lines: readonly CartBatchLineInput[],
  outcomes: readonly CartBatchLineOutcome[],
): void {
  const below = outcomes.filter(
    (o): o is Extract<CartBatchLineOutcome, { status: 'below_minimum' }> => o.status === 'below_minimum',
  );
  if (below.length === 0) return;

  const piecesOf = (productId: string): number =>
    lines.filter((l) => l.productId === productId).reduce((sum, l) => sum + l.quantity, 0);
  const unitsOf = (productId: string, packagingUnitId: string): number =>
    lines
      .filter((l) => l.productId === productId && l.packagingUnitId === packagingUnitId)
      .reduce((sum, l) => sum + l.quantity, 0);

  const violations: OrderMinimumBelowViolation[] = below.map((o) => {
    if (o.kind === 'pieces') {
      return { key: String(o.index), productId: o.productId, kind: 'pieces', minimum: o.minimum, total: piecesOf(o.productId) };
    }
    const packagingUnitId = lines[o.index]?.packagingUnitId ?? '';
    return {
      key: String(o.index),
      productId: o.productId,
      kind: 'packaging_unit',
      packagingUnitId,
      packagingUnitName: o.packagingUnitName ?? '',
      minimum: o.minimum,
      units: unitsOf(o.productId, packagingUnitId),
    };
  });
  const names = new Map(below.map((o) => [o.productId, o.productName]));
  const refusal = minimumRefusal(violations, names, 'index');
  if (refusal === null) return;
  throw new HttpError(422, ERROR_CODES[refusal.code], refusal.message, refusal.details);
}

/**
 * The first tag of an `Accept-Language` header, or `undefined` — the language a
 * batch names a refused product in. Absent, the record's own fallback chain.
 */
export function preferredLanguageOf(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(',')[0]?.split(';')[0]?.trim();
  return first ? first : undefined;
}
