---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

A link tile's title and label weight, and a carousel image's caption weight, can differ per breakpoint.

Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

- **Weight per breakpoint.** `cms.LinkTile`'s `titleWeight` and `labelWeight` and `cms.CarouselImage`'s `captionWeight` accept a value per breakpoint as well as one weight, on the Responsive tab. A single stored weight renders as before (an inline weight on the text). Weights that differ write `--pb-item-weight` / `-md` / `-lg` on the text with the class `cmsc-pb-item-weight`; a breakpoint without a weight of its own keeps the usual weight.
- **Editor.** The three fields move to the responsive group of each block's field list; their labels and options are unchanged.
