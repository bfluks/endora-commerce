---
'@endora-commerce/mod-projects': minor
---

Project attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Projects a reader may not see — by membership and `projects:read`, the rule the Projects screens use. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/projects/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
