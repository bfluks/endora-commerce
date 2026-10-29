/**
 * Same-origin proxy for push subscription register/revoke (feature 046, US4).
 *
 * The browser cannot call the backend directly; this Route Handler forwards the
 * request to the backend public subscribe endpoint, carrying the session cookie
 * (so the backend can associate a logged-in customer, FR-023) and the resolved
 * sales-channel header.
 */

import { channelHeaders, SALES_CHANNEL_REQUEST_HEADER } from '../../../lib/channel/channel-header';
import { backendBaseUrl } from '../../../lib/env.mjs';

export const dynamic = 'force-dynamic';

const baseUrl = (): string => backendBaseUrl();

function forwardHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookie = request.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;
  // The channel the middleware stamped (or a proxy did) on this request.
  return { ...headers, ...channelHeaders(request.headers.get(SALES_CHANNEL_REQUEST_HEADER)) };
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  const res = await fetch(`${baseUrl()}/api/v1/storefront/pwa/subscriptions`, {
    method: 'POST',
    headers: forwardHeaders(request),
    body,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await request.text();
  const res = await fetch(`${baseUrl()}/api/v1/storefront/pwa/subscriptions`, {
    method: 'DELETE',
    headers: forwardHeaders(request),
    body,
  });
  return new Response(null, { status: res.status });
}
