---
'@endora-commerce/cms-components': patch
---

A hero's social-proof caption placed below the image now always starts a line of its own.

With the caption below the image at a breakpoint and a custom caption max width, a caption narrow enough to fit beside the image stayed beside it: the max width capped the full-width basis that was meant to break the line. The row now breaks before the caption whatever its width, and the max width still holds the caption to its measure. The space between the image and the caption is unchanged. Stylesheet only; the markup is the same.
