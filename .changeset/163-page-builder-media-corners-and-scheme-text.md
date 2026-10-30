---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

Media frames take a corner radius option, block texts and surfaces follow a section's colour scheme, and a row inside a section with a content width is no longer inset twice.

With no scheme and no new option chosen, the blocks look as they did.

- **Media corners.** `cms.LinkTile` and `cms.CarouselImage` gain `mediaCornerRadius` (**Image corners**), and `cms.Video` gains it as **Frame corners**. The values are `none | small | medium | large` (0, 4, 8 or 16 px), and the default is `medium`. The block writes the value as `--pb-media-radius`. The stylesheet reads it on the tile's media, the carousel image, the video file frame and the embed's iframe, with today's 8 px as the fallback, and a chosen value also replaces the embed frame's `rounded-lg`. The box's own `cornerRadius` on `cms.Video` is unchanged and still applies to the box only. The new helper module `utils/media-radius` exports `DEFAULT_MEDIA_CORNER_RADIUS`, `mediaRadiusPx` and `mediaRadiusVars`.
- **Scheme text.** These texts read `--cmsb-fg-muted`, with today's neutral as the fallback: `.cmsc-pb-feature-list__desc`, the product card's SKU and stock, the category count and the carousel image placeholder. An active underline tab reads `--cmsb-fg`. On the dark scheme they now meet AA contrast.
- **Scheme surfaces.** Inside `[data-cmsb-scheme]`:
  - `--cmsc-media-bg` is `transparent`, so the light backdrop behind a link tile's or a carousel image's picture gives way to the section's background.
  - `--cmsc-surface-tint` is a translucent ink: dark on the light schemes, light on the dark one. It paints empty media placeholders, category chips and the boxed tab.
  - A bordered product card takes `--cmsb-bg` and `--cmsb-border`.
  - An active pill tab inverts the scheme's colours.
- **Rows in a content frame.** The rule that puts a nested `in_flow` row of an edge-to-edge (`bleed`) section into the page container now applies only when the section has no `contentWidth`. With a content width, the section's frame already holds the content, so the row's columns line up with the other blocks.

The `cms` bundle carries the English and Polish labels of the new fields.
