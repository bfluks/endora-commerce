---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

Carousel controls gain scheme-aware dots, an arrow glyph colour, per-breakpoint visibility and a place inside split slides.

Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

- **Dots.** The dots of the Carousel, the product slider and the latest posts carousel follow the colour scheme: in a dark scheme the current dot is the scheme's text colour over faint dots (before, both were fixed greys and the current dot was hard to tell apart).
- **Solid arrows.** `controls.arrowGlyphColor` sets the icon colour of a solid arrow (white by default), so a white solid arrow can carry a dark icon.
- **Per breakpoint.** `controls.hideArrowsOn` and `controls.hideDotsOn` (the "Hide on" control: mobile, tablet, desktop) hide the arrows or the dots at those widths; a row of controls left empty there is removed.
- **Header without a heading.** Arrows placed in the header of a carousel with no heading now stand at the header's end, as they do beside a heading (before, at its start).
- **Inside split slides.** The Carousel's `controlsPlacement` accepts `slide`: each split slide draws the arrows and dots at the end of its text column, and only the slide on screen has operable controls. A carousel of other items keeps its controls below the slides there. `CarouselSlideControls` is exported for blocks that want to draw them.
- **Markup.** A new root custom property (`--pb-arrow-glyph`) and classes (`cmsc-pb-carousel--arrows-off-*`, `--dots-off-*`, `cmsc-pb-carousel__controls--slide`, `--slide-fallback`); the editor fields carry English and Polish labels.
