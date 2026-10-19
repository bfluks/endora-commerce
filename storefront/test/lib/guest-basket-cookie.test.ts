import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #358 — the signed-out basket is carried over on sign-in.
 *
 * The storefront signs a shopper in from a server action, so the browser never
 * talks to the backend on the sign-in route: the backend can only merge the
 * basket the shopper built while signed out if the storefront forwards the
 * browser's `b2b_cart_anon` cookie with the sign-in call. Nothing else from the
 * browser's jar is forwarded, and only a well-formed basket token is.
 *
 * The jar answers decoded values, as Next's `cookies().get()` does.
 */

vi.mock('next/headers', async () => (await import('./cookie-jar-harness')).nextHeaders);

const { jar, deleteCalls, resetJar } = await import('./cookie-jar-harness');
const { loginCustomer } = await import('../../lib/api/auth');
const { getCartItemCountAction } = await import('../../lib/actions/cart');

const ANON = 'b2b_cart_anon';
const DEVICE = 'b2b_customer_device';
const TOKEN = 'anon-7f3c9a2e-4b1d-4c8e-9a0f-1e2d3c4b5a69';
const SIGNED = 'v1.c-1.0a1b.2c3d.ab+cd/ef';
/** What `@fastify/cookie`'s `clearCookie` sends. */
const CLEAR_ANON = `${ANON}=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

const originalFetch = globalThis.fetch;

function stubFetch(
  body: unknown,
  setCookie: string[] = [],
): Array<{ url: string; cookie: string | null }> {
  const seen: Array<{ url: string; cookie: string | null }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), cookie: new Headers(init?.headers).get('cookie') });
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const value of setCookie) headers.append('set-cookie', value);
    return new Response(JSON.stringify(body), { status: 200, headers });
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(() => {
  resetJar();
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

describe('only a well-formed basket token is forwarded', () => {
  it('drops a value that decodes to more than one cookie pair', async () => {
    jar.set(DEVICE, SIGNED);
    jar.set(ANON, 'anon-x; compare_token=other');
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(seen[0]!.cookie).toBe(`${DEVICE}=${encodeURIComponent(SIGNED)}`);
  });

  it('drops a value holding a line break, and the sign-in still goes through', async () => {
    jar.set(ANON, 'anon-x\r\nX-Other: 1');
    const seen = stubFetch({ data: { status: 'authenticated' } });

    await expect(
      loginCustomer({ email: 'buyer@example.test', password: 'secret' }),
    ).resolves.toMatchObject({ status: 'authenticated' });

    expect(seen[0]!.cookie).toBeNull();
  });

  it('applies the same rule to the cart calls', async () => {
    jar.set('b2b_session', 'sess');
    jar.set(ANON, 'anon-x; compare_token=other');
    const seen = stubFetch({ data: { itemCount: 0 } });

    await getCartItemCountAction();

    expect(seen[0]!.cookie).toBe('b2b_session=sess');
  });

  it('still forwards a well-formed token on the cart calls', async () => {
    jar.set(ANON, TOKEN);
    const seen = stubFetch({ data: { itemCount: 0 } });

    await getCartItemCountAction();

    expect(seen[0]!.cookie).toBe(`${ANON}=${TOKEN}`);
  });
});

describe('sign-in clears the consumed basket cookie', () => {
  function mergeAnswer(outcome: 'adopted' | 'merged' | 'noop') {
    return { data: { status: 'authenticated', cartMerge: { outcome, destinationCartId: 'c-1' } } };
  }

  it('clears it when the basket was adopted', async () => {
    jar.set(ANON, TOKEN);
    stubFetch(mergeAnswer('adopted'), [CLEAR_ANON]);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.has(ANON)).toBe(false);
  });

  it('clears it when the basket was merged', async () => {
    jar.set(ANON, TOKEN);
    stubFetch(mergeAnswer('merged'), [CLEAR_ANON]);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.has(ANON)).toBe(false);
  });

  it('clears it when the basket was empty (the backend clears it too)', async () => {
    jar.set(ANON, TOKEN);
    stubFetch(mergeAnswer('noop'), [CLEAR_ANON]);

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.has(ANON)).toBe(false);
  });

  it('keeps it when no basket matched the token (the backend keeps it too)', async () => {
    jar.set(ANON, TOKEN);
    stubFetch(mergeAnswer('noop'));

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.get(ANON)).toBe(TOKEN);
    expect(deleteCalls).not.toContain(ANON);
  });

  it('keeps it when the backend reports no merge', async () => {
    jar.set(ANON, TOKEN);
    stubFetch({ data: { status: 'authenticated' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.get(ANON)).toBe(TOKEN);
  });

  it('keeps it when a second step is still required', async () => {
    jar.set(ANON, TOKEN);
    stubFetch({ data: { status: 'mfaRequired', challengeId: 'ch-1' } });

    await loginCustomer({ email: 'buyer@example.test', password: 'secret' });

    expect(jar.get(ANON)).toBe(TOKEN);
  });
});
