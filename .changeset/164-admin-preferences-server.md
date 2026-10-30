---
'@endora-commerce/mod-admin-users': minor
---

Administrators' Admin UI preferences are kept on the server (feature 164).

- **New table `admin_user_preferences`** (migration `Migration20261027T160234AdminUsersAdminUserPreferences`): one row per administrator and preference, removed with the administrator row; kept when an administrator is deactivated or soft-deleted.
- **Three routes, for the signed-in administrator only**: `GET` and `PATCH /api/v1/admin/me/preferences` and `POST /api/v1/admin/me/preferences/legacy-import`. They need a session and no permission code, and no route takes an administrator id, so nobody — the wildcard role included — can read or change another administrator's preferences. A `PATCH` replaces each sidebar preference it names and merges page sizes per list (`null` forgets a list); the import adds only the lists the server does not hold. An invalid body is `400 VALIDATION_FAILED` with nothing written. No audit entry is written: these are personal UI settings, not business records.
- **`GET /api/v1/admin/me` carries `preferences`**, so the Admin UI opens already pinned, folded and in rail mode. If the preferences cannot be read, the field is `null` and sign-in still succeeds.
