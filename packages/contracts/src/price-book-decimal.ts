/**
 * Integer decimal arithmetic for price-book prices — feature 161, G17
 * (`specs/161-price-book-editor/contracts/backend-gaps.md`), moved here from
 * `price_lists`' `matrix-decimal.ts` (features 148 and 160), which re-exports
 * it: the resolver prices with these functions and the admin's labelled
 * previews (FR-030) compute with the same ones, so a preview rounds exactly as
 * the server does.
 *
 * Amounts are `numeric(14,4)` and percentages two places, and both travel as
 * strings. A percentage or an amount adjustment is the one place a price is
 * *computed* rather than read, so it is computed on integers: amounts in
 * ten-thousandths, percentages in hundredths, one multiplication and one
 * half-up rounding back to four fractional digits — the precision a typed row
 * is stored at, so a computed price and a typed one are indistinguishable to
 * carts and orders. A double carries fifteen significant digits and
 * `numeric(14,4)` eighteen, which is why nothing here goes through `Number`.
 * No dependency: one multiplication does not justify one (Constitution IV).
 */

const AMOUNT = /^(\d+)(?:\.(\d{1,4}))?$/;
const SIGNED_AMOUNT = /^(-)?(\d+)(?:\.(\d{1,4}))?$/;
const SIGNED_PERCENT = /^(-)?(\d{1,4})(?:\.(\d{1,2}))?$/;

/** A non-negative decimal string with up to four fractional digits, as ten-thousandths. */
export function parseUnits(value: string): bigint {
  const match = AMOUNT.exec(value);
  if (!match) throw new Error(`Not a decimal amount with up to 4 fractional digits: "${value}"`);
  return BigInt(match[1]!) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}

/** Ten-thousandths as a decimal string with exactly four fractional digits. */
export function formatUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10_000n;
  const fraction = (abs % 10_000n).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** Numeric comparison of two non-negative decimal strings: −1, 0 or 1. */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const x = parseUnits(a);
  const y = parseUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A signed decimal string with up to four fractional digits, as ten-thousandths. */
export function parseSignedUnits(value: string): bigint {
  const match = SIGNED_AMOUNT.exec(value);
  if (!match) throw new Error(`Not a signed decimal amount with up to 4 fractional digits: "${value}"`);
  const units = BigInt(match[2]!) * 10_000n + BigInt((match[3] ?? '').padEnd(4, '0'));
  return match[1] ? -units : units;
}

/** A signed percentage with up to two fractional digits, as hundredths of a percent. */
export function parseSignedPercentHundredths(value: string): bigint {
  const match = SIGNED_PERCENT.exec(value);
  if (!match) throw new Error(`Not a signed percentage with up to 2 fractional digits: "${value}"`);
  const hundredths = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -hundredths : hundredths;
}

/**
 * `reference × (1 + percent / 100)`, rounded half-up to four fractional digits
 * (FR-019 of spec 160) — `−10` is a 10 % discount, `+20` a 20 % surcharge. The
 * reference is a price (never negative) and the percentage is at least −100,
 * so the product is never negative and half-up is one integer step. `null`
 * when the result would be negative, which the bounds make impossible but the
 * caller treats as "this row does not price" all the same (FR-008).
 */
export function applySignedPercent(reference: string, percent: string): string | null {
  const units = parseUnits(reference);
  const factor = 10_000n + parseSignedPercentHundredths(percent);
  if (factor < 0n) return null;
  return formatUnits((units * factor + 5_000n) / 10_000n);
}

/** `reference + delta`, or `null` when that is below zero (FR-008). Zero is a price. */
export function applyAmountAdjustment(reference: string, delta: string): string | null {
  const units = parseUnits(reference) + parseSignedUnits(delta);
  return units < 0n ? null : formatUnits(units);
}

/** A non-negative decimal string normalised to four fractional digits. */
export function normaliseAmount(value: string): string {
  return formatUnits(parseUnits(value));
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/**
 * A decimal as text: a string trimmed, a number as the shortest decimal that
 * round-trips it — `String(9.045)` is `"9.045"`, which is the decimal a
 * four-place amount string parsed with `Number` came from. A magnitude
 * `String` writes in exponent form is far outside any price, but is still a
 * number: a large one is an integer (every double from 2^53 up is), a tiny one
 * is read at twelve places. The one reading every helper here and the
 * storefront's gross share (review 3 of release 0.108.0, D1).
 */
export function decimalText(value: string | number): string {
  if (typeof value === 'string') return value.trim();
  if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return Math.abs(value) >= 1 ? BigInt(value).toString() : value.toFixed(12);
}

/**
 * An amount at two places, rounded **half-up on its decimal digits** (half
 * away from zero for a negative amount) — the one rule every surface that
 * shows or stores a price at two places applies to a resolver amount: the
 * cart line (which the order copies), the admin order preview, a quote's
 * reference price and the product feed, and what the storefront shows, since
 * `Intl.NumberFormat` rounds the same decimal digits half-expand.
 *
 * `Number(amount).toFixed(2)` is not this rule: it rounds the binary double,
 * and 9.0450 is the double 9.04499…, so it answered 9.04 where the card showed
 * 9,05 (review finding 2 of release 0.108.0; `specs/pricing/worked-examples.md`
 * §10.16). A number is read as the shortest decimal that round-trips it —
 * `String(9.045)` is `"9.045"` — which is the decimal a four-place amount
 * string parsed with `Number` came from.
 */
export function roundAmountHalfUp(value: string | number): string {
  const text = decimalText(value);
  const match = DECIMAL.exec(text);
  if (!match) throw new Error(`Not a decimal amount: "${String(value)}"`);
  const fraction = (match[3] ?? '').padEnd(3, '0');
  // Hundredths, plus one when the dropped digits are at least half of one.
  let hundredths = BigInt(match[2]!) * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) hundredths += 1n;
  const negative = match[1] === '-' && hundredths !== 0n;
  const whole = hundredths / 100n;
  const cents = (hundredths % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${cents}`;
}

const UNSIGNED_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** A non-negative decimal ({@link decimalText}) as an integer and a scale. */
function decimalParts(value: string | number, what: string): { digits: bigint; scale: number } {
  const text = decimalText(value);
  const match = UNSIGNED_DECIMAL.exec(text);
  if (!match) throw new Error(`Not a non-negative decimal ${what}: "${String(value)}"`);
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1]! + fraction), scale: fraction.length };
}

/**
 * The gross of a net amount at a tax rate — `net × (1 + rate / 100)` for a
 * rate in percent — at two places, rounded **half-up on the exact decimal product** (review 2,
 * finding 2 of release 0.108.0; `specs/pricing/worked-examples.md` §10.16).
 *
 * The companion of {@link roundAmountHalfUp} for a figure that is computed
 * rather than read: a product feed's gross price, and the gross the storefront
 * shows beside a net one. Computed on integers — `net` and `rate` as written,
 * one multiplication, one half-up step — because `29.50 × 1.23` is the double
 * 36.28499…, so binary arithmetic published 36.28 where the price is 36.29.
 * Both arguments are non-negative decimals ({@link decimalText}). The rate is
 * in percent (`23`) unless `unit` says it is a fraction (`0.23`, the
 * storefront's `DEFAULT_VAT_RATE`), which is read as written rather than
 * multiplied by 100 on a double.
 */
export function grossAmountHalfUp(
  net: string | number,
  rate: string | number,
  unit: 'percent' | 'fraction' = 'percent',
): string {
  const amount = decimalParts(net, 'amount');
  const parts = decimalParts(rate, 'rate');
  // A percent is a fraction written two places further right.
  const shift = unit === 'percent' ? 2 : 0;
  // (1 + rate) as an integer at the rate's scale plus the shift.
  const factor = 10n ** BigInt(parts.scale + shift) + parts.digits;
  const product = amount.digits * factor;
  const scale = amount.scale + parts.scale + shift;
  // Hundredths, half-up: add half of the dropped unit, then truncate.
  const hundredths =
    scale <= 2
      ? product * 10n ** BigInt(2 - scale)
      : (product + 10n ** BigInt(scale - 2) / 2n) / 10n ** BigInt(scale - 2);
  const whole = hundredths / 100n;
  const cents = (hundredths % 100n).toString().padStart(2, '0');
  return `${whole.toString()}.${cents}`;
}
