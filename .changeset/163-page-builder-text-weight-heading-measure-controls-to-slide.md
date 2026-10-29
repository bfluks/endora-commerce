---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-blog': patch
---

Block headings and item texts gain a weight, block headings and the hero title gain a maximum width per breakpoint, the controls below a carousel can line up with its first slide, and carousels and product cards now use the brand body font.

Nothing changes for a block that does not use them: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

- **Brand body font on carousels and product cards.** `.cmsc-pb-carousel` and `.cmsc-pb-product-card` join the zero-specificity group that sets `font-family: var(--cmsb-font-body, inherit)`. The filter bar, the header lead, the controls and the card texts used to keep the storefront's font next to brand-font headings. With no brand font set they inherit the page's font, as before.
- **Text weight.** `headingWeight` (`'default' | 300 | 400 | 500 | 600 | 700 | 800`) on every block whose heading is a `BlockHeading` with a size: `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.LinkList`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, and the carousel header of `cms.ContentSlider`, `catalog.ProductGrid`, `catalog.ProductSlider` and `blog.LatestPosts`. `cms.Hero` gains `titleWeight`, and `cms.FeatureList` gains `titleWeight` for its item titles. Item texts gain `cms.CarouselImage.captionWeight` and `cms.LinkTile.titleWeight`/`labelWeight`, as a property of the `ItemText` span. The product listings gain `cardTitleWeight`, which becomes `CmsProductCardView`'s new `nameWeight`. The new `textWeightField` and `textWeightCss` helpers are in `components/typography`.
- **Heading measure.** `headingMaxWidth`/`headingMaxWidthPx` (a named measure or Custom px, per breakpoint, on the Responsive tab and in `responsiveFields`) on the same blocks except `cms.Statement`, whose `textMaxWidth` already holds its heading. `cms.Hero` gains `titleMaxWidth`/`titleMaxWidthPx`. `BlockHeading` takes `weight`, `maxWidth`, `maxWidthPx` and `align`. A held heading in a centred block stays centred (`data-align`). `section-parts` exports `blockHeadingStyleFields`, `blockHeadingStyle` and `isUnusedHeadingMaxWidthPx`.
- **Controls aligned to the first slide.** `controlsAlignTo` (`'container' | 'slide'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. It maps to `CarouselShell`'s `controlsAlignTo` and the root class `cmsc-pb-carousel--ctl-to-slide`. The rows below the track then take one slide's width, so with a bleeding track the controls end where the first slide ends.

The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.
