---
'@endora-commerce/mod-tasks': minor
---

Task attachments are reader-restricted references (`specs/166-asset-reference-visibility/`): the asset library hides a file used only by Tasks a reader may not see — private, draft, or of a context record hidden from them — by the rule the Tasks screens use, including `tasks:read`. Every attachment reference is tagged with its `assetId`. Attaching an existing library file (`POST /api/v1/admin/tasks/:id/attachments`) asks the library first whether the caller may see it, and answers a hidden file exactly as a missing one (`422`), before the private-file and active-content refusals.
