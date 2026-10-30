'use client';

import Link from 'next/link';
import { createContext, forwardRef, useCallback, useContext, type ComponentProps, type ReactNode } from 'react';
import { localizePath, type UrlLanguageState } from './locale-path';

/**
 * The client half of the storefront's link helper (feature 167,
 * `specs/167-storefront-locale-path/contracts/storefront-navigation.md` §3).
 *
 * The root layout provides the channel's URL languages and the current language;
 * `<LocalizedLink>` and `useLocalizedPath()` put the right prefix on every internal
 * path. Without a provider (a test, a component rendered outside the layout) a path
 * is returned as written.
 */

const EMPTY: UrlLanguageState = { languages: [], aliases: [], current: '' };

const LocalePathContext = createContext<UrlLanguageState>(EMPTY);

export function LocalePathProvider({ value, children }: { value: UrlLanguageState; children: ReactNode }) {
  return <LocalePathContext.Provider value={value}>{children}</LocalePathContext.Provider>;
}

/** The current URL-language state — for the few components that need more than a path (the switcher). */
export function useUrlLanguageState(): UrlLanguageState {
  return useContext(LocalePathContext);
}

/** `(path, languageCode?) => path` in the current language, or in `languageCode`. */
export function useLocalizedPath(): (path: string, languageCode?: string) => string {
  const state = useContext(LocalePathContext);
  return useCallback((path: string, languageCode?: string) => localizePath(path, state, languageCode), [state]);
}

type LinkProps = ComponentProps<typeof Link>;

/** `next/link` with the current language's prefix on a root-relative `href`. Same props. */
export const LocalizedLink = forwardRef<HTMLAnchorElement, LinkProps>(function LocalizedLink({ href, ...rest }, ref) {
  const state = useContext(LocalePathContext);
  const localized =
    typeof href === 'string'
      ? localizePath(href, state)
      : href.pathname
        ? { ...href, pathname: localizePath(href.pathname, state) }
        : href;
  return <Link ref={ref} href={localized} {...rest} />;
});

/**
 * A plain `<a>` with the current language's prefix on a root-relative `href` — for
 * links that must not become client navigations (sign-out, file downloads, a full
 * reload on purpose). Same props as `<a>`.
 */
export const LocalizedAnchor = forwardRef<HTMLAnchorElement, ComponentProps<'a'>>(function LocalizedAnchor(
  { href, ...rest },
  ref,
) {
  const state = useContext(LocalePathContext);
  return <a ref={ref} href={href === undefined ? undefined : localizePath(href, state)} {...rest} />;
});

/**
 * A `<form>` whose root-relative string `action` takes the current language's
 * prefix — for the header search, the footer newsletter form and the like, which
 * post or navigate to a storefront page. Same props as `<form>`.
 */
export const LocalizedForm = forwardRef<HTMLFormElement, ComponentProps<'form'>>(function LocalizedForm(
  { action, ...rest },
  ref,
) {
  const state = useContext(LocalePathContext);
  return <form ref={ref} action={typeof action === 'string' ? localizePath(action, state) : action} {...rest} />;
});
