---
'@endora-commerce/cms-components': patch
---

Two visible fixes in the page builder's stylesheet.

- **Hero social proof.** The social-proof image keeps its 40 px height. The generic picture rule, later in the stylesheet, made it its natural size and cropped it.
- **Gradient highlight.** A gradient highlight that wraps onto several lines is one gradient across the whole phrase; before, the gradient started again on every line. A highlight on one line looks as before. This changes how wrapped gradient highlights already on pages look.
