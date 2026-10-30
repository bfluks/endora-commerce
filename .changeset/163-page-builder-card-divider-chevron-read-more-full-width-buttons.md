---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': patch
---

Product cards in listings can take an image box colour and a divider, a rich-text "read more" can open with a bare chevron, and buttons can span the full width per breakpoint.

Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

- **Card image box and divider.** `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardImageBackground` (a brand colour token or a hex value), `cardDivider` (`'none' | 'line'`) and `cardDividerColor`, which is shown only for a line. A colour is written as the image box's inline background. A line adds `cmsc-pb-product-card--divider`, a 1 px bottom border in the chosen colour or the neutral border colour; a showcase card also gets 16 px of padding above the line.
- **Read more as a chevron.** The rich-text `readMore` node gains `summaryStyle` (`'text' | 'chevron'`, `'text'` by default). `chevron` adds the class `cmsc-read-more--chevron` to the `<details>`, the same through the DOM-free serializer and TipTap's, and is parsed back from it. The sanitiser is unchanged. The stylesheet turns the summary into a 44 px chevron control: its text stays as the accessible name, out of view. The rich-text toolbar gains **Read more as a chevron**.
- **Full-width buttons per breakpoint.** `cms.Button` gains `fullWidth` (`'auto' | 'full'`, or one per breakpoint), a top-level prop on the Responsive tab. `cms.Hero`, `cms.MediaText`, `cms.CtaCard`, `cms.BackgroundPanel` and `cms.CarouselSplit` gain the block-level `buttonsFullWidth`, which stacks their buttons at the full width; `ButtonSpec` is unchanged. Both are listed in `responsiveFields`. The phone's width writes `cmsc-btn--full` on a button or `cmsc-btn-list--full` on a list; a larger breakpoint whose width differs adds a `--md-*` or `--lg-*` class.

The `cms` and `catalog` bundles carry the English and Polish field labels.
