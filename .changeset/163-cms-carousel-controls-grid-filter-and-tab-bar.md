---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

The Carousel gains arrow placement per breakpoint, an arrow look, a grid layout and a category filter; carousel images gain a caption scrim, link tiles a ratio per breakpoint, and `cms.Tabs` a tab bar look.

Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

- **Arrow placement per breakpoint.** `controlsPlacement` (`'below' | 'header' | 'overlay'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`. It replaces the `placement` key inside `controls`. A placement stored there is still honoured, and the editor's `resolveData` moves it to `controlsPlacement` (`carouselPlacementMoved` in `carousel/carousel-parts`). For a stored slider, `contentSliderFromLegacy` now also writes `controlsPlacement`. `CarouselShell`'s `controlsPlacement` prop accepts a responsive value. Each placement in use is rendered once, and the stylesheet removes it where it does not apply (`cmsc-pb-carousel__controls--off-sm|md|lg`).
- **Arrow look.** `controls.arrowVariant` (`default | outline | solid`), `arrowShape` (`round | square`), `arrowSize` (`s | m | l`, 32/36/44 px) and `arrowColor` (a brand token or a hex). They map to the `CarouselShell` props of the same names, rendered as root classes and `--pb-arrow-color`.
- **Grid layout.** On the Carousel, `layout: 'carousel' | 'grid'` and `columns` (1–6, responsive). `CarouselShell` takes `layout` and `columns`: the grid is a list of items in `--pb-cols(-md|-lg)` columns, with no controls and no autoplay. In the editor, the action bar has no page navigation for a grid.
- **Filter.** The Carousel's `filter` prop is `{show, allLabel, tags: [{tag, label}]}`. Every item block and `cms.Slide` take `tags` (comma-separated keys), written as `data-pb-tags`. The new `carousel/carousel-filter` module exports `parseItemTags`, `itemTagsAttribute`, `ITEM_TAGS_FIELD`, `carouselFilterFromProps` and `CarouselFilterBar`, and `CarouselShell` takes a `filter` prop. The bar is a `toolbar` of `aria-pressed` buttons with a single tab stop and a polite count. Filtering hides items in the browser only, so every item stays in the server HTML. `filter.allLabel` and `filter.tags[].label` are declared translatable. `CmsCarouselLabelText` gains `filter`, `filterAll` and `filterCount`.
- **Caption scrim.** `cms.CarouselImage` gains `captionScrim: {kind: 'none' | 'gradient' | 'solid', strength}`, for captions placed over the image.
- **Link tile ratio.** `cms.LinkTile.ratio` may differ per breakpoint, and is listed in the block's `responsiveFields`.
- **Tab bar look.** `cms.Tabs` gains `tabStyle: {size, barBackground, barBorderColor, activeBackground, activeColor, inactiveBackground, inactiveColor}`. The colours are written as `--cmsc-tabs-*` custom properties, which fall back to today's colours. A bar background or border draws the bar, as a capsule around pills. On a narrow screen the tabs still wrap.
- **`BoxStyled`** takes an `attributes` prop for `data-*` attributes.

The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `controls.fields.placement` keys are replaced by `controlsPlacement`.
