import { afterEach, describe, expect, it, vi } from 'vitest';
import { MEGAMENU_STOREFRONT_CACHE_TAG } from '@endora-commerce/contracts';
import { getActiveMegamenu } from '../../lib/api/megamenu';

/**
 * `specs/168-megamenu-navigation-bar/` FR-019, plan R-4 — the menu differs by
 * audience, so a signed-in buyer's request carries their session and is never
 * stored, and a guest's stays the cached, tagged read it was.
 */
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function stubFetch(): void {
  calls = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall['init'] });
    return new Response(JSON.stringify({ data: { megamenuId: 'm', name: 'Main', language: 'pl-PL', items: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('getActiveMegamenu (feature 168)', () => {
  it("forwards a signed-in buyer's session and keeps the answer out of every cache", async () => {
    stubFetch();
    await getActiveMegamenu({ locale: 'pl-PL', viewerSession: 'buyer-session' });
    const call = calls[0]!;
    expect((call.init.headers as Record<string, string>)['Cookie']).toBe('b2b_session=buyer-session');
    expect(call.init.cache).toBe('no-store');
    expect(call.init.next).toBeUndefined();
  });

  it("keeps a guest's read cached and tagged, with no credential", async () => {
    stubFetch();
    await getActiveMegamenu({ locale: 'pl-PL' });
    const call = calls[0]!;
    expect((call.init.headers as Record<string, string> | undefined)?.['Cookie']).toBeUndefined();
    expect(call.init.next).toEqual({ revalidate: 60, tags: [MEGAMENU_STOREFRONT_CACHE_TAG] });
  });
});
