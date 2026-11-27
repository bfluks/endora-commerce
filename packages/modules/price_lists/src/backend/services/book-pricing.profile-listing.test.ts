import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { BookPricing } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';

/**
 * Issue #416 — the price surface's worker resolves a whole profile (50 000
 * products for the everyone profile and for every all-products buyer) and
 * stores amounts only: no display mode. Profiled on the SC-005 fixture at 201
 * profiles, the display-mode chain cost 18.9 s of a 262.7 s whole build — read
 * for every chunk and thrown away. `resolveProfileListing` is the listing
 * resolution of a fixed profile without it: the same resolutions as
 * `resolveListing`, no display-mode read while no product or category override
 * is `none` (issue #491: `book-pricing.withheld.test.ts` covers the case where
 * one is).
 */
describe('BookPricing.resolveProfileListing — the surface worker’s resolution', () => {
  function engine() {
    const reads = { productModes: 0, viewerModes: 0 };
    const rows = [
      { id: 'r-base-p1', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
      { id: 'r-base-p2', price_list_id: 'base', variant_id: null, product_id: 'p2', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '50.0000', percent: null },
      { id: 'r-base-v1', price_list_id: 'base', variant_id: 'v1', product_id: 'p2', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '40.0000', percent: null },
      { id: 'r-base-v2', price_list_id: 'base', variant_id: 'v2', product_id: 'p2', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '70.0000', percent: null },
      { id: 'r-org', price_list_id: 'org', variant_id: null, product_id: null, category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'percent', amount: null, percent: '-10.00' },
    ];
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        if (sql.includes('from "price_lists" l')) {
          return [
            { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true },
            { id: 'org', name: 'Org', type: 'regular', audience_kind: 'organizations', priority: 0, is_system: false },
          ];
        }
        if (sql.includes('price_list_matrix_entries')) return rows;
        return [];
      },
    } as unknown as EntityManager;
    const variants = [
      { id: 'v1', parentProductId: 'p2', sku: 'p2-a', variantAttributeValues: {} },
      { id: 'v2', parentProductId: 'p2', sku: 'p2-b', variantAttributeValues: {} },
    ];
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({
        listVariantsByProductIds: async (ids: readonly string[]) => variants.filter((v) => ids.includes(v.parentProductId)) as never,
      }),
      productDisplayModes: async () => {
        reads.productModes += 1;
        return new Map();
      },
      // Issue #491 — no product or category override is `none`, so the
      // product step cannot withhold anything and is not read.
      anyProductStepWithholds: async () => false,
      viewerDisplayMode: async () => {
        reads.viewerModes += 1;
        return 'gross_only';
      },
    });
    return { books, reads };
  }

  const products = [
    { id: 'p1', attributeValues: {} },
    { id: 'p2', attributeValues: {} },
    { id: 'p3', attributeValues: {} },
  ];

  it('answers what resolveListing answers for the profile, and reads no display mode', async () => {
    const { books, reads } = engine();
    const profile = await books.profileFromVector({
      channelId: 'ch',
      currencyCode: 'PLN',
      precedenceVersion: 1,
      vector: [{ bookId: 'org', audienceKind: 'organizations', depth: 0 }],
    });
    const viewer = { organizationId: null, customerGroupId: null, signedIn: false, salesChannelId: 'ch', currencyCode: 'PLN' };

    const amounts = await books.resolveProfileListing(products, profile);
    expect(reads).toEqual({ productModes: 0, viewerModes: 0 });

    const listed = await books.resolveListing(products, viewer, profile);
    for (const p of products) {
      expect(amounts.get(p.id)?.resolution?.price ?? null, p.id).toEqual(listed.get(p.id)?.answer?.resolution.price ?? null);
      expect(amounts.get(p.id)?.maxAmount ?? null, p.id).toEqual(listed.get(p.id)?.maxAmount ?? null);
    }
    // The −10 % buyer row over the base: p1 90, p2 ranged over its variants 36–63, p3 unpriced.
    expect(amounts.get('p1')?.resolution?.price?.amount).toBe('90.0000');
    expect(amounts.get('p2')?.resolution?.price?.amount).toBe('36.0000');
    expect(amounts.get('p2')?.maxAmount).toBe('63.0000');
    expect(amounts.get('p3')?.resolution?.price ?? null).toBeNull();
  });
});
