---
"@endora-commerce/mod-product-visibility-rules": minor
"@endora-commerce/contracts": minor
---

A saved product rule can be read and its conditions edited (spec 193, T103). `@endora-commerce/mod-product-visibility-rules` adds `GET /api/v1/admin/product-visibility/product-rules/:id` (`product_visibility:read`; the rule's definition, version as `ETag`, and the sales channels it governs). `POST …/website-rules/previews` now honours `If-Match`: a preview of a rule that changed since the version read answers `409 VERSION_CONFLICT`. The website rules screen opens a saved rule in the rule editor: a rule that governs no channel saves directly; one that governs a channel changes only through a preview of each channel's joining and leaving products, confirmed by the administrator. Choice options show by their label in the admin's language. **Breaking for `@endora-commerce/contracts` consumers of `productRuleAttributesResponseSchema`**: `options` is now `Array<{ key, labelDefault, label }>` instead of option keys; it adds `productRuleDetailSchema` / `ProductRuleDetail`.
