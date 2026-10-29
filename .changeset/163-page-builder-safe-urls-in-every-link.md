---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A URL in the image, icon, logo strip, announcement bar and map marker links, and in the social links, passes the same safe-URL rule as every other link of the page builder: it starts with `https://`, `http://`, `mailto:`, `tel:` or `/`.

- Any other URL — `javascript:`, `data:`, `vbscript:`, a protocol-relative `//host`, a relative path without a leading `/`, a bare `#fragment` — renders no link: the image, icon, logo, text or marker label stays, unlinked. A social link keeps its icon and name, with the `#` it already had when no address was set.
- This holds for a URL stored before these blocks took the shared link (`href`) and for a link of kind `url` alike. A safe URL renders as before.
- `blockLinkTarget` now resolves every kind, a URL included, through `resolveLinkHref`.
