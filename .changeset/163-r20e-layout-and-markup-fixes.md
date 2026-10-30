---
'@endora-commerce/cms-components': patch
---

Page builder fixes: column outsets keep the box's outer spacing, empty headings render nothing, and no React key warning on media-and-text videos.

- A Column's background outset replaced the box's own outer spacing at the sides at every breakpoint, also where the outset was 0. The outset is now the cell's, and the box keeps its side spacing on top of it.
- An inline heading holding only blank text or line breaks rendered an empty heading element (Media and text, Hero, carousel and tile titles); it now renders nothing. A published Heading block left empty keeps its box but writes no heading element.
- `MediaTextMediaFrame` no longer spreads a props object holding `key` into `<video>` (React's development warning).
