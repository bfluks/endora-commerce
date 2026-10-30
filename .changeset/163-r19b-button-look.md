---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The Button block gains a transparent outline and a border colour.

- `cms.Button`'s outline fill keeps the section's background behind it, as before (it is the look of the `secondary` button it replaced). `transparentOutline` lets the background show through instead.
- `borderColor` (a hex or brand colour) replaces the fill's border, for example a ring of its own around an icon-only outline button.
- `ButtonView` takes an optional `look` (`transparentOutline`, `borderColor`); without it it renders as before.
