---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A link tile's resting title and label colours can differ per breakpoint. An accordion gains the space above an open panel, the space between items and a title weight.

Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

- **Colour per breakpoint field.** `@endora-commerce/page-builder-core` exports `createResponsiveColorField` (with `writeResponsiveColor` and the `ResponsiveColorProp` type): the colour control on the Responsive tab, editing the breakpoint the tab's scope selects. A breakpoint set first is stored without a base, a value with only its base is stored as a single colour, and clearing the last colour stores nothing.
- **Resting tile colours per breakpoint.** `cms.LinkTile`'s `titleColor` and `labelColor` accept a value per breakpoint as well as one colour. A single stored colour renders as before. Each breakpoint with a colour of its own writes `--pb-title-color-md` / `-lg` (and the label's) with a class that applies it from 768 / 1024 px up; a breakpoint below the first one with a colour keeps the tile's own colour. A hover colour still wins on hover and keyboard focus.
- **Accordion spacing.** `cms.Accordion` gains `panelGap` / `panelGapPx` (the space between a title, or its line, and its open panel) and `itemGap` / `itemGapPx` (the space between items), each a spacing token or a Custom px per breakpoint. A breakpoint left unset keeps today's spacing; the panel's space opens and closes with it.
- **Accordion title weight.** `cms.Accordion` gains `titleWeight` (`default` or 300–800), set on every title.
- **Labels.** The new fields are labelled in English and Polish.
