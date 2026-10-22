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
  // `specs/154-sales-channel-access/` — the store refused the shopper rather
  // than the action (an assignment revoked mid-session, a session gone on a
  // closed store). Said in the page's language, as the sign-in page says it.
  if (err instanceof StorefrontApiError && err.code === 'SALES_CHANNEL_NOT_PERMITTED') {
    return tForLocale(locale ?? '')('auth.login.channelNotPermitted');
  }
  if (err instanceof StorefrontApiError && err.code === 'SALES_CHANNEL_SIGN_IN_REQUIRED') {
    return tForLocale(locale ?? '')('access.signInRequired');
  }
  if (err instanceof StorefrontApiError) return err.detail;
  // `tForLocale` answers an unknown locale in the catalogue's default.
  return tForLocale(locale ?? '')(key);
}
