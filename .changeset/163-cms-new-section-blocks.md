---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

New page-builder blocks for marketing pages, and ready-made sections in the editor.

- `cms.MediaText` — rows of image or video beside a heading, rich text and buttons, with the split ratio, side, mobile order and vertical alignment per row.
- `cms.BackgroundPanel` — content over a full-width, art-directed background image with an icon, heading, text and buttons; minimum height per breakpoint.
- `cms.CtaCard` — a call-to-action card with an optional image side and decorative backdrop.
- `cms.Statement` — a large statement heading and body, optionally full-bleed when it carries an image.
- `cms.LinkList` — up to 50 rows of a title, a description and a button, with dividers.

Each is exported from `@endora-commerce/cms-components` (`MediaText`, `BackgroundPanel`, `CtaCard`, `Statement`, `LinkList`, with their props types). `@endora-commerce/mod-cms` declares them, their translatable fields and their English and Polish labels.

The page editor of `@endora-commerce/mod-cms` adds a *Ready-made sections* group above the block list: a hero, media with text, a call-to-action card, a downloads carousel, a feature grid and a statement, each one `cms.Section` holding its block, inserted after the selected block's top-level Section (or at the end of the page). The preset trees are `SECTION_PRESETS` in `@endora-commerce/cms-components/editor/section-presets`.
