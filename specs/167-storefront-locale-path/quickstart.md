# Quickstart — verifying feature 167 by hand

Prerequisites: `pnpm run build:packages`, `pnpm run setup`, `pnpm run dev`. Sales channel `B2B`
with languages `pl-PL` (default) and `en-US`; a product with Polish key `wiertarka` and English key
`drill`, available to anonymous visitors in both; a category `narzedzia`.

A fresh `pnpm run setup` creates the default channel with the setting **on**. On a database that
existed before the upgrade every channel is **off** (OR-10) — switch `B2B` on in the admin first,
and confirm with `select code, prefix_default_language from sales_channels;` that the other channels
are still `false`.

## Setting on (default)

```bash
S=http://localhost:3000
curl -sI "$S/" -H 'Accept-Language: en'                   # 307 Location: /en ; Vary: Accept-Language, Cookie
curl -sI "$S/" -H 'Accept-Language: pl' -H 'Cookie: lang=en-US'   # 307 /en (cookie beats Accept-Language)
curl -sI "$S/?lang=pl-PL" -H 'Cookie: lang=en-US'         # 307 /pl (?lang beats the cookie)
curl -sI "$S/de/o-nas"                                    # 307 /pl/de/o-nas — German is not a channel language (OR-12)
curl -sI "$S/p/wiertarka?variant=A" -H 'Accept-Language: pl'   # 307 /pl/p/wiertarka?variant=A
curl -sI "$S/en/p/wiertarka"                              # 307 /en/p/drill
curl -sI "$S/p/drill?lang=en-US" -H 'Accept-Language: pl' # 307 /en/p/drill
curl -sI "$S/EN/c/narzedzia"                              # 308 /en/c/narzedzia
curl -s  "$S/en/p/drill" -H 'Accept-Language: pl' -H 'Cookie: lang=pl-PL' | grep -o '<html lang="[^"]*"'   # en-US
curl -sI "$S/robots.txt" ; curl -sI "$S/api/health"       # no language redirect
```

Open `/pl/p/wiertarka` in a browser: the switcher's *English* option links to `/en/p/drill`; every
link in the header, footer, breadcrumbs and product cards starts with `/pl`. Choose English: the
browser lands on `/en/p/drill` and the `lang` cookie is `en-US`; open `/` again → `/en`. View source: canonical
`/pl/p/wiertarka`, alternates `pl-PL`, `en-US`, `x-default → /p/wiertarka`.

## Setting off

Admin → Sales channels → B2B → switch off *Prefix the default language in URLs* → save. Within a
minute:

```bash
curl -sI "$S/" -H 'Accept-Language: en' -H 'Cookie: lang=en-US'    # 200, Polish — no negotiation
curl -sI "$S/pl/c/narzedzia"                # 308 /c/narzedzia
curl -sI "$S/p/bohrer?lang=en-US"           # 308 /en/p/bohrer
```

## Emitters

- `GET /api/v1/storefront/sales-channel` → `urlLanguages: [{pl-PL, pl, prefixed}, {en-US, en, …}]`.
- Regenerate the `seo` sitemap and a product feed for English: no `?lang=`, every product URL is
  `/en/p/<English key>`.
- Register an organization in English: the verification link is `/en/verify?token=…` (on) or
  `/en/verify?…` (off — English is not the default).

## CMS

Try saving a page slugged `en/o-nas` → `409 CMS_SLUG_RESERVED` naming `en`.

## Closed store and outage

Set the channel's anonymous access off; anonymous `GET /` → one 307 to `/pl/login?next=%2Fpl`.
Stop the backend; `GET /en/p/drill` → 503 at the same URL, notice in English.
