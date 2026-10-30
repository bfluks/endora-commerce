---
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-core': minor
'@endora-commerce/mod-i18n': patch
---

Rich text gains a text size on selected words and more bullet-list markers.

Nothing changes for content that does not use them: a rich text saved before renders the same markup.

- **Text size.** The rich text toolbar's **Text size** sizes the selection with a type-scale step (`<span class="cmsc-fs cmsc-fs--<step>">`, sized per breakpoint by the stylesheet). It is stored as the `textSize` mark; the renderer and the sanitizer also accept a `font-size` in px from 8 to 200 on a `<span>` (`<span class="cmsc-fs" style="font-size: Npx">`), which the toolbar does not offer.
- **List marker.** A bulleted list's **List marker** is **Disc** (default), **Check mark** (as the check list before), **Chevron** or **None** (`cmsc-list--chevron`, `cmsc-list--none`).
- The server and the editor write the same markup. New `core` keys `pageBuilder.fieldText.textSize*` and `pageBuilder.fieldText.listMarker*` (English and Polish).
