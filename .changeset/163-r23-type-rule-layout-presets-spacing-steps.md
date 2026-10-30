---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Page builder: one typography rule, 12-column layout presets and spacing steps.

Content saved before these options renders the same markup.

- **Typography.** A text sized by a type-scale step takes the brand's line height, weight and letter spacing for that step (`--cmsb-t-<step>-lh`, `-w`, `-ls`, with the built-in values as fallbacks; new class `cmsc-pb-ts-tracking`). A block's own line height applies, and its field shows, only at a breakpoint whose size is Custom (px). The text weights added in this release are one value.
- **Layout presets.** The carousel split slide, the stats and the call-to-action card take a `layout` preset for their 12-column grid (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5; the card offers the first five), the media first and mirrored with its side. `layoutAdvanced` (also on the media-and-text block, whose `split` stays its preset) shows the raw column numbers, which then win; raw numbers saved without the switch read as on.
- **Spacing steps.** `innerSpace`, `stackedGap`, `cardPadding` and `headingSpace` take a spacing step (None, XS to XXL) from the brand's spacing scale.
- **Size selects.** The hero's eyebrow, the download tile's title and the image caption take a size select (a type-scale step or Custom); a Custom px saved without a size reads as Custom.
- The editor fields carry English and Polish labels.
