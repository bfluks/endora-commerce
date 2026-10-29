---
'@endora-commerce/contracts': minor
---

**BREAKING — `seoMetaOverrideSchema.locale` is `string | null`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. An override saved for a whole sales channel has no language, so a reader that typed `locale` as `string` must handle `null`; `channelId` is new and nullable beside it.

`upsertSeoMetaOverrideRequestSchema.locale` is optional and the schema gains `channelId`; new `seoMetaScopeQuerySchema` (`locale?`, `channelId?`) for the meta GET and DELETE; `seoMetaOverrideSchema` has a nullable `locale` and a nullable `channelId`. `SeoProductMetaPort` is registered as `seoProductMetaPort` by `seo`. A caller that reads `seoMetaOverrideSchema['locale']` as a string must handle `null` (a sales channel override).
