---
'@endora-commerce/contracts': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

`cms.Section` takes its width per breakpoint, and a custom width may be wider than the page container.

- `@endora-commerce/contracts`: `sectionSettingsSchema.width` is `responsiveSchema(sectionWidthSchema)` (a single width still parses as it is). `SECTION_OUTSET_PX_MAX` (400, the Column's background outset limit) is exported from `page-builder-values`. A consumer reading `SectionSettings['width']` now gets `Responsive<SectionWidth>`.
- `@endora-commerce/page-builder-core` re-exports `SECTION_OUTSET_PX_MAX`.
- `@endora-commerce/cms-components`: the Section's **Width** moves to the Responsive tab. When the breakpoints agree, the markup is unchanged (`data-width="<width>"`); when they differ, the section carries `data-width="tiered"` and each tier's box and frame as `--cmsc-section-box-*` / `--cmsc-section-frame-*` (`-md`, `-lg`). A custom width wider than the page container now widens the section, centred, up to the viewport less the gutters; it used to be capped at the container.
- `@endora-commerce/mod-cms` lists `width` among the Section's `responsiveFields`, with English and Polish labels.
