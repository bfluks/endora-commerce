---
'@endora-commerce/mod-catalog': minor
---

A queued product bulk operation re-checks its requester when the worker starts it: the admin who queued it must still be an active administrator holding `catalog:write`, else the operation fails without writing any product. `catalog` now declares `admin_roles` in `dependencies` and resolves its `permissionService` port; `CatalogModuleOptions.permissionChecker` is the new optional option.
