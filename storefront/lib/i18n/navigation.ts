import { permanentRedirect, redirect } from 'next/navigation';
import { getServerContext } from '../server-context';
import { localizePath, pageAlternates } from './locale-path';

/**
 * The server half of the storefront's link helper (feature 167,
 * `specs/167-storefront-locale-path/contracts/storefront-navigation.md` §3), for
 * server components, server actions and route handlers.
 *
 * A server-side `redirect('/y')` reaches the browser exactly as written — the
 * middleware does not prefix it (research R-1, spike answer (d)) — so every one goes
 * through `localeRedirect`.
 */

/** `path` in the current request's language, or in `languageCode`. */
export async function localizedPath(path: string, languageCode?: string): Promise<string> {
  const { urlState } = await getServerContext();
  return localizePath(path, urlState, languageCode);
}

/** `next/navigation`'s `redirect` to `path` in the current request's language. */
export async function localeRedirect(path: string): Promise<never> {
  redirect(await localizedPath(path));
}

/** `next/navigation`'s `permanentRedirect` to `path` in the current request's language. */
export async function localePermanentRedirect(path: string): Promise<never> {
  permanentRedirect(await localizedPath(path));
}

/**
 * The canonical and `hreflang` alternates of a page whose logical path is the same in
 * every language (url-shape §8, FR-030): the canonical under the current language's
 * prefix, one alternate per channel language, and `x-default` → the unprefixed URL.
 * Spread into a page's `alternates` literal, so `check:storefront-indexability` still
 * reads a `canonical` there. Without known URL languages, the logical path and no
 * alternates.
 */
export async function localizedAlternates(
  logicalPath: string,
): Promise<{ canonical: string; languages?: Record<string, string> }> {
  const { urlState } = await getServerContext();
  if (urlState.languages.length === 0) return { canonical: logicalPath };
  return pageAlternates(logicalPath, urlState);
}
