import type { ReactNode } from 'react';
import { requestPasswordReset } from '../../../../lib/api/auth';
import { StorefrontApiError } from '../../../../lib/api/client';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Password-reset request page (T152). Backend always replies 202 to defend
 * against account enumeration, so we render the same acknowledgement
 * regardless of whether the email matched a real account.
 */

export default async function PasswordResetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; email?: string; error?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  if (params.status === 'sent') {
    return (
      <div className="b2b-auth">
        <h1>Check your inbox</h1>
        <p className="b2b-auth__success">
          If <strong>{params.email}</strong> matches an account, we just emailed a reset link.
        </p>
        <p className="b2b-auth__hint">
          The link expires in 24 hours. <LocalizedLink href="/login">Back to sign-in</LocalizedLink>.
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth">
      <h1>Reset your password</h1>
      <p>Enter your account email — we&apos;ll send a reset link if it matches.</p>
      {params.error ? <div className="b2b-auth__error">{params.error}</div> : null}
      <form action={requestAction} className="b2b-auth__form">
        <div className="b2b-auth__field">
          <label htmlFor="reset-email">Email</label>
          <input id="reset-email" name="email" type="email" required autoComplete="email" placeholder=" " />
        </div>
        <div className="b2b-auth__actions">
          <button type="submit">Send reset link</button>
        </div>
      </form>
      <p className="b2b-auth__hint">
        Remembered it? <LocalizedLink href="/login">Sign in</LocalizedLink>.
      </p>
    </div>
  );
}

async function requestAction(formData: FormData): Promise<void> {
  'use server';
  const email = ((formData.get('email') as string) ?? '').trim();
  // Swallow errors — the backend's 202 + this page's identical UI are what
  // defends against account enumeration. The one exception is the request
  // limit: it is counted per address whether or not an account has it, so
  // saying "wait" reveals nothing, and saying "check your inbox" would promise
  // an e-mail that was not sent.
  let throttled: string | null = null;
  try {
    await requestPasswordReset(email);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.code === 'CUSTOMER_AUTHENTICATION_THROTTLED') {
      throttled = err.detail;
    }
  }
  if (throttled !== null) {
    return await localeRedirect(`/password-reset/request?error=${encodeURIComponent(throttled)}`);
  }
  return await localeRedirect(`/password-reset/request?status=sent&email=${encodeURIComponent(email)}`);
}
