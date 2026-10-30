---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-seo': minor
'@endora-commerce/mod-product-feeds': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-newsletter': minor
'@endora-commerce/mod-comparisons': minor
'@endora-commerce/mod-mfa': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-settings': patch
---

The storefront language is part of the URL path (`/pl/p/wiertarka`, `/en/p/drill`, issue #396).

**Upgrade note for operators: existing sales channels keep their addresses.** The migration
`Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage` adds the per-channel setting
*Prefix the default language in URLs* and switches it **off** on every channel that exists when it
runs, so default-language URLs stay unprefixed; channels created later start **on**. To adopt
prefixes for the default language too, switch *Prefix the default language in URLs* on in
*Sales channels* → the channel. Other languages are prefixed either way: a former
`/p/<key>?lang=<L>` link answers a permanent redirect to `/<prefix>/p/<key>`. A CMS page whose slug
starts with a channel language prefix can no longer be saved.

`@endora-commerce/contracts`:

- New: `channelUrlLanguages`, `channelUrlLanguageAliases`, `storefrontPagePath`,
  `storefrontPagePathFor`, `storefrontDefaultPath`, `channelUrlLanguageSchema`,
  `channelUrlLanguageAliasSchema`, `URL_LANGUAGE_PREFIX_PATTERN`, types `ChannelUrlFacts`,
  `ChannelUrlLanguage`, `ChannelUrlLanguageAlias`; `productDefaultPath(key)`.
- **`productPath` takes the channel's URL facts and never appends `?lang=`:**
  `productPath({ key, languageCode, channelDefaultLanguage })` (`/p/drill?lang=en-US`) becomes
  `productPath({ key, languageCode, channel })` (`/en/p/drill`), where `channel` is any
  `{ languages, defaultLanguage, prefixDefaultLanguage }` — the cached channel satisfies it.
- `productKeyResolutionSchema`'s `redirect` requires `permanent` (`false` for a key of another
  channel language, answered 307); `productPagePathsSchema` requires `xDefault`.
- Sales channel shapes carry `prefixDefaultLanguage` (create defaults to `true`); the public
  channel read answers `prefixDefaultLanguage`, `urlLanguages` and `urlLanguageAliases`.
- `cmsPageUrl` (163 R24) takes the channel's URL facts and composes the prefixed path:
  `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` (`/about-us?lang=en-US`) becomes
  `cmsPageUrl({ path, languageCode, channel })` (`/en/about-us`). The resolved CMS page's `url` and
  `alternates`, and the storefront page index, therefore carry each language's own slug under its
  prefix.
- `CmsPageRecord` gains optional `languages` and `translations` (the `seo` sitemap lists each
  language at its own slug); `cmsPageSummarySchema` gains an optional
  `shadowedByLanguagePrefix` (any of the page's slugs, per-language ones included).

Emitters (catalog, seo sitemap, product feeds, organizations, customers, newsletter, comparisons,
mfa, invoices) compose prefixed storefront URLs; the product feed `link` uses the product's key in
the feed language; the invoice e-mail links the storefront order page; the admin password reset
links `/password-reset/confirm`. `cms-components` localizes block links through the render
context's `localizePath`.
