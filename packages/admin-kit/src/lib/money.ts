import { unitPriceFractionDigits } from '@endora-commerce/contracts';

/**
 * Locale-aware money formatting for the admin panel.
 *
 * Amounts must render in the conventions of their currency's home country —
 * e.g. PLN as `1234,56 zł` (comma decimal separator, `zł` suffix, `pl-PL`),
 * USD as `$1,234.56` (`en-US`). Admin lists show records from many Sales
 * Channels side by side, each carrying its own currency, so the locale is
 * derived per amount from the currency itself rather than from the admin UI
 * language. Pass an explicit `locale` to override (e.g. the channel's
 * `defaultLanguage`).
 */

/**
 * Representative BCP-47 locale per ISO-4217 currency. Keeps the number and
 * symbol conventions aligned with the currency's home country.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  PLN: 'pl-PL',
  EUR: 'de-DE',
  USD: 'en-US',
  GBP: 'en-GB',
  CHF: 'de-CH',
  CZK: 'cs-CZ',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
  HUF: 'hu-HU',
  RON: 'ro-RO',
  UAH: 'uk-UA',
};

export function localeForCurrency(currency: string): string {
  return LOCALE_BY_CURRENCY[currency.toUpperCase()] ?? 'en-US';
}

/** What a formatted amount is. */
export interface FormatMoneyOptions {
  /**
   * The amount is a **unit price** (owner ruling of 2026-10-25): it shows two
   * places when its third and fourth are zero, otherwise its significant
   * places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`) —
   * `unitPriceFractionDigits` from `@endora-commerce/contracts`, the one rule
   * every surface shares. A line value or a total is not one and shows two.
   */
  unitPrice?: boolean;
}

/**
 * Format a decimal money amount as a localized currency string.
 *
 * @param amount   decimal amount (not minor units), e.g. `1234.56`
 * @param currency ISO-4217 code, e.g. `PLN`
 * @param locale   optional BCP-47 locale; defaults to the currency's home
 *                 locale so PLN renders as `1234,56 zł` regardless.
 * @param options  `{ unitPrice: true }` for a unit price (see {@link FormatMoneyOptions}).
 */
export function formatMoney(amount: number, currency: string, locale?: string, options: FormatMoneyOptions = {}): string {
  const loc = locale && locale.trim() !== '' ? locale : localeForCurrency(currency);
  const digits = options.unitPrice && Number.isFinite(amount) ? unitPriceFractionDigits(amount) : 2;
  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency,
      ...(options.unitPrice ? { minimumFractionDigits: 2, maximumFractionDigits: digits } : {}),
    }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number + code.
    return `${amount.toFixed(digits)} ${currency}`;
  }
}
