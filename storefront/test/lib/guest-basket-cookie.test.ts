import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #358 — the signed-out basket is carried over on sign-in.
 *
 * The storefront signs a shopper in from a server action, so the browser never
 * talks to the backend on the sign-in route: the backend can only merge the
 * basket the shopper built while signed out if the storefront forwards the
 * browser's `b2b_cart_anon` cookie with the sign-in call. Nothing else from the
 * browser's jar is forwarded.
 */

const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const { loginCustomer } = await import('../../lib/api/auth');

const ANON = 'b2b_cart_anon';
const DEVICE = 'b2b_customer_device';
const TOKEN = 'anon-7f3c9a2e4b1d';
const SIGNED = 'v1.c-1.0a1b.2c3d.ab+cd/ef';

const originalFetch = globalThis.fetch;

function stubFetch(body: unknown): Array<{ url: string; cookie: string | null }> {
  const seen: Array<{ url: string; cookie: string | null }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(() => {
  jar.clear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sign-in forwards the signed-out basket', () => {
  it('sends the b2b_cart_anon cookie when the browser holds one', async () => {
    jar.set(ANON, TOKEN);
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.url).toMatch(/\/api\/v1\/auth\/customer\/login$/);
    expect(seen[0]!.cookie).toBe(`${ANON}=${TOKEN}`);
  });

  it('sends it together with the known-device cookie, and nothing else', async () => {
    jar.set(DEVICE, SIGNED);
    jar.set(ANON, TOKEN);
    jar.set('b2b_session', 'stale.session');
    jar.set('compare_token', 'cmp-1');
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}; ${ANON}=${TOKEN}`);
  });

  it('sends no b2b_cart_anon cookie when the browser holds none', async () => {
    jar.set(DEVICE, SIGNED);
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}`);
    expect(seen[0]!.cookie).not.toContain(ANON);
  });

  it('sends no Cookie header at all when the browser holds neither', async () => {
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBeNull();
  });

  it('returns the merge outcome the backend reports', async () => {
    jar.set(ANON, TOKEN);
    stubFetch({
      data: { status: 'authenticated', cartMerge: { outcome: 'merged', destinationCartId: 'c-1' } },
    });

    const result = await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(result).toMatchObject({ status: 'authenticated', cartMerge: { outcome: 'merged' } });
  });
});
