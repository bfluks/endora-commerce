---
'@endora-commerce/contracts': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

Brand settings: a type and spacing scale for tablets and small desktops.

The brand tokens take an optional `tierScale` with a `tablet` and a `smallDesktop` factor (0.5–2). `brandTokensToCss` then rebinds every type size and spacing step from 768 to 1023 px to the mobile value times the tablet factor, and from 1024 to 1279 px to the desktop value times the small-desktop factor. The gutters and the container are not scaled, nor are sizes a block sets in its own pixels.

Without factors (or with 1) the CSS output is byte for byte what it was, and a stored set without `tierScale` parses as before. The **Brand** screen offers both factors in its Layout card, empty meaning 1, with English and Polish labels.
