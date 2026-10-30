---
'@endora-commerce/mod-crm': minor
---

Opportunity attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Opportunities a reader may not see — those outside their Organization reach, or every one without `crm:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/crm/opportunities/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the existing refusals.
