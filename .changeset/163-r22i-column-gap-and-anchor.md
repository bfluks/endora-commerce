---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A column gap and an anchor of their own for the 12-column layouts of the media-and-text block, the carousel split slide and the stats.

Nothing changes for content that does not use them: every new option is optional, a block saved before renders the same markup, and the columns keep today's gap.

- **Column gap.** `columnGapPx` (per breakpoint) on `cms.MediaText`, `cms.CarouselSplit` and `cms.Stats` sets the space between the columns of 12. They no longer have to follow the page's side gutter. Left empty, the gap is the side gutter as before.
- **Anchor.** `columnsAnchor: 'start' | 'end'` on `cms.MediaText` and `cms.CarouselSplit` starts the media-and-text pair at column 1 or ends it at column 12, whichever side the media is on. Left empty (`'media'`), a row with the media at the end still ends at column 12.
- The editor fields carry English and Polish labels.
