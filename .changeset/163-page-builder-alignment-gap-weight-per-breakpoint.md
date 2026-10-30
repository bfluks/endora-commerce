---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-blog': minor
---

Alignment, gaps and text weights are set per breakpoint, beside each other on the Responsive tab, in every block that has them.

Nothing changes for a stored page: a value stored as one alignment, one gap or one weight applies at every width and renders as before.

- **Alignment** of `cms.Icons`, `cms.Social`, `cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero` and `cms.Tabs` is per breakpoint and reads **Left / Center / Right** (the tabs' third is **Stretch**). Alignments that differ write `data-align-md` / `data-align-lg` (and the classes the stylesheet reads); one alignment keeps today's markup.
- **Gaps** of `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and `catalog.CategoryGrid` are a spacing step or **Custom gap (px)**, per breakpoint. A gap stored as a number reads as Custom with that number (`numericGapAsCustom`, carried by `resolveData`); gaps that differ go on `cmsc-pb-gap-tiers`. The grids' **Equal items height** is per breakpoint too, next to the columns and the view.
- **Weights** — every block heading's, the feature list's and the hero's title weight and the media-and-text item title weight — are per breakpoint, right after the size. Weights that differ wrap the text in one `cmsc-pb-item-weight` span (`responsiveWeightProps`, `WeightSpan`); one weight stays the inline `font-weight`.
- The registry's and the manifests' `responsiveFields` list the new responsive props.
