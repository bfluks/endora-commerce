import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cloneOrderToQuote,
  placeOrder,
  previewOrderTotal,
} from '../../lib/api/orders';
import { getOneClickEligibility, placeOneClickOrder } from '../../lib/api/quick-order';
import type { RequestContext } from '../../lib/api/client';

/**
 * Every request that places an order tells the backend which sales channel the
 * buyer is shopping.
 *
 * The backend records an order on the channel the placement request resolves.
 * These calls are made server-side, to the backend's own host, so the
 * `X-Sales-Channel` header is the only thing that can carry the storefront's
 * channel across — and none of the functions below used to send it. Every
 * order placed from a second channel's storefront therefore reached the backend
 * with no channel signal at all and was recorded on the system default.
 *
 * `ctx` is a **required** parameter on each of them now, so the header cannot be
 * forgotten by a caller; this file holds the other half, that the parameter is
 * actually forwarded.
 *
 * A context without a code no longer means "no header" inside a request: the
 * middleware stamps the channel the backend resolves for this storefront, and
 * the transport sends it (`specs/154-sales-channel-access/`). Only outside a
 * request scope — which a single-channel deployment never places an order from
 * — is no header sent, and the backend then resolves its default.
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

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

const originalFetch = globalThis.fetch;
let sent: Sent[] = [];

beforeEach(() => {
  stamped.code = null;
  sent = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    const request = init as { method?: string; headers?: Record<string, string>; body?: string };
    sent.push({
      url: String(url),
      method: request.method ?? 'GET',
      headers: request.headers ?? {},
      body: request.body ? (JSON.parse(request.body) as Record<string, unknown>) : undefined,
    });
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ON_CHANNEL_B: RequestContext = { salesChannelCode: 'b2b-eu', locale: 'en-US' };

const ORDER = {
  deliveryAddressId: 'address-delivery',
  billingAddressId: 'address-billing',
  deliveryMethodId: 'delivery-method',
  paymentMethodId: 'payment-method',
};

/** The one request a call made, by path. */
function requestTo(path: string): Sent {
  const matching = sent.filter((r) => new URL(r.url).pathname === path);
  expect(matching).toHaveLength(1);
  return matching[0]!;
}

describe('order placement carries the sales channel', () => {
  it('placeOrder sends X-Sales-Channel, and no salesChannelId in the body', async () => {
    await placeOrder('session', ORDER, ON_CHANNEL_B);

    const request = requestTo('/api/v1/orders');
    expect(request.method).toBe('POST');
    expect(request.headers['X-Sales-Channel']).toBe('b2b-eu');
    // The channel is the request's. A body field naming one would be a second
    // statement of it, and the backend refuses the two disagreeing.
    expect(request.body).not.toHaveProperty('salesChannelId');
  });

  it('previewOrderTotal sends X-Sales-Channel', async () => {
    await previewOrderTotal(
      'session',
      { deliveryMethodId: 'delivery-method', paymentMethodId: 'payment-method' },
      ON_CHANNEL_B,
    );

    expect(requestTo('/api/v1/orders/preview-total').headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('placeOneClickOrder sends X-Sales-Channel', async () => {
    await placeOneClickOrder('session', { productId: 'product' }, ON_CHANNEL_B);

    const request = requestTo('/api/v1/quick-order/one-click');
    expect(request.method).toBe('POST');
    expect(request.headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('getOneClickEligibility asks for the channel the buyer is on', async () => {
    await getOneClickEligibility('session', 'product', ON_CHANNEL_B);

    expect(
      requestTo('/api/v1/quick-order/one-click/eligibility').headers['X-Sales-Channel'],
    ).toBe('b2b-eu');
  });

  /**
   * The one call that does not place an order but still depends on the
   * request's channel: a quote request records the channel it was raised on.
   */
  it('cloneOrderToQuote sends X-Sales-Channel', async () => {
    await cloneOrderToQuote('session', 'order-id', ON_CHANNEL_B);

    expect(requestTo('/api/v1/orders/order-id/clone-to-quote').headers['X-Sales-Channel']).toBe(
      'b2b-eu',
    );
  });

  it('sends the channel the middleware stamped when the context names none', async () => {
    stamped.code = 'default';
    await placeOrder('session', ORDER, { locale: 'en-US' });

    expect(requestTo('/api/v1/orders').headers['X-Sales-Channel']).toBe('default');
  });

  it('sends no channel header outside a request, leaving the backend its default', async () => {
    await placeOrder('session', ORDER, { locale: 'en-US' });

    expect(requestTo('/api/v1/orders').headers).not.toHaveProperty('X-Sales-Channel');
  });
});
