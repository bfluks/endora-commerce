import { describe, expect, it } from 'vitest';
import type { AdminProductVisibilityPort } from '@endora-commerce/contracts';
import { createCatalogAdminProductVisibility, SYSTEM_PRODUCT_SCOPE } from './admin-product-visibility.js';

/**
 * Spec 193 (T037, FR-036, Principle XVII) — `product_visibility_rules` absent from the composition:
 * the catalog's wiring never resolves its port. Every scope is the system's and no predicate is
 * asked for, so the lists answer exactly what a composition without the module answers (the
 * `Cache-Control: private, no-store` header is set by the routes whatever this says).
 */
describe('catalog admin product visibility — owner absent from the composition', () => {
  const unresolvable = (): AdminProductVisibilityPort => {
    throw new Error('adminProductVisibilityPort is not composed');
  };
  const visibility = createCatalogAdminProductVisibility({ isPresent: () => false, port: unresolvable });

  it('reads every administrator as the system, without resolving the port', async () => {
    expect(await visibility.scopeFor('00000000-0000-4000-8000-000000000001')).toBe(SYSTEM_PRODUCT_SCOPE);
  });

  it('asks no predicate and filters nothing for the system scope', async () => {
    expect(visibility.productPredicate(SYSTEM_PRODUCT_SCOPE, { productId: '"p"."id"' })).toEqual({ kind: 'none' });
    expect(visibility.variantPredicate(SYSTEM_PRODUCT_SCOPE, { variantId: '"v"."id"' })).toEqual({ kind: 'none' });
    const all = await visibility.filterVisible(SYSTEM_PRODUCT_SCOPE, { productIds: ['a'], variantIds: ['b'] });
    expect([...all.productIds, ...all.variantIds]).toEqual(['a', 'b']);
  });

  it('present and failing, the failure is not caught (TM-3 (4))', async () => {
    const failing = createCatalogAdminProductVisibility({ isPresent: () => true, port: unresolvable });
    await expect(failing.scopeFor('x')).rejects.toThrow(/not composed/);
  });
});
