---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-search': patch
---

Polish error messages are Polish sentences. 137 `errors.*` entries in these modules' `i18n/pl.json`
bundles were placeholders — the word "Błąd:" followed by the error code lowercased, for example
"Błąd: product not found." — and a request with `Accept-Language: pl` received them verbatim as
`error.message`. Each is now a sentence in Polish, for example "Nie znaleziono produktu."

Error codes, HTTP statuses and the English sentences are unchanged; a client matching on the code
sees no difference.
