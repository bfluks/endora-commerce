---
'@endora-commerce/contracts': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

`cms.Section` can overlap the section before it, and an empty Section no longer leaves a blank band.

- `@endora-commerce/contracts`: `sectionSettingsSchema` gains an optional `overlap`, a spacing token or a pixel value per breakpoint (`Responsive<SpaceValue>`). Unset means no overlap.
- `@endora-commerce/page-builder-core`: `createSectionSpaceField` takes an optional `defaultValue` (`SectionSpaceFieldOptions`). It is the value shown, inherited and seeded until one is set. It stays `'l'` unless given; the overlap uses `'none'`.
- `@endora-commerce/cms-components`: `cms.Section` gains the **Overlap with the previous section** field on the Responsive tab. When an overlap is set, the section carries `data-overlap` and `--cmsc-section-overlap(-md|-lg)`. The stylesheet then pulls its content frame up by that amount, above the previous section's background (`z-index: 1`). The section's own background stays in place, and the page's first block is never pulled. The editor canvas does not move the content. Instead, a hatched band shows the overlap of the previewed breakpoint.
- A published Section whose blocks all render nothing loses its padding, minimum height and pull-up. Examples are a news list with no posts, or blocks hidden at that breakpoint. A CSS `:has()` rule decides this, so the markup of a non-empty Section is unchanged. A Section with an image or video background keeps its size. Browsers without `:has()` keep the padding, as before.
- `@endora-commerce/mod-cms` lists `overlap` among the Section's `responsiveFields`. The field has English and Polish labels.
