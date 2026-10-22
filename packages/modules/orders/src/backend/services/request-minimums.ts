import { ADMIN_ORDER_MAX_ITEMS, ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 155 — the request-level item bound of the order paths that build a
 * transient basket from a request (admin create-order, its preview, and the API
 * order intake; FR-038, research R20). The refusal of a batch with a line below
 * a minimum is the batch's own (`CartWritePort.addItems`,
 * `onBelowMinimum: 'throw'`), so it is decided before the basket is touched.
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
