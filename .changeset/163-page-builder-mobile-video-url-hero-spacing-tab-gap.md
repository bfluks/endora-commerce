---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

Mobile videos by URL, spacing after any hero element, a gap below the tab bar and stable element ids for tabs, accordions and sign-up forms. With none of the new options chosen, every block renders as before.

- A mobile video may be given by URL as well as from the asset library: `cms.Video` (file source) gains `mobileUrl`, the `cms.Hero` video media gains `mobileVideoUrl` (the URL source's mobile video; each kind falls back to the other), and the `cms.MediaText` / `cms.CarouselSplit` video media gains `videoSource: 'library' | 'url'`, `videoUrl`, `mobileVideoAssetId` and `mobileVideoUrl`. A distinct mobile video renders a breakpoint pair, of which the stylesheet shows one; an autoplaying one is still muted, started only on screen and never under reduced motion. An autoplaying media-and-text video now carries `data-autoplay`.
- `cms.Hero` gains `spaceAfter`, a list of `{element, space, spacePx}`: the space below any element, a spacing token or Custom px, in either spacing mode. Unlisted elements keep `gaps`, or today's spacing without it.
- `cms.Tabs` gains `panelGap` / `panelGapPx` (a spacing token or Custom px, per breakpoint) for the space between the tab bar and the panel; unset, today's 12 px. A panel in columns is a `cms.Row` inside the panel.
- `cms.Tabs`, `cms.Accordion`, `cms.NewsletterSignup` and `newsletter.Signup` build their element ids from the block's id, with `useId()` only as the fallback, so the ids hydrate whatever is rendered above the page.

`@endora-commerce/mod-cms` adds the field labels in English and Polish and the admin controls for the new video sources; in the page editor, a list that names its summary field (`metadata.pageBuilder.summaryField`) is summarised by that choice's translated label.
