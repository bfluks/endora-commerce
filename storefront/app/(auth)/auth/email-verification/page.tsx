import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Older verification mails linked here; canonical landing is `/verify?token=`.
 */
export default async function LegacyEmailVerificationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const token = params.token;
  if (token) {
    return await localeRedirect(`/verify?token=${encodeURIComponent(token)}`);
  }
  return await localeRedirect('/verify');
}
