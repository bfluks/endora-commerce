import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 155, FR-032 — the server action the quote-request draft page reads its lines'
 * current minimums through (research R15).
 *
 * The draft lives in `localStorage`, so a line may have been added before the minimum was set
 * (US4 #14): the page reads the **current** minimum per distinct product slug from the public
 * product detail, as the buyer (session forwarded, so the buyer's catalogue visibility
 * applies) and in the request's sales channel. Threat S8: distinct slugs, at most 8 reads in
 * flight, at most 200 slugs. Plan I5: a non-2xx answer (a product the buyer may not see is a
 * 404) means "minimum unknown" — no entry — and never fails the whole read.
 */
const jar = new Map<string, string>();
const headerValues = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (): void => undefined,
    delete: (): void => undefined,
  }),
  headers: async () => ({
    get: (name: string) => headerValues.get(name.toLowerCase()) ?? null,
  }),
}));

const { readDraftMinimums } = await import('../../app/(commerce)/quote-request/actions');

const originalFetch = globalThis.fetch;

interface Recorded {
  url: string;
  cookie: string | null;
  channel: string | null;
}

let calls: Recorded[] = [];
let inFlight = 0;
let maxInFlight = 0;

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers as Record<string, string> | undefined;
  return h?.[name] ?? null;
}

function slugOf(url: string): string {
  const path = new URL(url).pathname;
  return decodeURIComponent(path.split('/').pop() ?? '');
}

function stubFetch(answer: (slug: string) => { status: number; body: unknown }): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      cookie: headerOf(init, 'Cookie'),
      channel: headerOf(init, 'X-Sales-Channel'),
    });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Yield a few turns so concurrent workers overlap and the bound is observable.
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    const { status, body } = answer(slugOf(String(url)));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function product(slug: string, minOrderQuantity: number | null): { status: number; body: unknown } {
  return { status: 200, body: { data: { id: `id-${slug}`, slug, name: slug, minOrderQuantity } } };
}

beforeEach(() => {
  calls = [];
  inFlight = 0;
  maxInFlight = 0;
  jar.clear();
  headerValues.clear();
  jar.set('b2b_session', 'sess-123');
  headerValues.set('x-sales-channel', 'b2b-pl');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('readDraftMinimums', () => {
  it('answers each slug with its current minimum, null for none', async () => {
    stubFetch((slug) => product(slug, slug === 'a' ? 10 : null));
    expect(await readDraftMinimums(['a', 'b'])).toEqual({ a: 10, b: null });
  });

  it('reads each distinct slug once and skips empty ones', async () => {
    stubFetch((slug) => product(slug, 5));
    const result = await readDraftMinimums(['a', 'a', '', '  ', 'b', 'a']);
    expect(calls.map((c) => slugOf(c.url)).sort()).toEqual(['a', 'b']);
    expect(result).toEqual({ a: 5, b: 5 });
  });

  it('has at most 8 reads in flight [S8]', async () => {
    stubFetch((slug) => product(slug, 2));
    const slugs = Array.from({ length: 30 }, (_, i) => `p-${i}`);
    const result = await readDraftMinimums(slugs);
    expect(calls).toHaveLength(30);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(8);
    expect(Object.keys(result)).toHaveLength(30);
  });

  it('reads at most 200 slugs [S8]', async () => {
    stubFetch((slug) => product(slug, null));
    const slugs = Array.from({ length: 250 }, (_, i) => `p-${i}`);
    await readDraftMinimums(slugs);
    expect(calls).toHaveLength(200);
  });

  it('treats a non-2xx answer as "minimum unknown" without failing the rest (plan I5)', async () => {
    stubFetch((slug) =>
      slug === 'hidden'
        ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } }
        : slug === 'broken'
          ? { status: 500, body: { error: { code: 'INTERNAL', message: 'boom' } } }
          : product(slug, 10),
    );
    const result = await readDraftMinimums(['a', 'hidden', 'broken']);
    expect(result).toEqual({ a: 10 });
    expect('hidden' in result).toBe(false);
  });

  it('tolerates a network failure on one slug', async () => {
    stubFetch((slug) => product(slug, 10));
    const stubbed = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (slugOf(String(url)) === 'down') throw new TypeError('fetch failed');
      return stubbed(url, init);
    }) as typeof fetch;
    expect(await readDraftMinimums(['a', 'down'])).toEqual({ a: 10 });
  });

  it("forwards the buyer's session cookie and the request's sales channel", async () => {
    stubFetch((slug) => product(slug, 10));
    await readDraftMinimums(['a']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('http://api.test/api/v1/catalog/products/a');
    expect(calls[0]?.cookie).toBe('b2b_session=sess-123');
    expect(calls[0]?.channel).toBe('b2b-pl');
  });

  it('refuses input that is not a list of strings', async () => {
    stubFetch((slug) => product(slug, 10));
    expect(await readDraftMinimums('a' as unknown as string[])).toEqual({});
    expect(await readDraftMinimums([1, null, 'a'] as unknown as string[])).toEqual({ a: 10 });
    expect(calls).toHaveLength(1);
  });
});
