/**
 * What a linked Quote Request is shown as worth on a Project (User Story 6):
 * Σ quantity × the agreed unit price — or the price the customer asked for
 * while none has been agreed, the two the quote desk shows per line — rounded
 * once, on the sum, to two places half up. Quote prices are net of tax. The
 * currency is the first line's, which is what the desk shows the total in.
 *
 * Pure decimal arithmetic on strings (no floating point): a price is a decimal
 * string of any number of places, a quantity a whole number.
 */
export interface QuoteAmountLine {
  quantity: number;
  agreedUnitPrice: string | null;
  desiredUnitPrice: string | null;
  lineCurrency: string;
}

/** Places carried before the one rounding. */
const SCALE = 8;

function scaled(decimal: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal.trim());
  if (!match) return 0n;
  const [, sign, whole, fraction = ''] = match;
  const digits = `${whole}${fraction.padEnd(SCALE, '0').slice(0, SCALE)}`;
  const value = BigInt(digits);
  return sign === '-' ? -value : value;
}

function toTwoPlaces(value: bigint): string {
  const unit = 10n ** BigInt(SCALE - 2);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const cents = (magnitude + unit / 2n) / unit;
  const text = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  return negative && cents !== 0n ? `-${text}` : text;
}

export function quoteRequestAmount(lines: readonly QuoteAmountLine[]): { amount: string; currency: string | null } {
  let total = 0n;
  for (const line of lines) {
    const price = line.agreedUnitPrice ?? line.desiredUnitPrice;
    if (price === null) continue;
    total += scaled(price) * BigInt(Math.trunc(line.quantity));
  }
  return { amount: toTwoPlaces(total), currency: lines[0]?.lineCurrency ?? null };
}
