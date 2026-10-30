---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': patch
---

The hero gains a title line height, an eyebrow colour, an eyebrow that can serve as a label and a social-proof caption placement and measure.

Unset, the hero renders as before.

- `titleLineHeight` per breakpoint (with a Custom title size); `eyebrowColor` over the hero's `textColor`, which colours every other text.
- `eyebrowSize` (a type-scale step or Custom with `eyebrowSizePx`; an `eyebrowSizePx` stored without a size reads as Custom) and `eyebrowLineHeight` (with a Custom size) per breakpoint, and `eyebrowUppercase: false` for an eyebrow in its own case; the space after it is its item's in the element order.
- `proofCaptionPlacement` (`beside` or `below`, per breakpoint) and `proofCaptionMaxWidthPx` per breakpoint.
