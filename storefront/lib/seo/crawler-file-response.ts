/**
 * What `robots.txt` and `llms.txt` have in common once it is decided what to
 * answer (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md`
 * §4 – §5): the headers, and the temporary failure.
 *
 * Both files are one sales channel's, both carry an operator's text as plain
 * text, and both are asked for by the Admin UI's preview — so both answer
 * with the same constants, written once. What each file *is*, and when it is
 * served, stays in `robots-txt.ts` and `llms-txt.ts`.
 *
 * ## The text is an operator's, and it is served as text
 *
 * It reaches the response body and nothing else: the status, every header and
 * the content type are constants of this module. `text/plain` with `nosniff`
 * means no browser renders it, whatever it looks like.
 */

import { SALES_CHANNEL_HEADER, SALES_CHANNEL_REQUEST_HEADER } from '../channel/channel-header';

/**
 * Marks a response as coming from a storefront that serves operator-configured
 * crawler files. On every answer of both handlers, `404` and `503` included.
 *
 * A storefront older than this feature ignores `?part=system` and returns its
 * whole `robots.txt`, and has no `llms.txt` at all. The Admin UI's preview
 * tells those from an answer to what it asked by this header, so that it never
 * shows an operator's text appended to the file of a storefront that will not
 * append it, and never takes "no such route" for "no file for this channel".
 */
export const CRAWLER_FILES_CAPABILITY_HEADER = 'X-Endora-Crawler-Files';

/** How long a crawler is asked to wait before asking again, on `503`. */
export const CRAWLER_FILE_RETRY_AFTER_SECONDS = 120;


/**
 * The sales channel `request` is for, or `undefined` when it names none. A
 * reverse proxy stamps it per host, and `middleware.ts` stamps the channel the
 * backend resolves for this storefront on a request no proxy stamped.
 */
export function requestChannelCode(request: Request): string | undefined {
  return request.headers.get(SALES_CHANNEL_REQUEST_HEADER) ?? undefined;
}

/** The headers of every answer; only what a cache may do with it varies. */
export function crawlerFileHeaders(cacheControl: string): Headers {
  return new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': cacheControl,
    // Plain text, and to be read as nothing else.
    'X-Content-Type-Options': 'nosniff',
    // The body is one sales channel's. A cache that keys on the address alone
    // would serve it for every channel behind that address.
    Vary: SALES_CHANNEL_HEADER,
    [CRAWLER_FILES_CAPABILITY_HEADER]: '1',
  });
}

/** The file, for a minute. */
export function crawlerFileServed(body: string): Response {
  // A minute, on top of the reader's own minute: a saved change is in every
  // crawler's reach within two.
  return new Response(body, { status: 200, headers: crawlerFileHeaders('public, max-age=60') });
}

/**
 * The file as well as it can be told right now, for this request only.
 *
 * For a file composed while something it is made of could not be established:
 * it is the best answer there is, and the next request may have a better one,
 * so no cache may keep it.
 */
export function crawlerFileServedUncached(body: string): Response {
  return new Response(body, { status: 200, headers: crawlerFileHeaders('no-store') });
}

/**
 * The part of a file this storefront generates, for the Admin UI's preview.
 *
 * `no-store`: it is the file **without** the operator's text, at an address
 * that differs from the real one by a query string only — and a cache set up
 * to ignore query strings would file it under the real address.
 */
export function crawlerFileGeneratedPart(body: string): Response {
  return new Response(body, { status: 200, headers: crawlerFileHeaders('no-store') });
}

/**
 * "Ask again later": the configuration could not be read and none is known.
 *
 * `fileName` is the only thing that varies, and it is a constant of the
 * caller. The body is one line that is shaped like neither file.
 */
export function crawlerFileUnavailable(fileName: 'robots.txt' | 'llms.txt'): Response {
  const headers = crawlerFileHeaders('no-store');
  headers.set('Retry-After', String(CRAWLER_FILE_RETRY_AFTER_SECONDS));
  return new Response(`${fileName} is temporarily unavailable. Try again shortly.\n`, {
    status: 503,
    headers,
  });
}
