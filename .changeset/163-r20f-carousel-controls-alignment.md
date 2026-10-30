---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

Carousel controls: the dots at the start with the arrows at the end, an aligned row inside split slides, and arrows that stay when every slide fits.

Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

- **Dots at the start, arrows at the end.** `controlsAlign` accepts `dots-start` per breakpoint (root `cmsc-pb-carousel--ctl(-md|-lg)-dots-start`) on the Carousel, the product slider and the latest posts carousel. The markup and its reading order are unchanged; the stylesheet moves the dots row first.
- **Inside split slides.** A chosen `controlsAlign` now also aligns the controls drawn inside a split slide (`cmsc-pb-carousel__controls--al-*`, every breakpoint written). Unset, that row keeps its start alignment.
- **Arrows when everything fits.** `controls.arrowsWhenFit` keeps the controls when every slide is already on screen: both arrows disabled (taking the disabled arrow look, on a looping carousel too) and the dots hidden with their space kept. Off, the controls hide as before. `CarouselShell` takes `keepArrowsWhenFit`.
- The editor fields carry English and Polish labels.
