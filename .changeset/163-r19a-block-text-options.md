---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

The smaller texts of the content blocks take their own size, weight and line height.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

- **Feature list.** `bodySize` / `bodySizePx`, `bodyWeight` and `bodyLineHeight` style every item's text (by default the small, muted line); `titleLineHeight` sets the item titles' line height.
- **Hero.** The subheading and the statement take `…Weight`, `…LineHeight` and `…MaxWidth` / `…MaxWidthPx`, as the title does; the text takes `bodySize` / `bodySizePx` (Default is 16 px), `bodyWeight`, `bodyLineHeight` and `bodyMaxWidth` / `bodyMaxWidthPx`.
- **Statement.** `headingLineHeight`; the supporting text's `bodySize` / `bodySizePx`, `bodyWeight` and `bodyLineHeight`.
- **Stats.** The labels' `labelSize` / `labelSizePx` and `labelWeight`.
- **Link list.** The row titles' `titleSize` / `titleSizePx` and `titleWeight`.
- **Rich content.** `textSize` / `textSizePx` size the whole text.
- Sizes are a type-scale step or Custom (px), per breakpoint on the Responsive tab, as are line heights and maximum widths; a weight is one value. A type-scale step brings the brand's line height, weight and letter spacing for it (`--cmsb-t-<step>-lh`, `-w`, `-ls`); a line height applies, and its field shows, only at a breakpoint whose size is Custom (px). One value for every width is written inline on the text; values that differ add `cmsc-pb-ts-size`, `cmsc-pb-ts-weight`, `cmsc-pb-ts-leading` or `cmsc-pb-ts-tracking` with `--pb-ts-<name>`, `-md` and `-lg`. The labels are translated (English and Polish).
