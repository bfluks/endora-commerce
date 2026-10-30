---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

`cms.Column` gains **Background outset (px)** (`outsetPx`, per breakpoint, Responsive tab). Set above 0, the column cell carries `data-pb-outset` and `--pb-col-outset(-md|-lg)`; its box — background, border and shadow — reaches that far past the column track on each side, and the box's content layer is padded back so the content stays in place. Unset or 0 everywhere, the column renders as before. `@endora-commerce/mod-cms` lists `outsetPx` among the Column's `responsiveFields`, with English and Polish labels.
