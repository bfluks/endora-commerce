/**
 * Feature 163 (R10; checkpoint C security review, S-W1) — the `product.updated.v1`
 * fields that change what a sitemap lists, i.e. what an anonymous crawler may open
 * now: the scoped status, the publication window (the catalogue's window sweep emits
 * `publicationWindow` for every bound it crosses), the channel audience and the URL
 * keys, and the global status, archive and audience (`visibility`,
 * `allowedOrganizationIds`), which decide availability as much as the scoped values.
 * `product.archived.v1` marks them stale too (subscribed beside this).
 */
export const SITEMAP_PRODUCT_FIELDS: ReadonlySet<string> = new Set([
  'scopedStatus',
  'publicationWindow',
  'audience',
  'urlKeys',
  'status',
  'archivedAt',
  'visibility',
  'allowedOrganizationIds',
]);

/** Whether a `product.updated.v1` with these `changedFields` makes the cached sitemaps stale. */
export function marksSitemapStale(changedFields: readonly string[] | undefined): boolean {
  return changedFields?.some((field) => SITEMAP_PRODUCT_FIELDS.has(field)) ?? false;
}
