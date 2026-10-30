---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A `cms.Column` can take another place in its Row per breakpoint, `cms.MediaText` item titles take a size and a weight, the carousel's filter bar can stay in one scrolling line, and a video's mobile version can have its own poster.

Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

- **Column order per breakpoint.** `cms.Column` gains `stackOrder`, labelled **Order in the row**: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. It is the vocabulary a block in a column already has. The published column cell writes it as `data-pb-order` and `--pb-order(-md|-lg)`, which the existing order rule reads as the CSS `order` of the Row's grid item. Only the visual order changes: the DOM, reading and focus order stay the stored order. The editor canvas keeps the stored order. `cms.Row` is unchanged. `@endora-commerce/page-builder-core` exports `createStackOrderField(label)` and `stackOrderAttributes(value)`, which `withHideOn` now uses too.
- **Item titles in media and text.** `cms.MediaText` gains `featureTitleSize` (Default, a type-scale size or Custom px, per breakpoint), `featureTitleSizePx` and `featureTitleWeight` (Default or 300–800), applied to the item titles of every row. Unset, the titles keep their 16 px semibold look and markup. A choice wraps the title text in `span.cmsc-pb-media-text__feature-title-text`.
- **Scrolling filter bar.** The carousel's `filter` gains `overflow: 'wrap' | 'scroll'`. Unset, the bar wraps as before. `scroll` adds `cmsc-pb-carousel__filter--scroll`: one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The toolbar, its pressed state and its keys are unchanged. A button pressed with the pointer is scrolled into the bar's view.
- **Mobile poster.** `cms.Video` (file source) and the video media of `cms.Hero` and `cms.MediaText` (and `cms.CarouselSplit`, which shares it) gain `mobilePosterAssetId` and `mobilePosterUrl`. The library image wins over the URL, and a relative URL is made absolute against the media origin. The mobile video takes it. One video with its own mobile poster renders the same file once per breakpoint, each with `preload="none"`. The admin's hero and media-and-text controls and the video's fields offer a library picker and a URL input.

The `cms` bundle carries the English and Polish labels.
