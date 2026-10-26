import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ComparisonService } from './comparison-service.js';
import { ComparableAttributeProjection } from './comparable-attribute-projection.js';
import { ComparisonProduct } from '../entities/comparison-product.entity.js';
import type { Comparison } from '../entities/comparison.entity.js';

/**
 * Feature 163, owner decision CMP-1 = A (2026-10-26) — a column whose product is not
 * available at the viewer's (channel, language) is the owner's history: the owner keeps
 * it with `available: false`; any other reader gets the `(removed product)` column —
 * no name, SKU, slug, price, image or compared value. The `[PG]` contract test is
 * `backend/test/contract/comparisons/share-unavailable-columns.test.ts`.
 */
const ON = '00000000-0000-4000-8000-000000000001';
const OFF = '00000000-0000-4000-8000-000000000002';
const CHANNEL = '00000000-0000-4000-8000-0000000000c1';

const product = (id: string, sku: string) => ({
  id,
  sku,
  name: { 'en-US': sku },
  slug: sku.toLowerCase(),
  type: 'simple',
  visibility: 'public',
  allowedOrganizationIds: [],
  attributeValues: { color: `${sku}-colour` },
  minOrderQuantity: null,
});

function service() {
  const em = {
    find: async (entity: unknown) =>
      entity === ComparisonProduct
        ? [ON, OFF].map((productId, position) => ({ comparisonId: 'cmp-1', productId, position, addedAt: new Date(position) }))
        : [],
    findOne: async (entity: unknown) =>
      entity === SalesChannel ? { id: CHANNEL, defaultCurrency: 'PLN', isPublic: true, defaultLanguage: 'en-US' } : null,
  };
  const catalogProducts = {
    findByIds: async () => [product(ON, 'ON-SKU'), product(OFF, 'OFF-SKU')],
    listValueOverridesByProductIds: async () => [],
  };
  const availability = {
    filterAvailable: vi.fn(async () => new Set([ON])),
    effectiveOrderRules: async () => new Map(),
  };
  const gallery = {
    baseImageUrls: async (ids: readonly string[]) => new Map(ids.map((id) => [id, `https://cdn.test/${id}.jpg`])),
  };
  const attributes = { listByFlag: async () => [{ key: 'color', label: { en: 'Colour' }, valueType: 'string' }] };
  const prices = {
    resolveListingPrices: async ({ products }: { products: Array<{ id: string }> }) =>
      new Map(products.map((p) => [p.id, { amount: '10.00', currency: 'PLN' }])),
  };
  return new ComparisonService(
    () => em as unknown as EntityManager,
    new ComparableAttributeProjection(),
    { generate: () => 'token' } as never,
    catalogProducts as never,
    availability as never,
    gallery as never,
    undefined,
    attributes as never,
    prices as never,
  );
}

const comparison = {
  id: 'cmp-1',
  shareToken: 'token',
  displayMode: 'all',
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as unknown as Comparison;

describe('ComparisonService.buildOwnerView — an unavailable column per reader (163 CMP-1)', () => {
  it('the owner keeps the unavailable column as it was, marked unavailable', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL, undefined, 'owner');
    const off = view.products.find((p) => p.id === OFF)!;
    expect(off).toMatchObject({ sku: 'OFF-SKU', available: false });
    expect(off.primaryAssetUrl).not.toBeNull();
  });

  it('any other reader gets the removed-product column, with no compared value', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL, undefined, 'recipient');
    const index = view.products.findIndex((p) => p.id === OFF);
    expect(view.products[index]).toMatchObject({
      sku: '',
      name: { en: '(removed product)' },
      slug: '',
      primaryAssetUrl: null,
      price: null,
      available: false,
    });
    for (const row of view.comparableAttributes) expect(row.values[index]).toBeNull();
    expect(view.products.find((p) => p.id === ON)).toMatchObject({ sku: 'ON-SKU', available: true });
    expect(view.hiddenProductCount).toBe(0);
  });

  it('a caller that does not say who is reading is answered as a recipient', async () => {
    const view = await service().buildOwnerView(comparison, CHANNEL);
    expect(view.products.find((p) => p.id === OFF)).toMatchObject({ sku: '', name: { en: '(removed product)' } });
  });
});
