/**
 * Where an anonymous visitor of a store closed to anonymous visitors is sent
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §2, FR-027).
 *
 * The backend refuses every catalogue, cart and content read of such a store
 * with `403 SALES_CHANNEL_SIGN_IN_REQUIRED` unless the caller is signed in. A
 * page rendered anyway would be a page of swallowed refusals — an empty shop
 * with no word of why — so the middleware decides first and sends the visitor
 * to the sign-in page, with the page they asked for kept in `next`.
 *
 * Pure, so the whole matrix is testable without a request.
 */

/** The `reason` the sign-in page reads to show the closed-store notice. */
export const SIGN_IN_REQUIRED_REASON = 'sign-in-required';

/**
 * The paths an anonymous visitor may still reach on a closed store: the pages
 * that let them become a signed-in customer, the pages an e-mail link lands on,
 * the storefront's own machinery, and the files a crawler or a browser asks for.
 *
 * Exact paths and prefixes are listed apart: `/login` covers `/login/mfa`, but
 * `/register` must not cover `/register-customer` — individual self-registration
 * signs the visitor in at once, which is a way in that a closed store does not
 * offer (spec Q2).
 */
const OPEN_EXACT: ReadonlySet<string> = new Set([
  '/register',
  '/session-expired',
  '/service-unavailable',
  '/offline',
  '/robots.txt',
  '/llms.txt',
  '/manifest.webmanifest',
  '/sitemap.xml',
  '/favicon.ico',
  // An e-mail link: confirming or withdrawing a newsletter subscription is the
  // recipient's right whether or not they can shop here. The backend routes
  // behind both are open for the same reason.
  '/newsletter/confirm',
  '/newsletter/unsubscribe',
]);

/** Each covers itself and everything under it. */
const OPEN_PREFIXES: readonly string[] = [
  '/login',
  '/password-reset',
  '/verify',
  '/invitations',
  '/auth',
  '/pwa',
  '/_next',
  // Route handlers, not pages: the backend's cache-revalidation call has no
  // session and must not be answered with a sign-in page.
  '/api',
];

/** Whether an anonymous visitor may reach `pathname` on a store closed to them. */
export function isOpenOnClosedStore(pathname: string): boolean {
  if (OPEN_EXACT.has(pathname)) return true;
  return OPEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export interface ClosedStoreInput {
  readonly pathname: string;
  /** The query string, with its `?`, or `''`. */
  readonly search: string;
  /** Whether the request carries a `b2b_session` cookie. */
  readonly hasSession: boolean;
  /**
   * The channel's flag, or `null` when it could not be read. Unknown is not
   * closed: the backend refuses on its own, and a storefront that could not ask
   * must not lock every visitor out of an open store.
   */
  readonly anonymousAccess: boolean | null;
}

/** The sign-in address to redirect to, or `null` when the request goes through. */
export function closedStoreRedirect(input: ClosedStoreInput): string | null {
  if (input.anonymousAccess !== false) return null;
  if (input.hasSession) return null;
  if (isOpenOnClosedStore(input.pathname)) return null;
  const next = `${input.pathname}${input.search}`;
  return `/login?next=${encodeURIComponent(next)}&reason=${SIGN_IN_REQUIRED_REASON}`;
}
