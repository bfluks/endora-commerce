/**
 * Feature 146 (FR-003 – FR-005) — the difference between a line's price and its
 * reference price, as the admin quote request screen shows it: an amount and a
 * percentage of the reference, both signed. The amount is a difference of unit
 * prices, so it keeps a unit price's four places (owner ruling of 2026-10-25,
 * issue #430) — 0.0124 against 0.0125 is −0.0001, not a 0.00 that reads as
 * "no difference"; the percentage is rounded to two decimals.
 *
 * Overview compares the customer's proposal; the Modify tab compares the agreed
 * price being typed. Both read this one rule and format at the edge, through
 * `number-format.ts` in the admin's language. Pure: no I/O, no locale.
 */

import { decimalDifference, decimalProduct, quotientHalfUp, roundHalfUp, unitPriceHalfUp } from '@endora-commerce/contracts';

/** A reference price as the screen holds it — stored at request, or current. */
export interface ReferenceAmount {
  amount: number;
  currency: string;
}

export interface ReferenceDifference {
  /** `price − reference`, at a unit price's four places. */
  amount: number;
  /** `(price − reference) / reference × 100`, two decimals; `null` for a zero reference. */
  percent: number | null;
}

/**
 * Two-decimal rounding, half-up on the decimal digits (half away from zero for
 * a negative difference) and never `-0` (issue #417: exact, where
 * `Math.round(n * 100) / 100` rounded the binary double).
 */
function round2(value: string): number {
  const rounded = Number(roundHalfUp(value));
  return rounded === 0 ? 0 : rounded;
}

/** The same at a unit price's four places (§10.18), never `-0`. */
function roundUnit(value: string): number {
  const rounded = Number(unitPriceHalfUp(value));
  return rounded === 0 ? 0 : rounded;
}

/**
 * `null` whenever the difference cannot be computed (FR-005): no price, no
 * reference, or a reference in another currency than the line. A zero
 * reference still has an amount but no percentage.
 */
export function referenceDifference(
  price: number | null,
  lineCurrency: string,
  reference: ReferenceAmount | null,
): ReferenceDifference | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (reference === null || !Number.isFinite(reference.amount)) return null;
  if (reference.currency !== lineCurrency) return null;
  const difference = decimalDifference(price, reference.amount);
  const amount = roundUnit(difference);
  const percent =
    reference.amount === 0 ? null : round2(quotientHalfUp(decimalProduct(difference, 100), reference.amount));
  return { amount, percent };
}
