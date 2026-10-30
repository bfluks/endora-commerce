---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

Layout options for the hero, the feature list, the statement, the stats, the call-to-action card and the media-and-text block.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

- **Hero.** `gaps` (Space between items) offers Custom (px) with `gapsPx`, per breakpoint; before, a value other than a spacing step was ignored. With image or video media above the content, `mediaSpace` / `mediaSpacePx` set the space between the media and the texts (none by default), as `--cmsc-hero-media-space`.
- **Feature list.** `innerSpace` (a spacing step) sets the space after the icon, below the title and between paragraphs (today's 8 px and 4 px by default). `iconPosition: 'beside'` puts the icon beside the title, the title and the text hanging beside it (`data-icon-position="beside"`).
- **Statement.** Over a background image, `minHeight` (Default is today's 60 % of the screen's height; Auto, half, three quarters, the full screen or Custom px with `minHeightPx`), per breakpoint.
- **Stats.** Beside an image, from the tablet up, a `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5) places the image and the figures on a 12-column grid (mirrored for an image at the end); `layoutAdvanced` exposes the raw `imageSpan`, `figuresSpan` and `figuresOffset` instead; and `figuresAlign` puts the figures at the top, the bottom or spreads them over the image's height.
- **Call-to-action card.** `cardRadius` (Default keeps today's 12 px; none, small, medium, large) and `imageInset` (`none` takes the image to the card's edges, `custom` with `imageInsetPx`).
- **Media and text.** `sideBySide: 'desktop'` keeps media and text stacked on a tablet and places them side by side from 1024 px; unset is today's 768 px.
