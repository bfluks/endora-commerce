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

English error messages are English sentences. 137 `errors.*` entries in these modules'
`i18n/en.json` bundles were the error code in Title Case with a full stop, for example
"Product Not Found." or "Asset Legacy Locator Cannot Harden.", and a request in English received
them verbatim as `error.message`. Each is now a sentence in sentence case, for example
"Product not found." or "This file cannot be made private because it is stored at an address the
platform did not issue. Upload it again first."

Two Polish sentences were corrected to match what the code refuses: `CANNOT_MODIFY_SYSTEM_DEFAULT`
(`mod-sales-channels`) now says the default sales channel can be neither deactivated nor deleted,
and `MEGAMENU_TARGET_OUT_OF_SCOPE` (`mod-megamenu`) now names a page as well as a category.

Error codes and HTTP statuses are unchanged; a client matching on the code sees no difference. A
client that matched on the English message text must match the new sentences.
