---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/page-builder-admin': patch
---

The image, icon, logo strip, announcement bar and map marker links are the shared link: a page, product, category, file, a section of the page or a URL, with **Open in new tab**.

A URL stored before (`href`, with the image's and the icon's `linkTarget`) reads as a link of kind `url` with the same target — a logo's as a new tab, as it always opened — and a safe one renders as before; an unsafe one renders no link (see the safe-URL change).

- `cms.Image`, `cms.Icons`, `cms.AnnouncementBar` and each `cms.LogoStrip` item gain `link` (`LinkValue`); `cms.Map`'s `markers[].link` takes a string or a `LinkValue`, and the marker's popup links its label. The blocks' `resolveData` carries a stored URL into `link` when the block is opened in the editor.
- `@endora-commerce/cms-components` exports `blockLink`, `blockLinkTarget` and `carriedBlockLink`, the reading these blocks share.
- The admin gives each of them the link field with its pickers. A link's **Open in new tab** shows once the link leads somewhere (or already opens a new tab).
- A map marker is listed by its label or its position, up to 50 markers.
