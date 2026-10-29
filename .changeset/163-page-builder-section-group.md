---
'@endora-commerce/contracts': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

A new `cms.SectionGroup` block holds a run of Sections and paints one background behind all of them, so the decorative backdrop no longer shows a seam at every Section boundary.

- `@endora-commerce/contracts`: `sectionGroupSettingsSchema` and `SectionGroupSettings` describe the group's props: `anchor`, `scheme` (default `inherit`), `background`, and `spaceTop` / `spaceBottom` per breakpoint (default `none`).
- `@endora-commerce/page-builder-core`:
  - `ROOT_ONLY_TYPES` now lists `cms.SectionGroup` beside `cms.Section`.
  - `shouldRevertPuckAction` lets a Section into a group's `content` slot and reverts anything else dropped there. The new exports are `SECTION_GROUP_TYPE`, `SECTION_GROUP_CHILD_TYPES` and `isSectionGroupContentZone`.
  - A move out of a slot zone now reads the moved block's type from its parent's slot prop.
  - `collectAnchors` lists a top-level group's anchor and the anchors of the Sections in it.
- `@endora-commerce/cms-components`:
  - `cms.SectionGroup` (`SectionGroup`, `SECTION_GROUP_RESPONSIVE_FIELDS`, `SECTION_GROUP_SLOT_ALLOW`) is a top-level block whose slot accepts only `cms.Section`. Its fields are Colour scheme, Background (with the decorative backdrop), Anchor, and Space above / Space below on the Responsive tab.
  - It renders through the new `SectionGroupFrame`: a `.cmsc-section-group` wrapper with one `.cmsc-section-group__paint` layer across the window behind all its Sections.
  - A Section in a group renders as a top-level Section (`data-in-group`). It inherits the group's scheme unless it sets its own. While the group paints, a Section with no background of its own and no other scheme is transparent (`data-transparent`).
  - The first Section of a group can overlap the block before the group.
  - An empty group drops its own spacing, as an empty Section does.
  - The hero's lead-image lookup sees through a first group.
  - Every other slot (Section, Column, Slide, tab and accordion panels) refuses the group.
- `@endora-commerce/mod-cms`:
  - The manifest declares `cms.SectionGroup` in the `layout` palette, with English and Polish labels.
  - The anchor guard counts a top-level group's anchor and its Sections' anchors.
  - A section preset inserted while a block inside a grouped Section is selected goes into that group.
