import { notFound, permanentRedirect } from 'next/navigation';
import type { ProductPagePaths } from '@endora-commerce/contracts';
import { resolveProductKey } from '../../../../lib/api/catalog';
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
 * request may not see, answers the page's not-found. Anything else (an archived
 * product's `410`, a backend failure) is the error page, as before.
 *
 * `permanentRedirect` and `notFound` throw: neither may be called inside a
 * `try` that would catch it.
 */
export async function productIdForKey(key: string, ctx: RequestContext): Promise<string> {
  let resolution;
  try {
    resolution = await resolveProductKey(key, ctx);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) notFound();
    throw err;
  }
  if (resolution.kind === 'redirect') permanentRedirect(resolution.path);
  return resolution.productId;
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
