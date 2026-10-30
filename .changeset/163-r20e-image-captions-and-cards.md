---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Image captions and image cards: a caption measure and two layout fixes.

- `cms.Image` gains `captionMaxWidthPx` per breakpoint.
- Fix: a caption below the image on phones and beside it from a wider breakpoint, with a set image width, was squeezed into the image's width there; the figure now holds the image at its width and the caption in a column of its own.
- Fix: a caption on the same edge as the read-more label overlapped it on a narrow card; it now sits above the label's line (`cmsc-pb-carousel-image--more-clear-top|bottom`). Visible change for cards with both on one edge.
