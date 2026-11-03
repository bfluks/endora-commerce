import type { Redis } from 'ioredis';
import type { AudiencedMegamenu } from './storefront-resolver.js';

/**
 * Storefront read-through cache for the Megamenu module — feature 015 / T017.
 *
 * Mirrors feature 014's `CmsCache` shape exactly: same key-prefix scheme,
 * same TTL, same SCAN-based coarse invalidation. Keys live under
 * `megamenu:v2:<channelCode>:<language>`.
 *
 * `v2` since feature 168: an entry holds the audienced tree — every audience's
 * items, each with its audience — which the route filters per visitor. A `v1`
 * entry has no audiences and would be served to everyone as if it were one, so
 * the prefix moved rather than the entries being trusted to expire first.
 */

export const MEGAMENU_CACHE_KEY_PREFIX = 'megamenu:v2:';
export const MEGAMENU_CACHE_DEFAULT_TTL_SECONDS = 5 * 60;

export interface MegamenuCacheOptions {
  ttlSeconds?: number;
  /** When false, get/set are short-circuit no-ops (useful for tests). */
  enabled?: boolean;
}

export class MegamenuCache {
  private readonly ttlSeconds: number;
  private readonly enabled: boolean;

  constructor(private readonly redis: Redis, options: MegamenuCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? MEGAMENU_CACHE_DEFAULT_TTL_SECONDS;
    this.enabled = (options.enabled ?? true) && this.ttlSeconds > 0;
  }

  static composeKey(channelCode: string, language: string): string {
    return `${MEGAMENU_CACHE_KEY_PREFIX}${channelCode}:${language}`;
  }

  async get(channelCode: string, language: string): Promise<AudiencedMegamenu | null> {
    if (!this.enabled) return null;
    const raw = await this.redis.get(MegamenuCache.composeKey(channelCode, language));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as AudiencedMegamenu;
    } catch {
      await this.redis.del(MegamenuCache.composeKey(channelCode, language));
      return null;
    }
  }

  async set(channelCode: string, language: string, payload: AudiencedMegamenu): Promise<void> {
    if (!this.enabled) return;
    await this.redis.set(
      MegamenuCache.composeKey(channelCode, language),
      JSON.stringify(payload),
      'EX',
      this.ttlSeconds,
    );
  }

  async invalidateScope(channelCode: string, language: string): Promise<void> {
    if (!this.enabled) return;
    await this.redis.del(MegamenuCache.composeKey(channelCode, language));
  }

  /**
   * Coarse drop of every cache entry for one channel — used when a binding
   * for that channel changes scope (the language is not always known to the
   * caller without an extra DB read).
   */
  async invalidateChannel(channelCode: string): Promise<void> {
    await this.scanDelete(`${MEGAMENU_CACHE_KEY_PREFIX}${channelCode}:*`);
  }

  /** Used when a menu-level write happens (one menu may serve N bindings). */
  async invalidateAll(): Promise<void> {
    await this.scanDelete(`${MEGAMENU_CACHE_KEY_PREFIX}*`);
  }

  private async scanDelete(pattern: string): Promise<void> {
    if (!this.enabled) return;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length > 0) await this.redis.del(...keys);
    } while (cursor !== '0');
  }
}
