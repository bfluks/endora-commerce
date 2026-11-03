import { describe, expect, it } from 'vitest';
import { productCacheTags } from '../../lib/api/catalog';

/**
 * Feature 163 (checkpoint E security review, I4) — a product read's cache tags carry
 * the URL-derived key only while the tag fits Next's 256-character limit; a longer
 * key (anyone can open `/p/<anything>`) keeps the shared `catalog:product` tag alone
 * rather than a tag Next would drop.
 */
describe('productCacheTags', () => {
  it('tags a read with the shared tag and the key', () => {
    expect(productCacheTags('wiertarka')).toEqual(['catalog:product', 'catalog:product:wiertarka']);
  });

  it('never emits a tag over 256 characters', () => {
    const tags = productCacheTags('k'.repeat(400));
    expect(tags).toEqual(['catalog:product']);
    expect(productCacheTags('k'.repeat(256 - 'catalog:product:'.length))).toHaveLength(2);
    expect(productCacheTags('k'.repeat(257 - 'catalog:product:'.length))).toHaveLength(1);
  });

  it('can name another shared tag', () => {
    expect(productCacheTags('drill', 'catalog:links')).toEqual(['catalog:links', 'catalog:product:drill']);
  });
});
