import { describe, expect, it } from 'vitest';
import { marksSitemapStale } from './sitemap-staleness.js';

/**
 * Feature 163 (checkpoint C security review, S-W1) — every `product.updated.v1` field
 * that changes what an anonymous crawler may open marks the cached sitemaps stale:
 * the scoped values, and the **global** status, the archive and the global audience
 * (visibility and its organization list), which decide availability as much as the
 * scoped ones do.
 */
describe('marksSitemapStale', () => {
  it.each([
    'scopedStatus',
    'publicationWindow',
    'audience',
    'urlKeys',
    'status',
    'archivedAt',
    'visibility',
    'allowedOrganizationIds',
  ])('%s marks the sitemaps stale', (field) => {
    expect(marksSitemapStale(['name', field])).toBe(true);
  });

  it.each([['name'], ['description', 'attributeValues'], ['minOrderQuantity', 'returnable'], ['sku']])(
    'a change that alters no listed URL (%s) does not',
    (...fields) => {
      expect(marksSitemapStale(fields)).toBe(false);
    },
  );

  it('an event with no changedFields does not', () => {
    expect(marksSitemapStale(undefined)).toBe(false);
  });
});
