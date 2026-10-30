---
'@endora-commerce/cms-components': patch
---

A row's vertical alignment now applies on published pages, and a call-to-action card's two-column list follows the card's side-by-side breakpoint.

- **Row.** Columns no longer stretch themselves, so **Align columns** (top, middle, bottom) places them on the storefront as it does in the editor. A row left on stretch, the default, looks the same. A stored `'center'` (the media-and-text wording) is read as `'middle'`.
- **Call-to-action card.** With `sideBySide: 'desktop'`, a two-column list stays in one column on tablets while the card is stacked. Cards side by side from the tablet keep two columns from 768 px.
