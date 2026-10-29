---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

An accordion's title weight can differ per breakpoint, and the space below an open panel and after an open item can be set.

Nothing changes for content that does not use them: the default markup and look are the ones the block had.

- **Title weight per breakpoint.** `cms.Accordion`'s `titleWeight` accepts a value per breakpoint as well as one weight, on the Responsive tab. A single stored weight renders as before (an inline weight on every title). Weights that differ write `--cmsc-acc-title-weight` / `-md` / `-lg` on the root with the class `cmsc-pb-accordion--title-weight`; a breakpoint without a weight of its own keeps the usual weight.
- **Space below an open panel.** `panelPaddingBottom` / `panelPaddingBottomPx`: a spacing token or a Custom px per breakpoint for the space under an open panel's content (12 px when unset). It opens and closes with the panel.
- **Space after an open item.** `openItemGap` / `openItemGapPx`: a spacing token or a Custom px per breakpoint, used instead of the item gap after an item whose panel is open (a breakpoint left unset uses the item gap). It follows the panel's animation.
- **Labels.** The new fields are labelled in English and Polish.
