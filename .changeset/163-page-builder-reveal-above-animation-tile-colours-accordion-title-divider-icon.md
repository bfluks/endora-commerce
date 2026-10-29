---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A "read more" passage revealed above its summary now animates. A link tile's title and label take a resting colour. An accordion gains a title colour, a divider under the title and an icon size.

Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

- **Reveal above animates.** Revealed above, the `<details>` is a flex column, so its `::details-content` kept its content height and the passage opened in one frame. Inside the existing animation block (no reduced motion, `interpolate-size` and `::details-content` supported) the stylesheet now sets `min-block-size: 0` on it.
- **Resting tile colours.** `cms.LinkTile` gains `titleColor` and `labelColor` (`#rrggbb` or `token:<role>`), the colours of the title and of the text-link label at rest. A label shown as a button keeps the button's colours. A hover colour (`titleHoverColor`, `labelHoverColor`) still wins on hover and keyboard focus. Unset, the tile's markup is unchanged.
- **Accordion title colour, divider position, icon size.** `cms.Accordion` gains `titleColor` (the trigger's colour; the icon follows it), `dividerPosition` (`'item' | 'title'`, for plain items; under the title, an item's line sits between its title and its panel) and `iconSize` (`'s' | 'm' | 'l' | 'custom'`, 16 / 20 / 24 px) with `iconSizePx`. Each is unset by default and writes nothing then.
- **Labels.** The new fields are labelled in English and Polish.
