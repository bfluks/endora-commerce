import { describe, expect, it, vi } from 'vitest';
import { StorefrontRevalidator } from './storefront-revalidator.js';

describe('StorefrontRevalidator', () => {
  it('is disabled (no-op) without a base URL or secret', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: undefined, secret: 's', fetchFn }).revalidate(['ga:config']);
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: undefined, fetchFn }).revalidate(['ga:config']);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs the tags with the shared secret header when configured', async () => {
    // `Parameters<typeof fetch>` rather than `RequestInfo`/`RequestInit` by name: the
    // option this stands in for is declared `typeof fetch`, and the two DOM aliases were
    // ambient in `backend`'s program by accident rather than by a `lib` this package sets.
    type FetchArgs = Parameters<typeof fetch>;
    const fetchFn = vi.fn(async (_u: FetchArgs[0], _i?: FetchArgs[1]) => new Response(null, { status: 200 }));
    await new StorefrontRevalidator({
      baseUrl: 'http://storefront:3010',
      secret: 'sekret',
      fetchFn: fetchFn as unknown as typeof fetch,
    }).revalidate(['ga:config']);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('http://storefront:3010/api/revalidate');
    expect(init?.method).toBe('POST');
    expect((init!.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
    expect(JSON.parse((init!).body as string)).toEqual({ tags: ['ga:config'] });
  });

  it('swallows transport errors (best-effort)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('unreachable');
    });
    await expect(
      new StorefrontRevalidator({
        baseUrl: 'http://x',
        secret: 's',
        fetchFn: fetchFn as unknown as typeof fetch,
      }).revalidate(['ga:config']),
    ).resolves.toBeUndefined();
  });

  it('does nothing for an empty tag list', async () => {
    const fetchFn = vi.fn();
    await new StorefrontRevalidator({ baseUrl: 'http://x', secret: 's', fetchFn }).revalidate([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('logs a non-2xx answer as a failure, naming the status and never the secret (security M2)', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
    await expect(
      new StorefrontRevalidator({
        baseUrl: 'http://x',
        secret: 'sekret',
        fetchFn: fetchFn as unknown as typeof fetch,
        logger: { warn },
      }).revalidate(['ga:config']),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const [obj, msg] = warn.mock.calls[0]!;
    expect(obj).toMatchObject({ status: 401 });
    expect(JSON.stringify([obj, msg])).not.toContain('sekret');
  });

  it('bounds the call with a timeout signal, and logs a transport failure', async () => {
    const warn = vi.fn();
    type FetchArgs = Parameters<typeof fetch>;
    const fetchFn = vi.fn(async (_u: FetchArgs[0], _i?: FetchArgs[1]) => {
      throw new Error('aborted');
    });
    await new StorefrontRevalidator({
      baseUrl: 'http://x',
      secret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
      logger: { warn },
    }).revalidate(['ga:config']);
    expect(fetchFn.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
