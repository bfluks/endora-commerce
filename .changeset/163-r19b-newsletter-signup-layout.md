---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-newsletter': patch
---

The newsletter sign-up block gains layout options: the button inside the field, topic columns and a visually hidden e-mail label.

Unset, the form looks as before; the posted fields never change.

- `buttonPlacement: 'inside'` puts the submit button inside the e-mail field's box, with `fieldShape` rounded (default) or `pill`.
- `topicsColumns` (1–4) lays the topic checkboxes out as a grid of columns.
- `hideEmailLabel` hides the e-mail label visually; it stays the field's label for screen readers.
