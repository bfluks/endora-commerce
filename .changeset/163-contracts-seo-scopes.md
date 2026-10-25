---
'@endora-commerce/contracts': minor
---

`upsertSeoMetaOverrideRequestSchema.locale` is optional and the schema gains `channelId`; new `seoMetaScopeQuerySchema` (`locale?`, `channelId?`) for the meta GET and DELETE; `seoMetaOverrideSchema` has a nullable `locale` and a nullable `channelId`. `SeoProductMetaPort` is registered as `seoProductMetaPort` by `seo`. A caller that reads `seoMetaOverrideSchema['locale']` as a string must handle `null` (a sales channel override).
