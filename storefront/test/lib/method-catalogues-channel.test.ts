import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDeliveryMethods, listPaymentMethods } from '../../lib/api/methods';

/**
 * The checkout's two method catalogues are asked for the sales channel the
 * buyer is shopping.
 *
 * A delivery or payment method is offered per sales channel, and the backend
 * lists the methods offered in the channel the request resolves. Both reads are
 * made server-side, to the backend's own host, so `X-Sales-Channel` is the only
 * thing that carries the storefront's channel across — and both used to be made
 * with no context at all. That was invisible while the backend ignored the
 * channel; once it does not, a storefront that still asked without the header
 * would be shown the default channel's methods on every channel.
 *
 * A context without a code sends the channel the middleware stamped on the
 * request (`specs/154-sales-channel-access/`); only outside a request is no
 * header sent and the default channel's catalogue returned.
 */

/**
 * The channel `middleware.ts` stamped on the request being served, as
 * `next/headers` answers it — or `null` for no request scope at all
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.3).
 */
const stamped: { code: string | null } = { code: null };
vi.mock('next/headers', () => ({
  headers: async () => {
    if (stamped.code === null) throw new Error('`headers` was called outside a request scope.');
    return new Headers({ 'x-sales-channel': stamped.code });
  },
}));

const originalFetch = globalThis.fetch;
let sent: Array<{ path: string; headers: Record<string, string> }> = [];

beforeEach(() => {
  stamped.code = null;
  sent = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    sent.push({
      path: new URL(String(url)).pathname,
      headers: ((init as { headers?: Record<string, string> }).headers ?? {}) as Record<
        string,
        string
      >,
    });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('method catalogues carry the sales channel', () => {
  it('listDeliveryMethods sends X-Sales-Channel', async () => {
    await listDeliveryMethods({ salesChannelCode: 'b2b-eu', locale: 'en-US' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe('/api/v1/delivery-methods');
    expect(sent[0]!.headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('listPaymentMethods sends X-Sales-Channel', async () => {
    await listPaymentMethods({ salesChannelCode: 'b2b-eu', locale: 'en-US' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe('/api/v1/payment-methods');
    expect(sent[0]!.headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('sends the stamped channel when the context names none', async () => {
    stamped.code = 'default';
    await listDeliveryMethods({ locale: 'en-US' });
    await listPaymentMethods({ locale: 'en-US' });

    expect(sent.map((request) => request.headers['X-Sales-Channel'])).toEqual(['default', 'default']);
  });

  it('sends no channel header outside a request', async () => {
    await listDeliveryMethods({ locale: 'en-US' });
    await listPaymentMethods({ locale: 'en-US' });

    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.headers).not.toHaveProperty('X-Sales-Channel');
    }
  });
});
