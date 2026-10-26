---
'@endora-commerce/mod-seo': patch
---

The SEO meta editor routes (`GET`, `PUT`, `DELETE /api/v1/admin/seo/meta/:entityType/:entityId`) answer `404 NOT_FOUND` for an `entityId` that is not a UUID, where PostgreSQL's refusal used to surface as a 500.
