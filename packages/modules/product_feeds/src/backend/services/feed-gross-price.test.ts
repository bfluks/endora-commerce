import { describe, expect, it } from 'vitest';
import type { CatalogProductRecord } from '@endora-commerce/contracts';
import { FeedGenerationService, type FeedItemHydrationScope } from './feed-generation.service.js';

/**
 * Review 2, finding 2 (release 0.108.0) — gross is the default feed
 * presentation, and it was `Math.round(net * (1 + rate / 100) * 100) / 100` on
 * doubles: 29.50 × 1.23 is the double 36.28499…, so the feed published 36.28
 * where the price is 36.29. A gross price is now the exact decimal product,
 * rounded half-up (`grossAmountHalfUp`); `specs/pricing/worked-examples.md`
 * §10.16 G1–G4.
 */
const PRODUCTS: Record<string, { net: string; rate: number; gross: string }> = {
  g1: { net: '29.5000', rate: 23, gross: '36.29' },
  g2: { net: '4.3000', rate: 5, gross: '4.52' },
  g3: { net: '31.5000', rate: 23, gross: '38.75' },
  g4: { net: '16.5000', rate: 23, gross: '20.30' },
};

function generation(): FeedGenerationService {
  const products = Object.keys(PRODUCTS).map(
    (id) => ({ id, slug: id, type: id, name: { 'pl-PL': id }, description: {}, attributeValues: {} }) as unknown as CatalogProductRecord,
  );
  return new FeedGenerationService({
    catalogProducts: { findByIds: async () => products, listVariantsByProductIds: async () => [] },
    catalogCategories: { listAssignmentsForProducts: async () => [], findByIds: async () => [] },
    catalogGallery: { listForProducts: async () => [] },
    catalogUrlKeys: { effectiveKeys: async () => new Map() },
    resolvePublicImageUrls: async () => new Map(),
    resolveAvailability: async () => new Map(),
    resolveAnonymousPrice: async () =>
      new Map(Object.entries(PRODUCTS).map(([id, p]) => [id, { amount: p.net, isSale: false }])),
    resolveTaxRate: async ({ productType }: { productType: string }) => PRODUCTS[productType]!.rate,
  } as never);
}

const scope = (pricePresentation: 'gross' | 'net'): FeedItemHydrationScope => ({
  salesChannelId: 'channel-1',
  channelDefaultCurrency: 'PLN',
  taxonomy: null,
  itemGranularity: 'product',
  context: {
    languageCode: 'pl-PL',
    languageFallbacks: [],
    currencyCode: 'PLN',
    pricePresentation,
    taxCountry: 'PL',
    storefrontOrigin: 'https://shop.example.com',
    // Feature 167 — the channel's URL-language facts: links carry the language prefix.
    channelUrl: { languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL', prefixDefaultLanguage: true },
    salesChannelId: 'channel-1',
    priceListId: null,
  },
});

describe('a gross feed price is the exact decimal product, rounded half-up', () => {
  it.each(Object.entries(PRODUCTS))('%s: %o', async (id, expected) => {
    const items = await generation().hydrateItems(Object.keys(PRODUCTS), scope('gross'));
    const item = items.find((i) => i.productId === id)!;
    expect(item.price?.gross).toBe(expected.gross);
    expect(item.price?.taxResolved).toBe(true);
  });
});
