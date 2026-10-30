---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-newsletter': patch
---

Icon choices and a per-breakpoint feature layout: the feature list's icon position and item widths, a newsletter sign-up button icon, and the download tile's icon button glyph.

Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

- **Feature list.** `iconPosition` takes a value per breakpoint, so the icon can sit beside the title on one breakpoint and above it on another; one stored position keeps its meaning. An item's `span` (1–12) sets its width in columns of 12 on desktops. The other items keep their share of the columns.
- **Newsletter sign-up.** `buttonIcon`, an icon from the catalog, shows after the button's label.
- **Download tile.** `iconButtonIcon`, an icon from the catalog, replaces the round icon button's glyph. Left empty, the tile shows the download arrow, or the onward arrow for a link.
- **Icon catalog.** Adds `cloudDownload`.
- The editor fields carry English and Polish labels.
