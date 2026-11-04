import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode } from '@endora-commerce/contracts';
import { PricingCache, type ProfilePricingCacheKey } from './pricing-cache.js';
import { BookPricing, type BookPricingViewer, type CachedBookLine, type ViewerModeKey } from './book-pricing.js';
import { PRECEDENCE_PRESETS } from './precedence.js';
import type { PricingProfile, ProfileMemoKey } from './pricing-profile.js';

/**
 * Review finding 1 (release 0.108.0) — the price-book cache is keyed by the
 * pricing profile, which the display mode does not depend on: the display mode
 * depends on the organization (its override) and on guest vs signed-in (which
 * settings key answers). A guest and an organization with no buyer books share
 * one profile, so a display mode stored in the cached answer is served to the
 * wrong viewer. And the price-surface worker resolves a buyer profile with a
 * guest viewer, so whatever it leaves in the cache must not carry its viewer.
 */
describe('BookPricing — the display mode is applied per viewer, never cached under the profile', () => {
  const VIP = 'vip';
  const VIP_BOOK = 'book-vip';

  function engine() {
    const reads = { rows: 0 };
    const em = {
      findOne: async () => ({ currencies: ['PLN'] }),
      execute: async (sql: string, params: unknown[] = []) => {
        if (sql.includes('price_list_precedence')) {
          return [{ version: 1, cells: PRECEDENCE_PRESETS.HY.cells, category_before_attribute: true, depth_mode: 'within_cell' }];
        }
        const base = { id: 'base', name: 'Base', type: 'regular', audience_kind: 'everyone', priority: 0, is_system: true, member_organization_id: null, member_customer_group_id: null };
        const vip = { id: VIP_BOOK, name: 'VIP', type: 'regular', audience_kind: 'customer_groups', priority: 0, is_system: false, member_organization_id: null, member_customer_group_id: VIP };
        if (sql.includes('price_list_audience_members')) return params[1] === VIP ? [base, vip] : [base];
        if (sql.includes('from "price_lists" l') && sql.includes('any(?::uuid[]))))')) {
          // `profileFromVector` — the surface worker's profile.
          return [base, vip];
        }
        reads.rows += 1;
        return [
          { id: 'r-base', price_list_id: 'base', variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'fixed', amount: '100.0000', percent: null },
          { id: 'r-vip', price_list_id: VIP_BOOK, variant_id: null, product_id: 'p1', category_id: null, attribute_key: null, attribute_value: null, min_quantity: 1, max_quantity: null, price_type: 'percent', amount: null, percent: '-10.00' },
        ];
      },
    } as unknown as EntityManager;
    // Guests read `gross_only`; organization `acme` overrides to `net_only`;
    // any other signed-in buyer reads the default, `both`.
    const overrides = new Map<string, DisplayMode>([['acme', 'net_only']]);
    const viewerMode = (organizationId: string | null, signedIn: boolean): DisplayMode =>
      !signedIn ? 'gross_only' : ((organizationId !== null ? overrides.get(organizationId) : undefined) ?? 'both');
    const tailReads: Array<{ organizationId: string | null; customerKind: string }> = [];
    const cache = new PricingCache<CachedBookLine, ProfilePricingCacheKey>({ ttlMs: 60_000 });
    const viewerModeMemo = new PricingCache<DisplayMode, ViewerModeKey>({ ttlMs: 60_000 });
    const books = new BookPricing({
      emFactory: () => em,
      channelBridge: { entityIdsInChannelSubquery: () => ({ sql: 'select 1', params: [] }) },
      categoryRead: () => ({ listAssignmentsForProducts: async () => [] }) as never,
      attributeRead: () => ({ listByFlag: async () => [] }) as never,
      variantRead: () => ({ listVariantsByProductIds: async () => [] }),
      productDisplayModes: async () => new Map(),
      viewerDisplayMode: async ({ organizationId, customerKind }) => {
        tailReads.push({ organizationId, customerKind });
        return viewerMode(organizationId, customerKind === 'signed_in');
      },
      cache,
      viewerModeMemo,
      profileMemo: new PricingCache<PricingProfile, ProfileMemoKey>({ ttlMs: 60_000 }),
    });
    const guest: BookPricingViewer = { organizationId: null, customerGroupId: null, signedIn: false, salesChannelId: 'ch', currencyCode: 'PLN' };
    const org = (organizationId: string, customerGroupId: string | null = null): BookPricingViewer => ({
      organizationId,
      customerGroupId,
      signedIn: true,
      salesChannelId: 'ch',
      currencyCode: 'PLN',
    });
    const ask = async (viewer: BookPricingViewer) =>
      (await books.resolve([{ key: 'k', product: { id: 'p1', attributeValues: {} }, quantity: 1 }], viewer)).get('k');
    return { books, cache, viewerModeMemo, reads, guest, org, ask, overrides, tailReads };
  }

  it('a guest first, then an organization with no buyer book: each reads its own display mode', async () => {
    const { ask, guest, org } = engine();
    expect((await ask(guest))?.displayMode).toBe('gross_only');
    const acme = await ask(org('acme'));
    expect(acme?.resolution.price?.amount).toBe('100.0000');
    expect(acme?.displayMode).toBe('net_only');
  });

  it('an organization first, then a guest: the organization override is not served to the guest', async () => {
    const { ask, guest, org } = engine();
    expect((await ask(org('acme')))?.displayMode).toBe('net_only');
    expect((await ask(guest))?.displayMode).toBe('gross_only');
    expect((await ask(org('beta')))?.displayMode).toBe('both');
  });

  it('the prices themselves are still shared through the profile', async () => {
    const { ask, guest, org, reads } = engine();
    await ask(guest);
    await ask(org('acme'));
    await ask(org('beta'));
    expect(reads.rows).toBe(1);
  });

  it('the surface worker resolving a buyer profile with its guest viewer leaves nothing a buyer reads', async () => {
    const { books, ask, guest, org, reads } = engine();
    const acme = org('acme', VIP);
    const profiles = await books.profilesFor(acme);
    const worker = await books.profileFromVector({
      channelId: 'ch',
      currencyCode: 'PLN',
      precedenceVersion: profiles!.precedenceVersion,
      vector: profiles!.buyer.vector,
    });
    expect(worker.key).toBe(profiles!.buyer.key);
    // What `PriceSurface.#rowsOf` does: the profile, priced with a guest viewer.
    const built = await books.resolveListing([{ id: 'p1', attributeValues: {} }], { ...guest }, worker);
    expect(built.get('p1')?.answer?.resolution.price?.amount).toBe('90.0000');
    const answer = await ask(acme);
    expect(answer?.resolution.price?.amount).toBe('90.0000');
    expect(answer?.displayMode).toBe('net_only');
    // The worker's resolution was not stored: the buyer resolved on its own.
    expect(reads.rows).toBe(2);
  });

  it('a cached line holds what the profile decides and nothing the request already says', async () => {
    const { books, cache, ask, guest } = engine();
    await ask(guest);
    const profiles = await books.profilesFor(guest);
    const cached = cache.get({ profileKey: profiles!.buyer.key, productId: 'p1', variantId: null, quantity: 1 });
    // The currency is the profile key's (and so the request's): a copy in the
    // value could only ever disagree with it (review 2, finding 10).
    expect(Object.keys(cached ?? {}).sort()).toEqual(['productDisplayMode', 'resolution']);
    expect((await ask(guest))?.currencyCode).toBe('PLN');
  });

  // Review 2, finding 4 — the tail costs up to three reads (the organization
  // override, `Setting`, `SettingValue`), and a warm resolve paid them on every
  // call although every line was a hit.
  it('a warm repeated resolve does not read the viewer tail again', async () => {
    const { ask, guest, org, tailReads } = engine();
    await ask(org('acme'));
    await ask(guest);
    expect(tailReads).toHaveLength(2);
    await ask(org('acme'));
    await ask(guest);
    await ask(org('acme'));
    expect(tailReads).toHaveLength(2);
  });

  it('the tail is memoised per viewer, not per profile', async () => {
    const { ask, guest, org, tailReads } = engine();
    expect((await ask(org('acme')))?.displayMode).toBe('net_only');
    expect((await ask(org('beta')))?.displayMode).toBe('both');
    expect((await ask(guest))?.displayMode).toBe('gross_only');
    // A guest of an organization is a guest: the override is not read for it.
    expect((await ask({ ...guest, organizationId: 'acme' }))?.displayMode).toBe('gross_only');
    expect(tailReads.map((r) => `${r.customerKind}:${r.organizationId ?? '-'}`)).toEqual([
      'signed_in:acme',
      'signed_in:beta',
      'guest:-',
    ]);
  });

  it('a pricing generation bump drops the memoised tail, so a changed override takes effect', async () => {
    const { books, cache, viewerModeMemo, ask, org, overrides } = engine();
    expect((await ask(org('acme')))?.displayMode).toBe('net_only');
    overrides.set('acme', 'none');
    // What `PricingGeneration.bump` does to this process's layers
    // (`plugin.ts`): each layer its owner holds, then the engine's own memos.
    cache.invalidateAll();
    viewerModeMemo.invalidateAll();
    books.invalidateAll();
    expect((await ask(org('acme')))?.displayMode).toBe('none');
  });

  // Review 3 of release 0.108.0, B2 — the memo had three invalidations: the
  // plugin's clear on a bump, `BookPricing.invalidateAll` clearing it again,
  // and the generation in its key. The memo is the plugin's, like the answer
  // cache and the profile memo, so the plugin's clear is the one clear; the
  // generation in `ViewerModeKey` stays as the guard against a write that
  // commits while the tail is read.
  it('the engine leaves the memo it was handed to its owner to clear', async () => {
    const { books, viewerModeMemo } = engine();
    const cleared = vi.spyOn(viewerModeMemo, 'invalidateAll');
    books.invalidateAll();
    expect(cleared).not.toHaveBeenCalled();
  });

  it('a generation bump alone is enough, whoever clears the engine', async () => {
    const { cache, ask, org, overrides } = engine();
    expect((await ask(org('acme')))?.displayMode).toBe('net_only');
    overrides.set('acme', 'both');
    cache.invalidateAll();
    expect((await ask(org('acme')))?.displayMode).toBe('both');
  });
});
