import { decimalText } from '@endora-commerce/contracts';

/**
 * Sub-cent unit prices in a feed — issue #430.
 *
 * A unit price keeps up to four places (owner ruling of 2026-10-25,
 * `specs/pricing/worked-examples.md` §10.18), and a feed's price grammar is two:
 * Google Merchant Center rounds a longer price itself, so a screw at 0.0125 PLN
 * would be published as 0.01 PLN against a landing page showing 0,0125 PLN. Such
 * an item is published as a **pack** instead — the price of N units, N the
 * smallest power of ten that makes it exact to the cent — and the pack size is
 * stated in the format's own fields. Nothing is rounded to get there.
 */

/** The largest pack a feed publishes; a price that needs more is skipped. */
export const MAX_FEED_PACK_QUANTITY = 10_000;

/**
 * The largest pack the unit-pricing fields describe: Google's
 * `unit_pricing_base_measure` takes 1, 10 or 100 of a count (`ct`), and the base
 * is the pack itself, so the unit price it shows is the pack price, exact.
 */
export const MAX_UNIT_PRICING_PACK = 100;

const DECIMAL = /^-?(\d+)(?:\.(\d+))?$/;

/**
 * The smallest power of ten N for which `amount × N` has at most two decimal
 * places: 1 for a price with two significant places (`12.5000`), 100 for
 * `0.0125`, 10 for `9.0450`. `null` when N would exceed
 * {@link MAX_FEED_PACK_QUANTITY}. Read from the decimal as written — trailing
 * zeros are not significant — never from a double.
 */
export function feedPackQuantity(amount: string | number): number | null {
  const match = DECIMAL.exec(decimalText(amount));
  if (!match) throw new Error(`Not a decimal amount: "${String(amount)}"`);
  const significant = (match[2] ?? '').replace(/0+$/, '').length;
  if (significant <= 2) return 1;
  const quantity = 10 ** (significant - 2);
  return quantity <= MAX_FEED_PACK_QUANTITY ? quantity : null;
}

/** `100ct` — the pack as a count, for `unit_pricing_measure` and its base; empty past {@link MAX_UNIT_PRICING_PACK}. */
export function packCountMeasure(quantity: number): string {
  return quantity > 1 && quantity <= MAX_UNIT_PRICING_PACK ? `${quantity}ct` : '';
}
