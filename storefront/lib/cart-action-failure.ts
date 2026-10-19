import { StorefrontApiError } from './api/client';
import { tForLocale } from './i18n/messages';

/**
 * What a product page's cart or one-click action — or the cart page's
 * submit-for-approval (feature 155) — tells the shopper when it fails
 * (issue #249).
 *
 * A refusal the backend worded is passed through as it always was. Anything
 * else — the backend unreachable, a bug — gets the catalogue's sentence in the
 * request's language; these fallbacks used to be literals, two in Polish and
 * three in English, so a failure read in whichever language its line was
 * written in.
 */
export function cartActionFailure(
  err: unknown,
  locale: string | undefined,
  key: 'product.addToCartFailed' | 'product.oneClickFailed' | 'cart.submitForApprovalFailed',
): string {
  if (err instanceof StorefrontApiError) return err.detail;
  // `tForLocale` answers an unknown locale in the catalogue's default.
  return tForLocale(locale ?? '')(key);
}
