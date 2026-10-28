import { notFound, permanentRedirect } from 'next/navigation';
import type { ProductDetail, ProductPagePaths } from '@endora-commerce/contracts';
import { getProductBySlug, resolveProductKey } from '../../../../lib/api/catalog';
import { StorefrontApiError, type RequestContext } from '../../../../lib/api/client';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md`
 * §4, §6) — the product page's key handling, apart from the page so it can be
 * tested without rendering it.
 *
 * A URL key is valid only in its own language (K1), so the page first asks the
 * backend which product the key names at this request's channel and language, and
 * then reads that product **by id**. Every product URL this answers with — the
 * redirect target, the canonical, the alternates — was built by the backend with
 * `productPath()`: the storefront does not know the channel's default language, so
 * it composes none of its own.
 */

/**
 * The id of the product `key` names here. A redirect key answers a permanent
 * redirect to the backend's path; a key of no product, or of a product this
 * request may not see, answers the page's not-found. So does an archived
 * product's `410 PRODUCT_ARCHIVED` (T155 finding B4): rethrown, it rendered the
 * error page as an HTTP 500; the shopper is shown the ordinary not-found page,
 * with a 404 status — the App Router page has no way to answer 410 itself.
 * Anything else (a backend failure) is the error page.
 *
 * `permanentRedirect` and `notFound` throw: neither may be called inside a
 * `try` that would catch it. The 308 is not shared-cacheable: the page reads the
 * request's cookies (`getServerContext`), so Next renders it dynamically and sends
 * `Cache-Control: private, no-cache, no-store`.
 */
export async function productIdForKey(key: string, ctx: RequestContext): Promise<string> {
  let resolution;
  try {
    resolution = await resolveProductKey(key, ctx);
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 410)) notFound();
    throw err;
  }
  if (resolution.kind === 'redirect') {
    // Checkpoint E security review (I3) — a redirect never leaves the product pages:
    // a path the backend did not build as `/p/<key>` (protocol-relative, absolute,
    // backslash or another route) is answered as a key of no product.
    if (!isProductPagePath(resolution.path)) notFound();
    permanentRedirect(resolution.path);
  }
  return resolution.productId;
}

/**
 * The product `productIdForKey` named, read by id. A product that became unavailable
 * or was archived between the two reads (`404` / `410`) answers the page's not-found,
 * as the resolve does (T155 finding B4); anything else is the error page.
 */
export async function productById(productId: string, ctx: RequestContext): Promise<ProductDetail> {
  try {
    return await getProductBySlug(productId, ctx);
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 410)) notFound();
    throw err;
  }
}

/** `/p/<one segment>`, optionally with a query — never `//…`, a scheme or a backslash. */
function isProductPagePath(path: string): boolean {
  return /^\/p\/[^/\\?#]+(\?[^\\#]*)?$/.test(path);
}

/**
 * The page's `hreflang` links: one per language the product is available in to
 * anonymous visitors, each the path the backend built (FR-074) — `undefined` when
 * there is none. The canonical is `paths.canonical`, written into the metadata
 * literal by the page itself so the indexability check can read it.
 */
export function alternateLanguages(paths: ProductPagePaths): Record<string, string> | undefined {
  if (paths.alternates.length === 0) return undefined;
  return Object.fromEntries(paths.alternates.map((alternate) => [alternate.languageCode, alternate.path]));
}

/**
 * The language a product link asked for (`?lang=<L>`, FR-071): a non-default
 * language travels with every URL the platform emits. Only a well-formed BCP-47
 * tag is passed on; the backend resolves it against the channel's languages.
 */
export function requestedLanguage(lang: string | string[] | undefined): string | null {
  return typeof lang === 'string' && /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(lang) ? lang : null;
}
