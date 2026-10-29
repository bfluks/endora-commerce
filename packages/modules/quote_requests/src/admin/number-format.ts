import { useMemo } from 'react';
import { unitPriceFractionDigits } from '@endora-commerce/contracts';
import { useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 146, review fix round 1 (part B, N3) — the one money and percent
 * formatting of the admin quote request screens: two decimals in the **admin
 * language's** conventions (`120.00` in English, `120,00` in Polish), the
 * currency code appended by the caller as a separate word.
 *
 * Not `formatMoney` from the admin kit: that derives its locale from the
 * currency (PLN always renders Polish) and renders a currency symbol, where
 * these screens put the amount in the operator's language beside the line's
 * ISO code — the shape every translated History sentence already interpolates.
 */

/** The BCP-47 locale each admin language formats numbers in. */
const LOCALES: Record<string, string> = { en: 'en-GB', pl: 'pl-PL' };

export function adminNumberLocale(language: string): string {
  return LOCALES[language] ?? language;
}

const MINUS = '−';

export interface RfqNumberFormat {
  /** `1,234.50` / `1 234,50`. */
  amount: (n: number) => string;
  /** `1,234.50 PLN`. */
  money: (n: number, currency: string) => string;
  /**
   * A unit price: its significant places, up to four, at least two (owner
   * ruling of 2026-10-25) — `0.0125`, `1.50`, `1.505`.
   */
  unitAmount: (n: number) => string;
  /** {@link unitAmount} with the currency code: `0.0125 PLN`. */
  unitMoney: (n: number, currency: string) => string;
  /** `−20.00`, `+12.00`, `0.00` — the sign spelled out, never carried by colour alone. */
  signedAmount: (n: number) => string;
  /**
   * {@link signedAmount} for a difference of unit prices: its significant
   * places, up to four, at least two — `−0.0001`, `+12.00` (issue #430).
   */
  signedUnitAmount: (n: number) => string;
  /** `−16.67 %`, `+10.00 %`, `0.00 %`. */
  signedPercent: (n: number) => string;
}

export function rfqNumberFormat(locale: string): RfqNumberFormat {
  const numbers = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amount = (n: number): string => numbers.format(n);
  const withSign = (n: number, magnitude: string): string => {
    if (n > 0) return `+${magnitude}`;
    if (n < 0) return `${MINUS}${magnitude}`;
    return magnitude;
  };
  const signed = (n: number): string => withSign(n, numbers.format(Math.abs(n)));
  const unitAmount = (n: number): string =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: Number.isFinite(n) ? unitPriceFractionDigits(n) : 2,
    }).format(n);
  return {
    amount,
    money: (n, currency) => `${amount(n)} ${currency}`,
    unitAmount,
    unitMoney: (n, currency) => `${unitAmount(n)} ${currency}`,
    signedAmount: signed,
    signedUnitAmount: (n) => withSign(n, unitAmount(Math.abs(n))),
    signedPercent: (n) => `${signed(n)} %`,
  };
}

/** {@link rfqNumberFormat} in the admin's current language, built once per language. */
export function useRfqNumberFormat(): RfqNumberFormat {
  const { language } = useTranslationContext();
  return useMemo(() => rfqNumberFormat(adminNumberLocale(language)), [language]);
}
