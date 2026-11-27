import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  SALES_CHANNEL_ACCESS_CACHE_KEY_PREFIX,
  SALES_CHANNEL_ACCESS_CHANGED_CHANNEL,
  SALES_CHANNEL_ACCESS_LRU_TTL_MS,
  SalesChannelAccessCache,
} from './sales-channel-access-cache.js';

/**
 * Feature 154 — the per-Organization permitted-channel set
 * (`contracts/channel-access-rule.md` §5, research R-6).
 *
 * Read on every customer request, so it has to answer from memory, and an
 * operator's assignment change has to be honoured on the writing process at
 * once and everywhere else within the LRU window. The obligations are the ones
 * `SalesChannelsCache` carries: drop the shared layer first, keep the prefix
 * marked while the drop is on the wire, fail closed to PostgreSQL when the drop
 * failed, and expire the local layer.
 */

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ab';
const KEY = `${SALES_CHANNEL_ACCESS_CACHE_KEY_PREFIX}${ORG}`;

interface FakeRedisControls {
  redis: Redis;
  store: Map<string, string>;
  published: Array<{ channel: string; message: string }>;
  failDelWith: (err: Error | null) => void;
  blockDel: (blocked: boolean) => void;
  releaseDel: () => void;
}

function fakeRedis(): FakeRedisControls {
  const store = new Map<string, string>();
  const published: Array<{ channel: string; message: string }> = [];
  let delError: Error | null = null;
  let blocked = false;
  let release: (() => void) | null = null;

  const redis = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<'OK'> {
      store.set(key, value);
      return 'OK';
    },
    async scan(
      _cursor: string,
      _match: 'MATCH',
      pattern: string,
      _count: 'COUNT',
      _n: number,
    ): Promise<[string, string[]]> {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...store.keys()].filter((k) => k.startsWith(prefix))];
    },
    async del(...keys: string[]): Promise<number> {
      if (blocked) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (delError) throw delError;
      let n = 0;
      for (const k of keys) if (store.delete(k)) n += 1;
      return n;
    },
    async publish(channel: string, message: string): Promise<number> {
      published.push({ channel, message });
      return 1;
    },
  } as unknown as Redis;

  return {
    redis,
    store,
    published,
    failDelWith: (err) => {
      delError = err;
    },
    blockDel: (b) => {
      blocked = b;
    },
    releaseDel: () => {
      release?.();
      release = null;
    },
  };
}

/** A loader standing in for the bridge read, counting how often it ran. */
function loaderOf(sets: Record<string, string[]>) {
  const calls: string[] = [];
  const load = vi.fn(async (organizationId: string): Promise<readonly string[]> => {
    calls.push(organizationId);
    return sets[organizationId] ?? [];
  });
  return { load, calls };
}

/** A subscriber stand-in that records the handler and lets a test deliver a message. */
function fakeSubscriber() {
  const handlers: Array<(channel: string, message: string) => void> = [];
  const subscribed: string[] = [];
  const subscriber = {
    on(event: string, handler: (channel: string, message: string) => void) {
      if (event === 'message') handlers.push(handler);
      return subscriber;
    },
    async subscribe(channel: string) {
      subscribed.push(channel);
      return 1;
    },
  } as unknown as Redis;
  return {
    subscriber,
    subscribed,
    deliver: (channel: string, message: string) => handlers.forEach((h) => h(channel, message)),
  };
}

describe('SalesChannelAccessCache reads', () => {
  it('loads on a miss and stores both layers', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({ [ORG]: ['ch-a', 'ch-b'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);

    const set = await cache.permittedChannelIds(ORG);
    expect([...set].sort()).toEqual(['ch-a', 'ch-b']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(JSON.parse(controls.store.get(KEY)!)).toEqual(['ch-a', 'ch-b']);
  });

  it('answers from the in-process layer inside the window without Redis or the loader', async () => {
    const controls = fakeRedis();
    let now = 0;
    const { load } = loaderOf({ [ORG]: ['ch-a'] });
    const cache = new SalesChannelAccessCache(controls.redis, load, () => now);

    await cache.permittedChannelIds(ORG);
    controls.store.set(KEY, JSON.stringify(['ch-z']));
    now += SALES_CHANNEL_ACCESS_LRU_TTL_MS - 1;
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-a']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('re-reads the shared layer once the local entry is older than the window', async () => {
    const controls = fakeRedis();
    let now = 0;
    const { load } = loaderOf({ [ORG]: ['ch-a'] });
    const cache = new SalesChannelAccessCache(controls.redis, load, () => now);

    await cache.permittedChannelIds(ORG);
    controls.store.set(KEY, JSON.stringify(['ch-z']));
    now += SALES_CHANNEL_ACCESS_LRU_TTL_MS;
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-z']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a Redis hit written by another process without loading', async () => {
    const controls = fakeRedis();
    controls.store.set(KEY, JSON.stringify(['ch-b']));
    const { load } = loaderOf({});
    const cache = new SalesChannelAccessCache(controls.redis, load);
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-b']);
    expect(load).not.toHaveBeenCalled();
  });

  it('caches an empty set as an answer, not as a miss', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({});
    const cache = new SalesChannelAccessCache(controls.redis, load);
    expect((await cache.permittedChannelIds(ORG)).size).toBe(0);
    expect((await cache.permittedChannelIds(ORG)).size).toBe(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads through to the loader when Redis is unreachable', async () => {
    const controls = fakeRedis();
    (controls.redis as unknown as { get: () => Promise<never> }).get = async () => {
      throw new Error('Connection is closed.');
    };
    const { load } = loaderOf({ [ORG]: ['ch-a'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-a']);
  });
});

describe('SalesChannelAccessCache invalidation', () => {
  it('drops Redis, then the local layer, then announces the Organization', async () => {
    const controls = fakeRedis();
    const sets: Record<string, string[]> = { [ORG]: ['ch-a'] };
    const { load } = loaderOf(sets);
    const cache = new SalesChannelAccessCache(controls.redis, load);

    await cache.permittedChannelIds(ORG);
    sets[ORG] = ['ch-a', 'ch-b'];
    expect(await cache.invalidateAfterWrite(ORG)).toBe(1);

    expect(controls.store.has(KEY)).toBe(false);
    expect(controls.published).toEqual([
      {
        channel: SALES_CHANNEL_ACCESS_CHANGED_CHANNEL,
        message: JSON.stringify({ organizationId: ORG }),
      },
    ]);
    expect([...(await cache.permittedChannelIds(ORG))].sort()).toEqual(['ch-a', 'ch-b']);
  });

  it('drops only the named Organization', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({ [ORG]: ['ch-a'], [OTHER_ORG]: ['ch-b'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);
    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);

    await cache.invalidateAfterWrite(ORG);
    await cache.permittedChannelIds(OTHER_ORG);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('announces "*" for a change that can move every Organization', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({ [ORG]: ['ch-a'], [OTHER_ORG]: ['ch-b'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);
    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);

    expect(await cache.invalidateAllAfterWrite()).toBe(2);
    expect(controls.store.size).toBe(0);
    expect(controls.published.at(-1)).toEqual({
      channel: SALES_CHANNEL_ACCESS_CHANGED_CHANNEL,
      message: JSON.stringify({ organizationId: '*' }),
    });
    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not let a read that raced the drop re-pin the pre-change set', async () => {
    const controls = fakeRedis();
    const sets: Record<string, string[]> = { [ORG]: ['ch-a'] };
    const { load } = loaderOf(sets);
    const cache = new SalesChannelAccessCache(controls.redis, load);
    await cache.permittedChannelIds(ORG);

    controls.blockDel(true);
    const pending = cache.invalidateAfterWrite(ORG);
    // Mid-drop: answered from the loader, and not cached.
    sets[ORG] = ['ch-b'];
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-b']);
    controls.blockDel(false);
    controls.releaseDel();
    await pending;

    expect(controls.store.has(KEY)).toBe(false);
  });

  it('bypasses both layers after a failed drop until a later drop succeeds', async () => {
    const controls = fakeRedis();
    const sets: Record<string, string[]> = { [ORG]: ['ch-a'] };
    const { load } = loaderOf(sets);
    const cache = new SalesChannelAccessCache(controls.redis, load);
    await cache.permittedChannelIds(ORG);

    controls.failDelWith(new Error('Connection is closed.'));
    // The write committed; the drop failing must not fail the operator's request.
    expect(await cache.invalidateAfterWrite(ORG)).toBeNull();
    sets[ORG] = ['ch-b'];
    // Redis still holds ['ch-a']; serving it would answer the pre-change set.
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-b']);

    controls.failDelWith(null);
    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-b']);
    expect(controls.store.has(KEY)).toBe(false);
  });

  it('keeps the write successful when the announcement cannot be published', async () => {
    const controls = fakeRedis();
    (controls.redis as unknown as { publish: () => Promise<never> }).publish = async () => {
      throw new Error('Connection is closed.');
    };
    const { load } = loaderOf({ [ORG]: ['ch-a'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);
    await cache.permittedChannelIds(ORG);
    expect(await cache.invalidateAfterWrite(ORG)).toBe(1);
  });
});

describe('SalesChannelAccessCache cross-process drop', () => {
  it('drops the local entry of the Organization a message names', async () => {
    const controls = fakeRedis();
    const sets: Record<string, string[]> = { [ORG]: ['ch-a'], [OTHER_ORG]: ['ch-b'] };
    const { load } = loaderOf(sets);
    const cache = new SalesChannelAccessCache(controls.redis, load);
    const sub = fakeSubscriber();
    await cache.watch(sub.subscriber);
    expect(sub.subscribed).toEqual([SALES_CHANNEL_ACCESS_CHANGED_CHANNEL]);

    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);
    // Another process wrote: it dropped Redis itself and announced the change.
    controls.store.clear();
    sets[ORG] = ['ch-c'];
    sub.deliver(SALES_CHANNEL_ACCESS_CHANGED_CHANNEL, JSON.stringify({ organizationId: ORG }));

    expect([...(await cache.permittedChannelIds(ORG))]).toEqual(['ch-c']);
    // The other Organization's entry stays local.
    expect([...(await cache.permittedChannelIds(OTHER_ORG))]).toEqual(['ch-b']);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('drops every local entry on "*" and ignores other channels and garbage', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({ [ORG]: ['ch-a'], [OTHER_ORG]: ['ch-b'] });
    const cache = new SalesChannelAccessCache(controls.redis, load);
    const sub = fakeSubscriber();
    await cache.watch(sub.subscriber);
    await cache.watch(sub.subscriber);
    expect(sub.subscribed).toHaveLength(1);

    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);
    controls.store.clear();

    sub.deliver('b2b:module:state-changed', JSON.stringify({ organizationId: '*' }));
    sub.deliver(SALES_CHANNEL_ACCESS_CHANGED_CHANNEL, 'not json');
    await cache.permittedChannelIds(ORG);
    expect(load).toHaveBeenCalledTimes(2);

    sub.deliver(SALES_CHANNEL_ACCESS_CHANGED_CHANNEL, JSON.stringify({ organizationId: '*' }));
    await cache.permittedChannelIds(ORG);
    await cache.permittedChannelIds(OTHER_ORG);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not fail when the subscription cannot be armed', async () => {
    const controls = fakeRedis();
    const { load } = loaderOf({});
    const cache = new SalesChannelAccessCache(controls.redis, load);
    const subscriber = {
      on: () => subscriber,
      subscribe: async () => {
        throw new Error('Connection is closed.');
      },
    } as unknown as Redis;
    await expect(cache.watch(subscriber)).resolves.toBeUndefined();
  });
});
