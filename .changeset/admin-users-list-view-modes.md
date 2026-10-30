---
'@endora-commerce/mod-admin-users': patch
---

`PATCH /api/v1/admin/me/preferences` now stores `listViewModes` (`specs/165-task-management/` R-14), merged per list under a row lock as `listPageSizes` is, `null` forgetting a list and at most 128 lists after the merge. Before, the key was accepted by the contract and silently not written, so a list-or-board choice was never remembered.
