---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

`cms.Hero`'s overlay shows only the settings its type uses, and the order of the hero's elements and the space after each are one list.

- **Overlay.** Labelled **Overlay (darkens the background media)**; with **Type: None** it shows nothing else, **Solid** adds the strength and **Gradient** the direction and the strength (`resolveFields`, one field object per type so the editor keeps its focus). The stored `overlay` is unchanged.
- **Type, not Kind.** The media select of `cms.Hero` and `cms.MediaText` and the overlay select of `cms.Hero` and `cms.Image` are labelled **Type** (**Media type**), in English and Polish.
- **Elements: order and spacing.** An item of `order` takes `space` (a spacing token, `custom` with `spacePx`, or `default`) and `spacePx`: the space below its element, written as `spaceAfter` wrote it. `spaceAfter` leaves the panel and is deprecated: a stored list is still read for an element whose item has no space, so a stored page renders as it did, and the editor's `resolveData` carries it into `order` once — the full effective order, so nothing moves. `@endora-commerce/cms-components` exports `heroElementSpaces(order, spaceAfter)` and `carrySpaceAfterIntoOrder(props)`; `HeroOrderItem` is the item's type.

The `cms` bundle carries the English and Polish labels; the `spaceAfter` labels are gone.
