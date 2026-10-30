---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A `cms.Column` can span rows of its Row's grid and start at a given column or row track, per breakpoint.

Nothing changes for a page that does not use it: an unplaced column keeps its markup byte for byte, and its Row keeps its layout.

- **Fields.** `cms.Column` gains three fields on the Responsive tab, all unset by default:
  - `rowSpan` (**Height in rows**, 1–4);
  - `columnStart` (**Start at column**, `'auto'` or `'1'`–`'12'`);
  - `rowStart` (**Start at row**, `'auto'` or `'1'`–`'4'`).
- **Markup.** A placed column's published cell writes `data-pb-place` and `--pb-col-start(-md|-lg)`, `--pb-row-start(-md|-lg)` and `--pb-row-span(-md|-lg)` beside its span variables. A missing breakpoint takes the one below it. A start that would run past the twelfth track at that breakpoint's width is moved left so the column fits.
- **Stylesheet.** The stylesheet places the cell per breakpoint. A Row holding a placed column packs its grid densely (`grid-auto-flow: row dense`, through `:has()`), so a column given only a start column takes the first free row of that track.
- **Example.** A side column with an item at its bottom next to two tall columns on desktop can stack in the stored order on a phone without duplicating content.
- **Visual only.** The DOM, reading and focus order stay the stored order. The editor canvas keeps the stored order and the span only. `cms.Row` is unchanged.

The `cms` bundle carries the English and Polish labels.
