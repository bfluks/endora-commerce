import { StorefrontApiError } from '../api/client';
import { tForLocale } from '../i18n/messages';

/**
 * How a refused sign-in reaches the sign-in page
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §3).
 *
 * The sign-in screens carry their error in `?error=`. Most refusals arrive
 * there as the backend's own sentence, as they always have. A refusal because
 * the account's Organization may not use this store is different: it can come
 * from three places — the password step, the second factor and the federated
 * callback, which the backend redirects with
 * `?error=sales_channel_not_permitted` — and it has to read the same, in the
 * page's language, from all three. So it travels as that stable code and is
 * translated where it is shown.
 */

/** The `?error=` value of a sign-in the store refused. The federated callback uses it too. */
export const CHANNEL_NOT_PERMITTED_ERROR = 'sales_channel_not_permitted';

/**
 * The `?error=` value of a federated sign-up the store refused: no account
 * exists yet and the store is closed to anonymous visitors, so none is created.
 */
export const CHANNEL_SIGN_IN_REQUIRED_ERROR = 'sales_channel_sign_in_required';

/** The `?error=` value for a failed sign-in step: the stable code, or the refusal's own sentence. */
export function signInErrorParam(err: unknown, fallback: string): string {
  if (!(err instanceof StorefrontApiError)) return fallback;
  if (err.code === 'SALES_CHANNEL_NOT_PERMITTED') return CHANNEL_NOT_PERMITTED_ERROR;
  return err.detail;
}

/** What the sign-in screens show for `?error=`: the code translated, anything else as given. */
export function signInErrorMessage(error: string | undefined, locale: string): string | undefined {
  if (error === undefined || error === '') return undefined;
  if (error === CHANNEL_NOT_PERMITTED_ERROR) return tForLocale(locale)('auth.login.channelNotPermitted');
  if (error === CHANNEL_SIGN_IN_REQUIRED_ERROR) return tForLocale(locale)('auth.login.signInRequired');
  return error;
}
