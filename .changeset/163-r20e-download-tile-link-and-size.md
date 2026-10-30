---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The download tile can link to a page or URL, and gains a minimum height; its title size now applies from the tablet up.

- `linkTo: 'link'` with `link` (a page, product, category, file or URL) makes the tile one link to it — no file badge, no `download` attribute, the icon button pointing onwards. Unset, the tile links to its file as before.
- `minHeightPx` (180 px by default).
- Fix: a `titleSizePx` set for the tablet or desktop was overridden by the phone's value from 768 px (a stylesheet rule order); it now applies.
