---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The carousel split slide takes its layout, corners and text look.

Nothing changes for content that does not use them: every new option is optional, and a split slide saved before renders the same markup.

- **Breakpoint.** `sideBySide: 'desktop'` keeps the media and the text stacked on a tablet and places them side by side from 1024 px (`data-side-by-side="desktop"`); unset is today's 768 px.
- **Columns.** A `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5), or with `layoutAdvanced` the raw `mediaSpan`, `textSpan` and `textOffset`, places the media and the text on a 12-column grid with columns between them (`.cmsc-pb-carousel-split--columns`, `--cmsc-split-media-col`, `--cmsc-split-text-col`), mirrored for media at the end; unset keeps two equal halves 40 px apart.
- **Corners.** `mediaCornerRadius` (none, small, medium, large) rounds the media; unset is today's 8 px.
- **Title and text.** `titleSize` / `titleSizePx`, `titleLineHeight`, `bodySize` / `bodySizePx` and `bodyLineHeight` per breakpoint (a line height with a Custom size), `titleWeight` and `bodyWeight`. `titleHangingIcon` hangs a title that starts with an inline icon beside it.
- The editor fields carry English and Polish labels.
