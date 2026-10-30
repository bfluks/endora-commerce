---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

Line heights, weights, sizes and spacing for the call-to-action card, stats, media and text, rich content, carousel headers, the link list, latest posts and the testimonial.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

- **Call-to-action card.** `headingSpace` (a spacing step) sets the space below the heading. `bodyWeight` and `textMaxWidth` / `textMaxWidthPx` (per breakpoint) style the text.
- **Stats.** `valueLineHeight` (per breakpoint, with a Custom value size).
- **Media and text.** `featureBodySize` / `featureBodySizePx` (per breakpoint) and `featureBodyWeight` for every feature item's text.
- **Rich content.** `textWeight`.
- **Carousel headers.** `headingLineHeight` (per breakpoint, with a Custom heading size) on the carousel, the product slider and grid, and latest posts.
- **Link list.** `titleLineHeight` (per breakpoint, with a Custom title size) for the row titles.
- **Latest posts.** `leadWeight` for the header's lead.
- **Testimonial.** `quoteSize` / `quoteSizePx` (per breakpoint).
- The editor fields carry English and Polish labels.
