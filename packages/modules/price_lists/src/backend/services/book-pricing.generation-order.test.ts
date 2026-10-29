import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PricingCache, type ProfilePricingCacheKey } from './pricing-cache.js';
import { BookPricing, type CachedBookLine } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';

/**
 * Review finding 6 (release 0.108.0) — `pricing-cache.ts` requires a
 * resolution to read the cache generation **before its first statement**, so
 * an answer that straddled an invalidation is dropped rather than stored.
 * `BookPricing.resolve` read it after the channel, the precedence and the
 * profile: a draftify committing in between was cached under the new
 * generation with the pre-write profile, and served for the whole TTL.
 */
describe('BookPricing — the generation is read before the first statement', () => {
  function engine() {
    const state = { saleLive: true, interleave: null as null | (() => void) };
    const base = { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true, member_organization_id: null, member_customer_group_id: null };
    const sale = { id: 'sale', name: 'Sale', type: 'sale', audience_kind: 'everyone', priority: 0, is_system: false, member_organization_id: null, member_customer_group_id: null };
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        if (sql.includes('price_list_audience_members')) {
          // The profile is read with the sale still live; the write commits
          // (and invalidates) before the resolution goes on.
          const books = state.saleLive ? [base, sale] : [base];
          state.interleave?.();
          state.interleave = null;
          return books;
        }
        const ids = String(params[0] ?? '');
        return [
          { id: 'r-base', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
          { id: 'r-sale', price_list_id: 'sale', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '80.0000', percent: null },
        ].filter((r) => ids.includes(r.price_list_id));
      },
    } as unknown as EntityManager;
    const cache = new PricingCache<CachedBookLine, ProfilePricingCacheKey>({ ttlMs: 60_000 });
    const profileMemo = new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 });
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({ listVariantsByProductIds: async () => [] }),
      productDisplayModes: async () => new Map(),
      viewerDisplayMode: async () => 'gross_only',
      cache,
      profileMemo,
    });
    const draftifySale = () => {
      state.saleLive = false;
      cache.invalidateAll();
      profileMemo.invalidateAll();
      books.invalidateAll();
    };
    const ask = async () =>
      (
        await books.resolve([{ key: 'k', product: { id: 'p1', attributeValues: {} }, quantity: 1 }], {
          organizationId: null,
          customerGroupId: null,
          signedIn: false,
          salesChannelId: 'ch',
          currencyCode: 'PLN',
        })
      ).get('k')?.resolution.price?.amount;
    return { ask, state, draftifySale };
  }

  it('a write committing while the profile is read is not cached under the new generation', async () => {
    const { ask, state, draftifySale } = engine();
    state.interleave = draftifySale;
    // What the database said when it asked: the sale was live.
    expect(await ask()).toBe('80.0000');
    // The next request must not be served that answer from the cache.
    expect(await ask()).toBe('100.0000');
  });

  it('without an interleaving the answer is cached as before', async () => {
    const { ask, state } = engine();
    expect(await ask()).toBe('80.0000');
    state.saleLive = false;
    // No invalidation was announced, so the cached answer stands (the TTL bounds it).
    expect(await ask()).toBe('80.0000');
  });
});
