---
'@endora-commerce/mod-seo': patch
---

SEO overrides per sales channel and per sales channel × language.

- Migration `20261025T215911_seo_meta_override_channel_scope.ts` adds `seo_meta_overrides.sales_channel_id`, makes `locale` nullable (at least one of the two is set) and replaces the `(entity_type, entity_id, locale)` unique with one partial unique per scope. Existing rows are language overrides, unchanged.
- `GET|PUT|DELETE /api/v1/admin/seo/meta/:entityType/:entityId` take an optional `channelId` (query for GET and DELETE, body for PUT) beside `locale`; naming neither is still the `en-US` row. Only a product takes a channel (`422 VALIDATION_FAILED` otherwise); a channel the product is not in, or a language the channel does not offer, is `422 SCOPE_INVALID` on PUT and allowed on DELETE. Each field resolves channel × language → channel → language → derived.
- Writes are the Commands `seo_meta_override.upsert` and `seo_meta_override.delete`: one audit entry per request, with the full override before and after (an update's `before` is no longer `null`); deleting nothing writes no entry. `MetaTagResolverService` takes the `commandBus` instead of an audit sink.
- New port `seoProductMetaPort` (`resolveForProduct`, `listScopesForProduct`).
