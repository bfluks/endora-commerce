---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Spacing and layout options for the media-and-text block, the background image panel, the feature list, the call-to-action card, the stats and the link list.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup. Values marked per breakpoint are written only for the breakpoints a value reaches.

- **Media and text.** `innerSpace` and `stackedGap` (spacing steps) set the space below each heading and between paragraphs, and between stacked media and text; `bodySize` / `bodySizePx` (per breakpoint) and `bodyLineHeight` size every row's text; each of `rows` takes its own `verticalAlign` (unset or `inherit` follows the block's).
- **Background image panel.** `mobileLayout: 'overlay'` lays the text over the image on phones, the image at its own height, instead of stacking them.
- **Feature list.** `rowGapPx` (per breakpoint) spaces the rows apart from the gap; `listLineHeight` (per breakpoint, with a Custom text size) for lists in an item's text.
- **Call-to-action card.** `cardPadding` (a spacing step) sets the card's padding, which an image inset measures from; a `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, from the tablet up) sets the image's width, with `layoutAdvanced` exposing the raw `imageColumns` (per breakpoint, columns of 12).
- **Stats.** `labelLineHeight` (per breakpoint, with a Custom label size).
- **Link list.** `dividerAfterLast` draws the rule under the last row too.
- The editor fields carry English and Polish labels.
