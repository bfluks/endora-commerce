import type { z } from 'zod';
import { decimalText } from './price-book-decimal.js';

/**
 * A typed money amount has at most two decimal places — owner ruling of
 * 2026-10-24, issue #417. Every money field a person or an integration enters
 * (a delivery cost, a payment surcharge, a refund, a credit limit, a
 * promotion's fixed amount) refuses more with `400 AMOUNT_PRECISION_EXCEEDED`,
 * and nothing rounds it: an amount the platform stores is the amount that was
 * typed. Price-book prices have their own four-place grammar and do not use this.
 *
 * A typed **unit price** — a quote's desired, agreed or proposed price — keeps
 * up to four places (owner ruling of 2026-10-25): a unit price is carried at
 * four places from the price book to the invoice line and only the line value
 * is rounded (`specs/pricing/worked-examples.md` §10.18). It takes
 * {@link fourDecimalUnitPrice}, and more than four places is refused with its
 * own code, `400 UNIT_PRICE_PRECISION_EXCEEDED`, whose sentence says four.
 *
 * The refusal is a Zod issue tagged with the code, so a schema states it once
 * and the error envelope (`@endora-commerce/platform/http`) turns a request
 * whose only failures are this one into the error code.
 */
export const AMOUNT_PRECISION_EXCEEDED = 'AMOUNT_PRECISION_EXCEEDED' as const;

/** The refusal of a typed unit price with more than four decimal places (owner ruling of 2026-10-25). */
export const UNIT_PRICE_PRECISION_EXCEEDED = 'UNIT_PRICE_PRECISION_EXCEEDED' as const;

const DECIMAL = /^-?\d+(?:\.(\d+))?$/;

/** Whether a number (read as its shortest decimal) or a decimal string has at most `places` significant decimal places. */
function hasAtMostDecimals(value: number | string, places: number): boolean {
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  const match = DECIMAL.exec(decimalText(value));
  if (!match) return false;
  // Trailing zeros are not significant: `123.4500` is 123.45 (review of PR #423).
  return (match[1] ?? '').replace(/0+$/, '').length <= places;
}

/** Whether a number (read as its shortest decimal) or a decimal string has at most two decimal places. */
export function hasAtMostTwoDecimals(value: number | string): boolean {
  return hasAtMostDecimals(value, 2);
}

/** Whether a number (read as its shortest decimal) or a decimal string has at most four decimal places. */
export function hasAtMostFourDecimals(value: number | string): boolean {
  return hasAtMostDecimals(value, 4);
}

type PrecisionCode = typeof AMOUNT_PRECISION_EXCEEDED | typeof UNIT_PRICE_PRECISION_EXCEEDED;

/** A fresh object each time: Zod normalises a refinement's params in place. */
function precisionIssue(code: PrecisionCode = AMOUNT_PRECISION_EXCEEDED) {
  return { message: code, params: { code } };
}

/** A number schema refusing more than two decimal places with the precision issue. */
export function twoDecimalAmount<T extends z.ZodNumber>(schema: T): T {
  return schema.refine((value) => hasAtMostTwoDecimals(value), precisionIssue()) as T;
}

/**
 * A number schema refusing more than four decimal places with the unit-price
 * precision issue — a typed unit price (owner ruling of 2026-10-25). Trailing
 * zeros are not significant, as for {@link twoDecimalAmount}.
 */
export function fourDecimalUnitPrice<T extends z.ZodNumber>(schema: T): T {
  return schema.refine((value) => hasAtMostFourDecimals(value), precisionIssue(UNIT_PRICE_PRECISION_EXCEEDED)) as T;
}

/** A plain decimal string: an optional minus, digits, and optionally a point and digits. */
const DECIMAL_STRING = /^-?\d+(?:\.\d+)?$/;

function decimalStringRefinement<T extends z.ZodString>(
  schema: T,
  options: { pattern?: RegExp; message?: string },
  places: number,
  code: PrecisionCode,
): T {
  const pattern = options.pattern ?? DECIMAL_STRING;
  const message = options.message ?? 'Not a decimal amount';
  return schema.superRefine((value, ctx) => {
    if (!pattern.test(value) || !DECIMAL_STRING.test(value)) {
      ctx.addIssue({ code: 'custom', message });
      return;
    }
    if (!hasAtMostDecimals(value, places)) ctx.addIssue({ code: 'custom', ...precisionIssue(code) });
  }) as T;
}

/**
 * A decimal-string schema: a string that is not a decimal is refused with a
 * **format** issue (`options.message`, `Not a decimal amount` by default) and
 * nothing else; a decimal with a significant digit beyond the second place is
 * refused with the precision issue. Trailing zeros are not significant
 * (`"123.4500"` is 123.45). `options.pattern` narrows the format (a
 * non-negative amount, a bounded number of digits).
 */
export function twoDecimalAmountString<T extends z.ZodString>(
  schema: T,
  options: { pattern?: RegExp; message?: string } = {},
): T {
  return decimalStringRefinement(schema, options, 2, AMOUNT_PRECISION_EXCEEDED);
}

/**
 * The unit-price sibling of {@link twoDecimalAmountString}: the same grammar
 * and the same trim behaviour (pass `z.string().trim()` to accept surrounding
 * whitespace; trailing zeros are not significant), refusing a significant
 * digit beyond the **fourth** place with the unit-price precision issue.
 */
export function fourDecimalUnitPriceString<T extends z.ZodString>(
  schema: T,
  options: { pattern?: RegExp; message?: string } = {},
): T {
  return decimalStringRefinement(schema, options, 4, UNIT_PRICE_PRECISION_EXCEEDED);
}

/** The precision issue, for a `superRefine` that decides per field (a promotion's value is money only for `amount_off`). */
export function addAmountPrecisionIssue(ctx: z.RefinementCtx, path: PropertyKey[]): void {
  ctx.addIssue({ code: 'custom', path, ...precisionIssue() });
}

function hasPrecisionCode(issue: unknown, code: PrecisionCode): boolean {
  if (!issue || typeof issue !== 'object') return false;
  const params = (issue as { params?: { code?: unknown; params?: { code?: unknown } } }).params;
  return params?.code === code || params?.params?.code === code;
}

/** Whether a Zod issue (or a Fastify-wrapped one, whose `params` carry the issue's) is the precision issue. */
export function isAmountPrecisionIssue(issue: unknown): boolean {
  return hasPrecisionCode(issue, AMOUNT_PRECISION_EXCEEDED);
}

/** Whether a Zod issue (or a Fastify-wrapped one) is the unit-price precision issue. */
export function isUnitPricePrecisionIssue(issue: unknown): boolean {
  return hasPrecisionCode(issue, UNIT_PRICE_PRECISION_EXCEEDED);
}
