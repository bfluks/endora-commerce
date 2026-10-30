---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Carousel images gain a read-more label; the Image block's caption gains a placement, size and alignment per breakpoint.

Unset, both blocks render as before.

- `cms.CarouselImage`: `moreLabel` (translatable) shows a second line, such as "Read more", in a corner of its own over the image (`moreLabelPlacement`, bottom right by default), with an optional icon (`moreLabelIcon`); it is part of the item's link.
- `cms.Image`: `captionPlacement` may differ per breakpoint (below or beside the image; a stored value applies to every breakpoint), and the caption takes `captionSize` (a type-scale step or Custom with `captionSizePx`; a `captionSizePx` stored without a size reads as Custom) and `captionAlign` per breakpoint.
