---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Column layouts and stacking breakpoints for the media-and-text block, the call-to-action card, the stats and the carousel split slide.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup. Values marked per breakpoint are written only for the breakpoints a value reaches.

- **Media and text.** With `layoutAdvanced` on, `mediaSpan`, `textSpan` and `textOffset` lay every row on a 12-column grid from the side-by-side breakpoint, in place of the split preset, mirrored on rows with the media at the end.
- **Call-to-action card.** With an image: `mobileImagePosition: 'below'` puts the image after the text while the card is stacked; `sideBySide: 'desktop'` keeps the card stacked on tablets; `imageInsetPx` keeps one value.
- **Stats.** With an image, `sideBySide: 'desktop'` stacks the image above the figures on tablets.
- **Carousel split slide.** `bodyIndent: 'title'` starts the text where a hanging title's text starts, after its leading icon; `stackedGap` and `innerSpace` (spacing steps) set the space between stacked media and text, and below the title and above the slide's carousel controls.
- The editor fields carry English and Polish labels.
