---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

Rich-text check and chevron list markers can take a colour of their own.

`cms.RichContent` gains `listMarkerColor`; the markers read `--cmsc-list-marker`. Unset, a check stays the brand's primary colour and a chevron the text's, so stored lists look as before.
