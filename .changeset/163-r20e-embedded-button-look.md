---
'@endora-commerce/contracts': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-i18n': patch
---

Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

- `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
- A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
- A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
- `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).
