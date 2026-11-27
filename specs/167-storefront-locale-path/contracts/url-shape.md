# Contract — storefront URL shape and request handling (feature 167)

The binding description of what a storefront URL looks like and how a request for one is answered.
It is the source for the middleware's unit tables (`storefront/test/i18n/middleware-language.test.ts`)
and for every backend emitter. Owner rulings are cited as OR-n (`spec.md`).

## 1. Grammar

```text
page-url      = [ "/" prefix ] logical-path [ "?" query ]
prefix        = primary-subtag | full-tag            ; lower case, derived (§2)
primary-subtag= 2*3ALPHA
full-tag      = primary-subtag 1*( "-" 1*8alphanum )
logical-path  = "/" | "/" segment *( "/" segment )   ; the route tree as it is today
```

- The home page under a prefix is `/<prefix>` (no trailing slash). `/<prefix>/` is answered as the
  same page; the canonical never has the trailing slash.
- The logical path is exactly today's URL: `/p/<key>`, `/c/<slug>`, `/catalog`, `/search`,
  `/blog/…`, `/<cms path>`, `/cart`, `/checkout/…`, `/account/…`, `/login`, … — no segment is
  translated.
- `?lang=` is never emitted.

## 2. Prefix derivation (OR-5)

For channel languages `Ls` (channel order, default language included) and flag `P`
(`prefixDefaultLanguage`):

```text
primary(L) = lower(L.split("-")[0])
prefix(L)  = primary(L)        if |{ M ∈ Ls : primary(M) = primary(L) }| = 1
           = lower(L)          otherwise
prefixed(L)= not (L = default and P = false)
alias(p)   = { L ∈ Ls : primary(L) = p }   for each p with |alias(p)| ≥ 2
```

The function is `channelUrlLanguages()` in `@endora-commerce/contracts`
(`contracts-package.md` §1). It is computed by the backend and answered on
`GET /api/v1/storefront/sales-channel` as `urlLanguages` and `urlLanguageAliases`; the storefront
consumes the answer and does not derive.

## 3. Request handling

Applies to **document** paths (`isDocumentPath`) that are not language-neutral (§4). First segment
`s` (case preserved), rest `R`, query `Q`, `Q−lang` = `Q` without every `lang` parameter, order of
the rest preserved.

| # | Condition | Setting on | Setting off |
| --- | --- | --- | --- |
| 1 | `s` equals a prefix of language L, lower case | render L at `R` | L is default → **308** `R?Q`; else render L at `R` |
| 2 | `lower(s)` equals a prefix, `s` is not lower case | **308** `/lower(s)R?Q` | same |
| 3 | `lower(s)` is a split alias (§2) | **307** `/prefix(L*)R?Q`, L* = `lang` cookie → `Accept-Language` match among the alias's languages, else the first | same |
| 4 | otherwise (no prefix; `s` is part of the logical path — including a prefix of a platform language the channel does not serve, OR-12) | **307** `/prefix(L*)` + path + `?Q−lang`, L* = `?lang` → `lang` cookie → `Accept-Language` → default (§5) | `?lang` names channel language L: L default → **308** path`?Q−lang`; else **308** `/prefix(L)` path`?Q−lang` (OR-13). No/unknown `?lang` → render default at path; cookie and `Accept-Language` not read (OR-3) |

Response headers:

- 307 from rows 3 and 4: `Vary: Accept-Language, Cookie`, `Cache-Control: private, no-store`
  (OR-11).
- 308: `Cache-Control: public, max-age=3600` (bounded — the setting can be flipped, research R-5).
- Every response keeps the channel's `X-Robots-Tag` (144) as today.

A render forwards, on the **request** headers (written or deleted on every request — FR-018):

| Header | Value |
| --- | --- |
| `x-storefront-language` | L (`pl-PL`) |
| `x-storefront-language-prefix` | the prefix used by this URL, or empty for the unprefixed default |
| `x-pathname` | the logical path `R` (unchanged meaning: the root layout's checkout-chrome branch) |

`?lang` on a rendered prefixed URL is ignored (OR-4); it is not redirected away (the canonical
already omits it).

## 4. Language-neutral paths (OR-8)

Never prefixed, never redirected for language, no language headers:

- every non-document path (`/_next/static`, `/_next/image`, files by extension, `favicon.ico`,
  `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/llms.txt`);
- first segment `api`, `pwa`;
- `/offline` (static, precached by the service worker at one address);
- `/service-unavailable` (the outage rewrite target, never linked).

Held as `LANGUAGE_NEUTRAL_SEGMENTS` beside `RESERVED_TOP_LEVEL_SEGMENTS` in
`storefront/app/reserved-segments.ts`; every entry must be a reserved segment (unit test).

Route handlers in the page namespace (`/newsletter/subscribe`, `/session-expired`) are **not**
neutral: they are reached from a page, are prefixed like it, and read the forwarded language.

## 5. Language choice for a 307 (OR-2, OR-11)

Against the channel's languages only; a value naming another language is skipped:

1. `?lang=` — each value in order; exact tag (case-insensitive), then primary subtag.
2. The `lang` cookie — exact tag, then primary subtag.
3. `Accept-Language` — by q-weight; exact tag, then primary subtag (today's `resolveLocale`
   algorithm, fed the channel's list).
4. The channel's default language.

Setting off: none of this applies to an unprefixed URL (OR-3); only `?lang=` is honoured, as a 308
(§3 row 4).

## 6. Ordering with other middleware decisions (research R-14)

Outage gate (503 at the requested URL) → language handling (§3) → closed-store redirect on the
logical path, localized → rewrite. With no channel identity known, §3 is skipped and the request is
rendered as is (FR-019).

## 7. Page-level answers

| Page | Case | Answer |
| --- | --- | --- |
| Product | key is current in L | render |
| Product | key is a former key in L (163) | **308** `productPath(current key at L)` (prefixed) |
| Product | key is a current key of the same product in another channel language, product reachable at L | **307** `productPath(effective key at L)` |
| Product | otherwise | 404 |
| Any | logical path not found | 404, rendered in L |

## 8. Canonical and alternates (OR-7)

For a page with logical path `p` on channel languages `Ls`:

```text
canonical          = url(p, L)
alternates[M]      = url(p, M)              for each M ∈ Ls where the page exists in M
alternates[x-default] = p                   (unprefixed, both states)
url(p, M)          = prefixed(M) ? "/" + prefix(M) + (p = "/" ? "" : p) : p
```

For a product, `p` differs per language (its effective key) and "exists in M" is 163's anonymous
availability rule; the backend answers `paths.canonical`, `paths.alternates`, `paths.xDefault`.
`x-default` for a product is `/p/<key at the default language>`.

## 9. Worked examples (channel `pl-PL` default, `en-US`)

| Request | Accept-Language | On | Off |
| --- | --- | --- | --- |
| `/` | `en` | 307 `/en` | render pl |
| `/` + cookie `lang=en-US` | `pl` | 307 `/en` | render pl |
| `/de/o-nas` (no German in channel) | — | 307 `/pl/de/o-nas` (CMS or 404) | render pl `/de/o-nas` (CMS or 404) |
| `/pl` | — | render pl | 308 `/` |
| `/en/p/drill` | `pl` | render en | render en |
| `/p/wiertarka?variant=A` | `en` | 307 `/en/p/wiertarka?variant=A` → 307 `/en/p/drill` | render pl |
| `/p/drill?lang=en-US` | `pl` | 307 `/en/p/drill` | 308 `/en/p/drill` |
| `/EN/c/narzedzia` | — | 308 `/en/c/narzedzia` | 308 `/en/c/narzedzia` |
| `/api/v1/…`, `/robots.txt` | — | untouched | untouched |
