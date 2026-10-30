---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-blog': patch
---

The latest-posts block gains options for its post cards, its header lead and its header button.

Nothing changes for content that does not use them: the default markup and look are the ones the block had.

- **Card look.** `blog.LatestPosts` offers a card background (`cardBackground`, a hex or brand colour), card corners (`cardRadius`), card padding and text padding (`cardPadding` / `cardTextPadding`, a spacing step or Custom px, per breakpoint), the image ratio per breakpoint (`imageRatio`, any aspect token or a custom `w:h`; 2:1 by default), zoom on hover (`hoverZoom`), the category chip style (`chipStyle`: filled, outline or hidden), the card title size and weight per breakpoint (`cardTitleSize`, `cardTitleSizePx`, `cardTitleWeight`), and the read-more link's icon (arrow or plus), alignment (start or end) and weight.
- **Header.** The lead takes a size per breakpoint and a colour (`leadSize`, `leadSizePx`, `leadColor`). The header button can sit below the lead (as before), at the end of the header or after the posts, per breakpoint (`headerButtonPlacement`), and can span the full width per breakpoint (`headerButtonFullWidth`).
- **Markup.** The options are written as classes and custom properties on the block root (`cmsc-pb-latest-posts--*`, `--cmsc-post-*`); a button placed after the posts renders in `.cmsc-pb-latest-posts__action` after the carousel or grid. The shared carousel header (`carouselHeaderNode`, `CarouselHeaderBlock`) takes optional options for this; other blocks call it as before.
- **Editor.** The new fields carry English and Polish labels; the responsive ones are on the Responsive tab.
