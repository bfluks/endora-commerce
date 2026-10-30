---
'@endora-commerce/contracts': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
---

Brand settings: desktop sizes that grow with the window, and button heights in the tier scale.

All optional; a stored set without them parses as before and `brandTokensToCss` writes the same CSS byte for byte.

- `tierScale.fluidDesktop` with `tierScale.fluidUntilPx` (else `layout.containerMaxPx`): from 1280 px, each desktop type size and spacing step is `clamp(<px × factor>px, <px × 100 / end>vw, <px>px)`, rising from the small-desktop factor to the full size. Needs a small-desktop factor below 1.
- `tierScale.buttons: true` scales `--cmsb-btn-h-s|m|l` in the tablet, small-desktop and fluid blocks; icon-only and pill buttons follow.
- The **Brand** screen's Layout card offers each one (empty or off stores nothing), with English and Polish labels.
