---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The download tile gains look options: a colour scheme, background, border, corners, padding, title size, a full hover image and a round icon button.

Unset, the tile looks as before (a light, bordered 8 px card with a type badge and a text label) and stays one download link.

- `scheme` (light, muted or dark, on the tile itself), `cardBackground`, `cardBorder`, `cornerRadius`, `cardPadding` (a spacing step) and, per breakpoint, `titleSize` (a type-scale step or Custom with `titleSizePx`; a `titleSizePx` stored without a size reads as Custom); `showType: false` hides the file type badge.
- `hoverImageLook: 'full'` shows the hover image in full under a dark gradient, the text turning white (the default stays the faint tint).
- `linkLook: 'icon'` draws the link as a round 48 px download button pinned to the bottom end, ringed in the text colour; the link label stays in the link for screen readers.
