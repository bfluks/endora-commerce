---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': patch
---

More layout and typography choices on existing page-builder blocks; with none of them chosen, every block renders as before.

- `cms.Hero` gains `order`, a list of its elements (eyebrow, title, subheading, statement, text, buttons, social proof) rendered in that order, with the unlisted ones following in the default order, and `mediaWidth: 'content' | 'viewport'`, which lets image or video media reach the window's edges while the texts stay in the hero. Buttons or the social proof placed before another element keep a 20 px space below them.
- `cms.Accordion` gains `titleLevel` (`none`, `h2`–`h6`: the trigger button inside that heading) and `titleSize` / `titleSizePx` (a type-scale token or Custom px, per breakpoint). Unset, the triggers are bare buttons with today's title.
- `cms.Text`, `cms.Statement` and `cms.RichContent` gain `textMaxWidth` / `textMaxWidthPx`: a narrow, medium or wide measure or a Custom px per breakpoint, which follows the text's alignment. Unset, the text spans its column.
- `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardTextLine` (`default`, `summary`, `sku`, `none`), the one line under each card's name; `default` keeps the card style's own (the SKU, or the summary on the showcase card). `CmsProductCardView` accepts `textLine`.
- The dark scheme's decorative backdrop is documented and tested as an animated SVG: each Section paints its own copy, and reduced motion is the SVG's own media query.

`@endora-commerce/mod-cms` and `@endora-commerce/mod-catalog` add the field labels in English and Polish; in the page editor, a list whose item is a single choice is summarised by that choice's translated label.
