---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Text options for the media-and-text block, the call-to-action card, the heading, rich content, the accordion, the download tile and the image.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

- **Media and text.** `headingLineHeight` (per breakpoint, with a Custom heading size), `bodyWeight`, and `listMarkerColor` for the check and chevron lists in every row's text.
- **Call-to-action card.** `bodySize` / `bodySizePx` (per breakpoint) size the text and its list.
- **Heading.** `textMaxWidth` / `textMaxWidthPx` (per breakpoint), the measure the other text blocks have.
- **Rich content.** `listLineHeight` (per breakpoint, with a Custom text size).
- **Accordion.** `titleLineHeight` (per breakpoint, with a Custom title size).
- **Download tile.** `titleWeight`.
- **Image.** With a mobile image, `desktopFrom: 'desktop'` keeps it on tablets too, as image fields already allow.
- The editor fields carry English and Polish labels.
