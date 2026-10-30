---
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-tasks': patch
---

Every signed-in administrator can now read and acknowledge their own notifications on the Admin UI's bell, whatever their role. Before, the bell and its API needed `admin:read`, so a narrow role such as a sales representative had Task and CRM notifications recorded for them that they could never open.

- `@endora-commerce/mod-admin-notifications`: `GET /api/v1/admin/notifications`, `POST /api/v1/admin/notifications/:id/read` and `POST /api/v1/admin/notifications/mark-all-read` are gated on an administrator session with no permission code. `admin:read` now decides only whether the `all_admins` broadcasts are listed, counted and acknowledgeable; for an administrator without it, a broadcast's id answers `404` like any notification that is not theirs. `AdminNotificationService.listForAdmin`, `markRead`, `markAllRead` and `countUnreadForAdmin` take a required `includeBroadcasts` flag. The module now depends on `admin_roles`, whose permission service answers that question. The permission's label is now *View notifications sent to all admins*.
- `@endora-commerce/admin-shell`: the header shows the notification bell to every administrator while the Admin notifications module is on.
- `@endora-commerce/mod-i18n`: the English and Polish labels of `admin:read` follow the new meaning.
- `@endora-commerce/mod-tasks`: the module page says that every administrator reads their own notifications without a permission.
