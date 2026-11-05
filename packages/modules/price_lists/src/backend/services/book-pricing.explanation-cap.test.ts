import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PRICE_BOOK_MAX_EXPLANATION_CANDIDATES, type DisplayMode } from '@endora-commerce/contracts';
import { PricingCache, type ProfilePricingCacheKey } from './pricing-cache.js';
import { BookPricing, type BookPricingViewer, type CachedBookLine, type ViewerModeKey } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';

/**
 * Review 3 of release 0.108.0, B1 — the explainer needs every runner-up, so
 * the resolver stopped capping them; but every resolution was then stored in
 * the shared answer cache with its full runner-up list, the listing, cart and
 * surface-build resolutions included. The full list is now built only when an
 * explanation is asked for, and such a resolution neither reads nor writes the
 * cache: a cached line carries the ten it always carried, and the explainer
 * still sees every candidate.
 */
describe('BookPricing — the full runner-up list is built for an explanation only', () => {
  const BOOKS = 14;

  function engine() {
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        const header = (id: string, isSystem: boolean, priority: number) => ({
          id,
          name: id,
          type: 'regular',
          audience_kind: 'everyone',
          priority,
          is_system: isSystem,
          member_organization_id: null,
          member_customer_group_id: null,
        });
        const everyone = Array.from({ length: BOOKS }, (_, i) => header(`book-${i}`, false, 100 - i));
        if (sql.includes('price_list_audience_members')) return [header('base', true, 0), ...everyone];
        const row = (id: string, bookId: string, amount: string) => ({
          id,
          price_list_id: bookId,
          variant_id: null,
          product_id: 'p1',
          category_id: null,
          attribute_key: null,
          attribute_value: null,
          min_quantity: 1,
          max_quantity: null,
          price_type: 'fixed',
          amount,
          percent: null,
        });
        return [row('r-base', 'base', '100.0000'), ...everyone.map((b, i) => row(`r-${i}`, b.id, `${50 + i}.0000`))];
      },
    } as unknown as EntityManager;
    const cache = new PricingCache<CachedBookLine, ProfilePricingCacheKey>({ ttlMs: 60_000 });
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({ listVariantsByProductIds: async () => [] }),
      productDisplayModes: async () => new Map(),
      viewerDisplayMode: async () => 'gross_only' as DisplayMode,
      cache,
      viewerModeMemo: new PricingCache<DisplayMode, ViewerModeKey>({ ttlMs: 60_000 }),
      profileMemo: new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 }),
    });
    const guest: BookPricingViewer = { organizationId: null, customerGroupId: null, signedIn: false, salesChannelId: 'ch', currencyCode: 'PLN' };
    const line = [{ key: 'k', product: { id: 'p1', attributeValues: {} }, quantity: 1 }];
    const cached = async () => {
      const profiles = await books.profilesFor(guest);
      return cache.get({ profileKey: profiles!.buyer.key, productId: 'p1', variantId: null, quantity: 1 });
    };
    return { books, guest, line, cached };
  }

  it('an ordinary resolution caches its line with at most the capped runner-ups', async () => {
    const { books, guest, line, cached } = engine();
    const answer = (await books.resolve(line, guest)).get('k');
    expect(answer?.resolution.price?.amount).toBe('50.0000');
    expect(answer?.resolution.explanation.candidates).toHaveLength(PRICE_BOOK_MAX_EXPLANATION_CANDIDATES);
    expect((await cached())?.resolution.explanation.candidates).toHaveLength(PRICE_BOOK_MAX_EXPLANATION_CANDIDATES);
  });

  it('an explanation lists every candidate even over a cached line, and caches nothing of its own', async () => {
    const { books, guest, line, cached } = engine();
    await books.resolve(line, guest);
    const explained = (await books.resolve(line, guest, undefined, undefined, { explain: true })).get('k');
    expect(explained?.resolution.explanation.candidates).toHaveLength(BOOKS);
    expect((await cached())?.resolution.explanation.candidates).toHaveLength(PRICE_BOOK_MAX_EXPLANATION_CANDIDATES);
  });

  it('an explanation asked first leaves no full list in the cache', async () => {
    const { books, guest, line, cached } = engine();
    await books.resolve(line, guest, undefined, undefined, { explain: true });
    expect(await cached()).toBeUndefined();
  });
});
