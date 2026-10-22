---
'@endora-commerce/admin-kit': patch
---

The collapsed sidebar's fly-out is drawn over the page content again. `.b2b-sidebar` now sets `z-index: 36` — above the sticky topbar (35) and the page's sticky bars, below the mobile nav backdrop (40), the scrim, drawers and command palette (50/60). A sticky box is its own stacking context, so the fly-out's own `z-index` could never lift it above content painted later in the page.
