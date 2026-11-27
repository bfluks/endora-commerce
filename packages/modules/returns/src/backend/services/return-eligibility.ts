import type { ReturnKind } from '@endora-commerce/contracts';

/**
 * The returns policy for feature 155's per-line returnable flag
 * (`specs/155-catalog-order-constraints/contracts/returns-api.md` §2–§3;
 * FR-017 – FR-020, FR-025, FR-033). Pure: no entity manager and no HTTP —
 * `ReturnCaseService` reads the facts and turns a verdict into a refusal.
 */

/** The facts about one order line the policy needs (a subset of `OrderReturnContextLine`). */
export interface EligibilityContextLine {
  orderItemId: string;
  name: string;
  purchasedQty: number;
  /** Recorded at placement (FR-016a); `null` = placed before feature 155. */
  returnableAtPurchase: boolean | null;
}

export interface RequestedLine {
  orderItemId: string;
  quantity: number;
}

/**
 * May this line be included in a `return` case? `null` — a line placed before
 * the stamp was recorded — is returnable (FR-025); `orders` reports the fact
 * and this is where it is interpreted.
 */
export function isLineReturnable(returnableAtPurchase: boolean | null): boolean {
  return returnableAtPurchase ?? true;
}

export type ReturnableVerdict =
  | { eligible: true }
  | { eligible: false; reason: 'order_not_completing' | 'fully_returned' | 'no_returnable_lines' };

/**
 * The order-level answer. Precedence: `order_not_completing`, then
 * `fully_returned`, then `no_returnable_lines`. `eligible` answers for
 * `return`-kind cases only: with `no_returnable_lines` a complaint is still
 * accepted (FR-018, plan D4).
 */
export function returnableVerdict(
  completing: boolean,
  lines: ReadonlyArray<{ remainingReturnableQty: number; returnable: boolean }>,
): ReturnableVerdict {
  if (!completing) return { eligible: false, reason: 'order_not_completing' };
  if (lines.every((l) => l.remainingReturnableQty === 0)) return { eligible: false, reason: 'fully_returned' };
  if (!lines.some((l) => l.returnable && l.remainingReturnableQty > 0)) {
    return { eligible: false, reason: 'no_returnable_lines' };
  }
  return { eligible: true };
}

/** Requested quantities summed per `orderItemId`, in first-seen order (FR-033). */
export function requestedTotals(lines: readonly RequestedLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.orderItemId, (totals.get(line.orderItemId) ?? 0) + line.quantity);
  return totals;
}

export type QuantityRefusal =
  | { code: 'unknown_line' }
  | { code: 'qty_exceeds_returnable'; orderItemId: string; requested: number; remaining: number };

/**
 * The per-line totals check, for both kinds (FR-033, SC-006): an unknown line,
 * or a line whose summed request exceeds what live cases have left of it.
 * Returnability is not considered here.
 */
export function checkRequestedQuantities(
  requested: readonly RequestedLine[],
  contextLines: readonly EligibilityContextLine[],
  consumed: ReadonlyMap<string, number>,
): QuantityRefusal | null {
  const byOrderItem = new Map(contextLines.map((l) => [l.orderItemId, l]));
  const totals = requestedTotals(requested);
  for (const orderItemId of totals.keys()) {
    if (!byOrderItem.has(orderItemId)) return { code: 'unknown_line' };
  }
  for (const [orderItemId, total] of totals) {
    const line = byOrderItem.get(orderItemId)!;
    const remaining = line.purchasedQty - (consumed.get(orderItemId) ?? 0);
    if (total > remaining) return { code: 'qty_exceeds_returnable', orderItemId, requested: total, remaining };
  }
  return null;
}

/**
 * The requested lines a `return` case may not include (FR-019), each once, in
 * request order. A complaint is never checked (FR-020). Lines unknown to the
 * order are left to `checkRequestedQuantities`.
 */
export function nonReturnableRequestedLines(
  kind: ReturnKind,
  requested: readonly RequestedLine[],
  contextLines: readonly EligibilityContextLine[],
): Array<{ orderItemId: string; productName: string }> {
  if (kind !== 'return') return [];
  const byOrderItem = new Map(contextLines.map((l) => [l.orderItemId, l]));
  const out: Array<{ orderItemId: string; productName: string }> = [];
  for (const orderItemId of requestedTotals(requested).keys()) {
    const line = byOrderItem.get(orderItemId);
    if (line && !isLineReturnable(line.returnableAtPurchase)) out.push({ orderItemId, productName: line.name });
  }
  return out;
}
