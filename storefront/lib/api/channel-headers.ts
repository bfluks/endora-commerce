import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { channelHeaders, SALES_CHANNEL_REQUEST_HEADER } from '../channel/channel-header';

/**
 * The sales channel of the request being served, as a header for a backend call
 * (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.3).
 *
 * The caller's explicit channel wins. Without one, the inbound request's
 * `x-sales-channel` header is used — which `middleware.ts` stamps on every
 * request a proxy did not, so inside a request there always is one. This is
 * what makes the many transport calls that pass no context name the channel
 * without each of them being edited, and what keeps a call added later from
 * forgetting it.
 *
 * Outside a request scope (a build step, a test) there is no inbound request:
 * the answer is `{}` and nothing throws. Next's own control-flow errors are
 * rethrown, so a prerender that has to bail out on a header read still does.
 *
 * Server-only. Browser code names its channel explicitly with `channelHeaders`.
 */
export async function activeChannelHeaders(
  ctx?: { readonly salesChannelCode?: string | undefined } | undefined,
): Promise<Record<string, string>> {
  return channelHeaders(ctx?.salesChannelCode ?? (await stampedChannelCode()));
}

/** The inbound request's channel code, or `undefined` outside a request or when none is there. */
export async function stampedChannelCode(): Promise<string | undefined> {
  try {
    return (await headers()).get(SALES_CHANNEL_REQUEST_HEADER) || undefined;
  } catch (err) {
    unstable_rethrow(err);
    return undefined;
  }
}
