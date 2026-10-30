import type { ReactNode } from 'react';
import { verifyEmail } from '../../../lib/api/auth';
import { StorefrontApiError } from '../../../lib/api/client';
import type { Metadata } from 'next';
import { LocalizedLink } from '../../../lib/i18n/localized-link';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Email verification landing (T153). The registration mail links to
 * `/verify?token=...`; the page server-side calls the verify endpoint and
 * renders success/failure with no client JS.
 */

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return (
      <div className="b2b-auth">
        <h1>Verification link missing</h1>
        <p className="b2b-auth__error">
          This page expects a <code>?token=</code> query parameter from your verification email.
        </p>
      </div>
    );
  }

  let success = false;
  let error: string | null = null;
  try {
    await verifyEmail(token);
    success = true;
  } catch (err) {
    error = err instanceof StorefrontApiError ? err.detail : 'Verification failed.';
  }

  return (
    <div className="b2b-auth">
      <h1>Email verification</h1>
      {success ? (
        <>
          <p className="b2b-auth__success">Your email is verified.</p>
          <p>
            <LocalizedLink href="/login">Sign in to continue</LocalizedLink>.
          </p>
        </>
      ) : (
        <>
          <p className="b2b-auth__error">{error}</p>
          <p className="b2b-auth__hint">
            Need a new link? <LocalizedLink href="/register">Register again</LocalizedLink> or contact support.
          </p>
        </>
      )}
    </div>
  );
}
