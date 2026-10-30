/**
 * The one place that spells the header a storefront names its sales channel
 * with (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1).
 *
 * Pure and isomorphic: the middleware, route handlers, server code and browser
 * code all build the header here. `test/lib/channel-header-coverage.test.ts`
 * holds every backend `fetch` to taking its headers from this function or from
 * `activeChannelHeaders` (`lib/api/channel-headers.ts`), which calls it.
 */

/** The header the backend resolves a storefront request's channel from. */
export const SALES_CHANNEL_HEADER = 'X-Sales-Channel';

/** The same header as an inbound request carries it (header names are case-insensitive). */
export const SALES_CHANNEL_REQUEST_HEADER = 'x-sales-channel';

/**
 * `{ 'X-Sales-Channel': code }`, or `{}` when there is no code.
 *
 * An empty string is no code: a header with no value would be refused by the
 * backend as an unknown channel rather than resolved to the default.
 */
export function channelHeaders(code: string | null | undefined): Record<string, string> {
  return code ? { [SALES_CHANNEL_HEADER]: code } : {};
}
