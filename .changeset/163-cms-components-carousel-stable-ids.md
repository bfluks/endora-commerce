---
'@endora-commerce/cms-components': patch
---

Carousels (`cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`) take their element ids from the block's own id instead of React's `useId()`, so the server and the browser always agree on them. `CarouselShell` gains an optional `instanceId` prop; without it the ids still come from `useId()`.
