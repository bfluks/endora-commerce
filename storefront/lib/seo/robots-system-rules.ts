import { absoluteUrl } from './site-url';

/**
 * What a crawler may fetch (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-011).
 *
 * The disallow list is the **route-group** answer, one prefix per family of
 * pages that must not be indexed, and it is deliberately a coarse mirror of the
 * per-route `robots: { index: false }` declarations rather than a second
 * statement of them: `robots.txt` governs *fetching*, page metadata governs
 * *indexing*, and the two are different instruments. The per-route declaration
 * is the one `check:storefront-indexability` reads; this file keeps a crawler
 * from spending its budget on 48 pages it will be told not to index anyway.
 *
 * `/api/` is here because `storefront/app/api/` holds five route handlers that
 * emit no document at all.
 *
 * ## These are the system-generated rules, and they are this storefront's
 *
 * Until `specs/144-seo-search-engine-robots/` this list was `app/robots.ts`, a
 * `MetadataRoute.Robots` object Next rendered and prerendered. It moved here,
 * unchanged, because `robots.txt` now also carries a sales channel's custom
 * instructions after these rules, and a structured object can carry neither an
 * operator's text as written nor a `503`. `app/robots.txt/route.ts` serves the
 * file; this module stays the single statement of what the storefront itself
 * closes.
 *
 * An operator can add to what follows these rules and can never edit or
 * remove them: they mirror this storefront's route tree, which is not
 * configuration. An instance that serves different routes edits this list.
 */
export const ROBOTS_SYSTEM_RULES = {
  userAgent: '*',
  allow: '/',
  disallow: [
    '/api/',
    '/account',
    '/addresses',
    '/orders',
    '/organization',
    '/preferences',
    '/quick-order',
    '/quote-request',
    '/quote-requests',
    '/returns',
    '/shopping-lists',
    '/newsletter',
    '/compare',
    '/cart',
    '/checkout',
    '/login',
    '/register',
    '/register-customer',
    '/password-reset',
    '/verify',
    '/auth/',
    '/invitations/',
    '/offline',
  ],
} as const satisfies {
  readonly userAgent: string;
  readonly allow: string;
  readonly disallow: readonly string[];
};

/** The sitemap the rules point a crawler at: this deployment's own. */
export function robotsSitemapUrl(): string {
  return absoluteUrl('/sitemap.xml');
}

/**
 * The rules as `robots.txt` text.
 *
 * Line for line what Next rendered from the structured object — the same
 * `User-Agent`, `Allow` and `Disallow` lines in the same order, a blank line,
 * the `Sitemap:` line, one trailing line break — so that an instance nobody
 * configured serves the file it served before. `test/seo/robots-system-rules.test.ts`
 * holds this against a capture of that file.
 */
export function renderRobotsSystemRules(): string {
  return [
    `User-Agent: ${ROBOTS_SYSTEM_RULES.userAgent}`,
    `Allow: ${ROBOTS_SYSTEM_RULES.allow}`,
    ...ROBOTS_SYSTEM_RULES.disallow.map((prefix) => `Disallow: ${prefix}`),
    '',
    `Sitemap: ${robotsSitemapUrl()}`,
    '',
  ].join('\n');
}

/**
 * The whole `robots.txt` of a store closed to anonymous visitors
 * (`specs/154-sales-channel-access/`).
 *
 * Every page of such a store answers an anonymous visitor — a crawler is one —
 * with the sign-in page, so there is nothing to fetch and nothing to list: one
 * group closing everything to every crawler, and no `Sitemap:` line, because
 * the sitemap of a closed store is empty. It replaces the rules above rather
 * than adding to them, and nothing an operator writes is joined to it: a group
 * written for one crawler would replace `Disallow: /` for that crawler.
 *
 * Spelled as {@link renderRobotsSystemRules} spells its group.
 */
export function renderClosedStoreRobotsTxt(): string {
  return [`User-Agent: ${ROBOTS_SYSTEM_RULES.userAgent}`, 'Disallow: /', ''].join('\n');
}
