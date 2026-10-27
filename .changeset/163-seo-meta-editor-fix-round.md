---
'@endora-commerce/mod-seo': patch
---

The SEO screen's meta-tag editor loads a scope as soon as it is selected (Load refreshes it), keeps the channel and language selectors disabled while a request is in flight and ignores an answer for a scope no longer selected, so an override can only be saved to the scope on screen. Switching away from unsaved changes and **Use inherited** now ask first; for a product the editor waits for the product's sales channels. The screen opens with an entity selected when its address carries `?entityType=product&entityId=<id>`, which is where the product editor's SEO link now points; an `entityId` that is not a UUID is ignored, and the editor encodes the id in every request path it builds.
