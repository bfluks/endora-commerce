---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': patch
'@endora-commerce/mod-i18n': patch
---

A colour that inherits the surrounding text colour shows as **Inherited (text color)** in the colour field instead of the raw `currentColor`.

- `createColorField({ label, inherit: true })`: the field's empty state is `currentColor`. It shows an empty box with the **Inherited (text color)** placeholder and a swatch marked as inherited; picking a colour sets it, and **Inherit** (or emptying the box) returns to `currentColor`. Stored values are unchanged.
- `cms.Icons` **Color** and `cms.Social` **Icon color** use it; a new icon or social list still stores `currentColor`.
- Any colour field shows a stored `currentColor` or `inherit` as inherited, and the empty box's `transparent` placeholder is translated. New `core` keys `pageBuilder.fieldText.color.inherited`, `.inherit`, `.inheritFor` and `.transparent` (English and Polish).
