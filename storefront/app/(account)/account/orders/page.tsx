import type { Metadata } from 'next';
import { localeRedirect } from '../../../../lib/i18n/navigation';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Legacy `/account/orders` location. The orders list now lives at `/orders`
 * (alongside the single order view); keep this path working for existing
 * links, bookmarks, and post-checkout redirects.
 */
export default async function AccountOrdersRedirect(): Promise<never> {
  return await localeRedirect('/orders');
}
