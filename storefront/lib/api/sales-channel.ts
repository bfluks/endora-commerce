import type {
  PublicSalesChannel,
  PublicSalesChannelResponse,
  SalesChannelAccessResponse,
} from '@endora-commerce/contracts';
import { apiGet, apiGetForViewer, type RequestContext } from './client';

/**
 * The resolved sales channel for this request — `GET
 * /api/v1/storefront/sales-channel` (feature `005-sales-channels`, section C.1).
 *
 * The backend resolves the channel from the api-key binding, the
 * `X-Sales-Channel` header this client already threads, `?salesChannel`, the
 * host map or the system default. This read is what brings the *answer* back:
 * before it existed the storefront knew a channel **code** (whatever the proxy
 * stamped) and none of the channel's identity — not its theme, not its language
 * or currency scopes, not its logo.
 *
 * Cached under the `channel:<code>` tag with a 5-minute window, matching the
 * other chrome reads. Channel identity changes at operator speed, and a
 * per-request round trip on the critical path of every page would be paid by
 * every buyer.
 */
export const SALES_CHANNEL_TAG = 'channel:identity';

/**
 * `null` when the channel cannot be read.
 *
 * Never throws: this is on the render path of every page through the root
 * layout, and an unreachable backend must not blank the shop. The caller's
 * answer to `null` is the storefront's own default theme — see
 * `lib/theme/theme.ts` — which is the same answer a channel that names no
 * theme gets, and is visibly the reference brand rather than a guess.
 */
export async function getPublicSalesChannel(
  ctx: RequestContext = {},
): Promise<PublicSalesChannel | null> {
  try {
    const res = await apiGet<PublicSalesChannelResponse>(
      '/api/v1/storefront/sales-channel',
      ctx,
      {
        revalidate: 300,
        tags: [SALES_CHANNEL_TAG, `channel:${ctx.salesChannelCode ?? 'default'}`],
      },
    );
    return res.data;
  } catch {
    return null;
  }
}

/**
 * What the viewer of this request may do on this store —
 * `GET /api/v1/storefront/sales-channel/access`
 * (`specs/154-sales-channel-access/contracts/storefront-api.md` §2).
 *
 * Read for the no-access screen: a signed-in buyer whose Organization may not
 * use this store is shown the stores it may use. The answer is the viewer's
 * own, so it is asked with their session and never cached
 * (`apiGetForViewer`), and the backend answers it on any store without
 * refusing.
 *
 * `null` when it cannot be read. Never throws: the screen it serves is already
 * the answer to a refusal, and it still has a way out without the list.
 */
export async function getSalesChannelAccess(
  ctx: RequestContext,
): Promise<SalesChannelAccessResponse['data'] | null> {
  try {
    const res = await apiGetForViewer<SalesChannelAccessResponse>(
      '/api/v1/storefront/sales-channel/access',
      ctx,
    );
    return res.data;
  } catch {
    return null;
  }
}
