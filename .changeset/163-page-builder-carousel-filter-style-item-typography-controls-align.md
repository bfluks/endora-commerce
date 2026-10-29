---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

The Carousel's filter bar gains an underlined-tabs style and an alignment, the controls below a carousel gain an alignment per breakpoint and the next arrow a style of its own, and carousel images and link tiles gain a text size and font, with a label style for link tiles.

Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

- **Filter bar style and alignment.** The Carousel's `filter` gains `style: 'pills' | 'underline'` and `align: 'start' | 'center' | 'end'`. `carouselFilterFromProps` passes both through, `CarouselFilterBar` takes `variant` and `align`, and the new `filterBarClassName` writes `cmsc-pb-carousel__filter--underline` and `--align-center|end`. Both looks are the same `toolbar` of `aria-pressed` buttons with a single tab stop.
- **Controls alignment.** `controlsAlign` (`'center' | 'start' | 'end' | 'between' | 'split'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. `CarouselShell` takes `controlsAlign` and writes root classes `cmsc-pb-carousel--ctl-<value>` and `--ctl-md|lg-<value>` only where the value changes. `split` puts the previous and next arrows at the two ends of the row with the dots centred between them. The DOM order of the controls does not change.
- **The next arrow's own style.** `controls.nextArrowVariant` (`'same' | 'default' | 'outline' | 'solid'`) maps to `CarouselShell`'s `nextArrowVariant`, a root class `cmsc-pb-carousel--next-arrow-<variant>`. Both arrows keep their markup; shape, size and colour stay shared.
- **Carousel caption typography.** `cms.CarouselImage` gains `captionSize` and `captionSizePx` (a type token or Custom px, per breakpoint, on the Responsive tab) and `captionFont` (`'default' | 'heading' | 'body'`). A chosen size or font wraps the caption's text in `cmsc-pb-carousel-image__caption-text`.
- **Link tile typography and label style.** `cms.LinkTile` gains `titleSize`/`titleSizePx`/`titleFont`, `labelSize`/`labelSizePx`/`labelFont` and `labelStyle` (`'link' | 'button' | 'none'`). A button label is a `span` carrying the primary button's classes (`cmsc-pb-link-tile__button`) inside the tile's single link.
- **Shared helper.** The new `components/item-text` module exports `ItemText`, `itemFontField` and `itemFontFamily`.

The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.
