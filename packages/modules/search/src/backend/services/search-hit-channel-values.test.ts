import { describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  type CatalogProductAvailabilityPort,
  type CatalogProductReadPort,
  type CatalogProductUrlKeyReadPort,
  type ListingPriceDetailPort,
} from '@endora-commerce/contracts';
import { SearchQueryService, type ResolvedSearchChannel } from './search-query.service.js';

/**
 * Feature 163 — a search result card carries the product's values **in the request's
 * channel and language**, as the catalogue's listing card does:
 *
 * - T113a (FR-071, R28): its `slug` is the effective URL key at (channel, L) — the
 *   channel × language key, else the language key, else the global key — so the
 *   storefront link resolves where the product has a key of its own (with `seo` off
 *   too: the global `slug` 404s in a language that has its own key);
 * - T085 (FR-100): its `minOrderQuantity` is the channel's.
 *
 * `hydrateHits` is the post-Meilisearch step of `listProducts`; no search engine.
 */

const CHANNEL: ResolvedSearchChannel = {
  id: '00000000-0000-4000-8000-0000000000c1',
  code: 'pl_retail',
 
  defaultCurrency: 'PLN',
  defaultLanguage: 'pl-PL',
  languages: ['pl-PL', 'de-DE'],
};

function product(id: string, minOrderQuantity: number | null = null) {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `global-${id}`,
    type: 'simple' as const,
    status: 'active' as const,
    name: { 'pl-PL': `Produkt ${id}` },
    description: {},
    visibility: 'public' as const,
    allowedOrganizationIds: [],
    attributeValues: {},
    minOrderQuantity,
    returnable: false,
  };
}

const hit = (id: string) => ({
  id,
  sku: `SKU-${id}`,
  slug: `global-${id}`,
  type: 'simple' as const,
  name: 'Indexed',
  categorySlugs: [],
  primaryAssetUrl: null,
});

function serviceWith(options: {
  products: ReturnType<typeof product>[];
  keys: Record<string, Record<string, string>>;
  minimums?: Record<string, number | null>;
}) {
  const port = {
    findByIds: async (ids: readonly string[]) => options.products.filter((p) => ids.includes(p.id)),
    listValueOverridesByProductIds: async () => [],
  } as unknown as CatalogProductReadPort;
  const effectiveKeys = vi.fn(async (ids: readonly string[], channelId: string) => {
    expect(channelId).toBe(CHANNEL.id);
    return new Map(
      ids.flatMap((id) => (options.keys[id] ? [[id, new Map(Object.entries(options.keys[id]!))] as const] : [])),
    );
  });
  const availability: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveOrderRules'> = {
    filterAvailable: async (ids) => new Set(ids),
    effectiveOrderRules: async (ids) =>
      new Map(
        ids.map((id) => {
          const p = options.products.find((candidate) => candidate.id === id)!;
          const minOrderQuantity = options.minimums && id in options.minimums ? options.minimums[id]! : p.minOrderQuantity;
          return [id, { minOrderQuantity, returnable: p.returnable }] as const;
        }),
      ),
  };
  const urlKeys: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'> = { effectiveKeys };
  return {
    // The channel's values are this file's subject, not prices: the pricing port resolves nothing.
    service: new SearchQueryService(
      port,
      undefined,
      {},
      { resolveListingPriceDetails: async () => new Map() } as unknown as ListingPriceDetailPort,
      undefined,
      availability,
      urlKeys,
    ),
    effectiveKeys,
  };
}

const ctx = (preferredLanguage?: string) => ({
  resolvedChannel: CHANNEL,
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
  preferredLanguage,
});

describe('search hits carry the channel’s values (spec 163)', () => {
  it('T113a: the slug is the effective key in the request language, in one read for the page', async () => {
    const { service, effectiveKeys } = serviceWith({
      products: [product('p1'), product('p2')],
      keys: { p1: { 'pl-PL': 'wiertarka', 'de-DE': 'bohrmaschine' }, p2: { 'pl-PL': 'global-p2', 'de-DE': 'global-p2' } },
    });
    const german = await service.hydrateHits([hit('p1'), hit('p2')], ctx('de-DE'));
    expect(german.map((card) => card.slug)).toEqual(['bohrmaschine', 'global-p2']);
    const polish = await service.hydrateHits([hit('p1')], ctx('pl'));
    expect(polish[0]?.slug).toBe('wiertarka');
    expect(effectiveKeys).toHaveBeenCalledTimes(2);
  });

  it('T113a: a product with no key answer keeps its global slug', async () => {
    const { service } = serviceWith({ products: [product('p1')], keys: {} });
    expect((await service.hydrateHits([hit('p1')], ctx('de-DE')))[0]?.slug).toBe('global-p1');
  });

  it('T085: the minimum is the channel’s', async () => {
    const { service } = serviceWith({ products: [product('p1', 10), product('p2')], keys: {}, minimums: { p1: 1, p2: 5 } });
    const cards = await service.hydrateHits([hit('p1'), hit('p2')], ctx('pl-PL'));
    expect(cards.map((card) => card.minOrderQuantity)).toEqual([1, 5]);
  });
});
