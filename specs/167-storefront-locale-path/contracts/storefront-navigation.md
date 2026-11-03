# Contract — storefront navigation helpers and the lint rule (feature 167)

How storefront code produces a URL after this feature. Research R-6, R-7, R-8.

## 1. Pure core — `storefront/lib/i18n/locale-path.ts`

No `next/*` import, no validation library (it is imported by the middleware).

```ts
export interface UrlLanguageState {
  /** The channel's URL languages as `GET /api/v1/storefront/sales-channel` answered them. */
  readonly languages: readonly ChannelUrlLanguage[];
  readonly aliases: readonly ChannelUrlLanguageAlias[];
  /** The language of the current URL. */
  readonly current: string;
}

export type LocaleParse =
  | { kind: 'render'; languageCode: string; prefix: string; logicalPath: string }
  | { kind: 'redirect'; status: 307 | 308; location: string; varyOnLanguageInputs: boolean };

/** url-shape.md §3 and §5, the whole table. */
export function parseLocalePath(input: {
  pathname: string;
  search: string;
  acceptLanguage: string | null;
  /** The `lang` cookie's value; consulted only for the 307s (url-shape §3 rows 3–4, §5). */
  langCookie: string | null;
  languages: readonly ChannelUrlLanguage[];
  aliases: readonly ChannelUrlLanguageAlias[];
}): LocaleParse;

/** Prefix a logical path for `state.current` (or `languageCode`). Idempotent; see §2. */
export function localizePath(path: string, state: UrlLanguageState, languageCode?: string): string;

/** The logical path of a browser path: the prefix removed when it is a channel prefix. */
export function stripLocalePrefix(pathname: string, state: UrlLanguageState): string;

/** Canonical + hreflang + x-default for a page whose path is language-independent (url-shape §8). */
export function pageAlternates(
  logicalPath: string,
  state: UrlLanguageState,
): { canonical: string; languages: Record<string, string> };
```

## 2. `localizePath` rules

| Input | Output |
| --- | --- |
| `''`, `#x`, `?q`, `mailto:`, `tel:`, `http(s)://…`, `//…` | unchanged |
| `/x…` whose first segment is a channel prefix or alias | unchanged (idempotent) |
| `/x…` whose first segment is language-neutral (url-shape §4) | unchanged |
| `/` | `/<prefix>` or `/` when the language is unprefixed |
| `/x…` otherwise | `/<prefix>/x…` or `/x…` when the language is unprefixed |

Query and fragment are preserved verbatim.

## 3. Adapters

| Where | API | Reads the state from |
| --- | --- | --- |
| Client components, and server components that render links | `<LocalizedLink href …>` (`'use client'`, wraps `next/link`, same props) | `LocalePathContext` |
| Client code | `useLocalizedPath(): (path, languageCode?) => string` | `LocalePathContext` |
| Root layout | `<LocalePathProvider value={state}>` around the body | `getServerContext()` |
| Server components, server actions, route handlers | `await localizedPath(path)` | `getServerContext()` (which reads `x-storefront-language` and the channel read) |
| Server redirects | `await localeRedirect(path)`, `await localePermanentRedirect(path)` | same; then `next/navigation`'s `redirect` / `permanentRedirect` |
| Plain `<a>` (no client navigation wanted, e.g. sign-out, file downloads in the page namespace) | `<a href={await localizedPath('/x')}>` or `useLocalizedPath()` | — |
| `packages/cms-components` blocks | `LinkHrefEnv.localizePath?: (path: string) => string` (identity when absent); render context passes it | the storefront's block renderer |

`getServerContext()` (`storefront/lib/server-context.ts`) changes: `locale` comes from
`x-storefront-language` validated against the channel's `urlLanguages`; the `lang` cookie (which
only the middleware reads, for the 307) and `langOverride` are no longer read; it returns `urlLanguages`, `urlLanguageAliases` and the current
prefix for the provider.

## 4. The lint rule

`storefront/eslint.config.js`, block `files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}']`,
`ignores: ['lib/i18n/locale-path*.{ts,tsx}', 'lib/i18n/localized-link.tsx']`, rule
`no-restricted-syntax` with these selectors (message:
`Internal storefront paths go through LocalizedLink / localizedPath / localeRedirect (specs/167-storefront-locale-path).`):

1. `JSXOpeningElement[name.name=/^(a|Link)$/] > JSXAttribute[name.name='href'] > Literal[value=/^\/(?!\/)/]`
2. the same with `JSXExpressionContainer > Literal[value=/^\/(?!\/)/]`
3. the same with `JSXExpressionContainer > TemplateLiteral` whose first quasi starts with `/` and not `//`
   (`TemplateLiteral > TemplateElement:first-child[value.raw=/^\/(?!\/)/]`)
4. `CallExpression[callee.name=/^(redirect|permanentRedirect)$/] > :first-child` matching 1–3's literal forms
5. `CallExpression[callee.property.name=/^(push|replace|prefetch)$/][callee.object.name='router']` with such a first argument
6. `NewExpression[callee.name='URL'] > Literal:first-child[value=/^\/(?!\/)/]` inside a `NextResponse.redirect(…)` call

`next/link`'s `Link` stays importable (the rule targets literal root paths, not the component), so
external and dynamic links are unaffected.

Red proof: `storefront/test/i18n/locale-href-lint.test.ts` runs ESLint's Node API on an in-memory
fixture containing one violation per selector and one compliant form per adapter, and asserts the
exact set of reported lines.

## 5. The switcher

`storefront/components/HeaderPreferenceSwitchers.tsx` → `LocaleSwitcher` becomes a list of links:

- one `<a hreflang={code} lang={code} href={localizePath(logicalPath + search, state, code)}>` per
  channel language, the current one with `aria-current="page"`; label = the language's endonym from
  the language dictionary; group label from `messages.ts` (`header.language`, en + pl);
- after hydration, each `href` is replaced by the document's
  `link[rel="alternate"][hreflang="<code>"]` when one exists (product pages);
- activating an option also writes `lang=<code>` (`path=/`, one year, `samesite=lax`) in a click
  handler that does not prevent the navigation (OR-11); without JavaScript the link still navigates
  and the cookie is not written;
- renders nothing when the channel has one language;
- `CurrencySwitcher` is unchanged (currency stays a cookie preference).
