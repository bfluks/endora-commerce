---
'@endora-commerce/contracts': minor
---

Per-administrator Admin UI preferences (feature 164).

- **New `admin-preferences` exports.** `ADMIN_PREFERENCE_KEYS` — the closed set `sidebarPins`, `sidebarCollapsedGroups`, `sidebarRailMode`, `listPageSizes`; the write schemas `adminPreferencesPatchSchema` (strict: an unknown preference, a wrong shape, a duplicate or a value beyond a bound is refused) and `adminPreferencesLegacyImportSchema`; the tolerant read schema `adminPreferencesSchema`, `adminPreferencesResponseSchema` and `ADMIN_PREFERENCES_DEFAULTS`; the bounds `ADMIN_SIDEBAR_PINS_MAX` (200), `ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX` (32) and `ADMIN_LIST_PAGE_SIZES_MAX` (128); `ADMIN_PINNED_GROUP_KEY` (`'pinned'`, deliberately not an `AdminNavSectionName`).
- **`ADMIN_LIST_PAGE_SIZE_OPTIONS`** (`[5, 10, 20, 50, 100, 500]`) and `ADMIN_LIST_PAGE_SIZE_DEFAULT` (20) now live here, so the server validates a page size against the same array the Admin UI offers. `@endora-commerce/admin-kit`'s `PAGE_SIZE_OPTIONS` is this array, re-exported.
- **`adminMeResponseSchema` gains `preferences`** — the signed-in admin's own document, or `null` when the server could not read it. A consumer that ignores the field is unaffected; a consumer that parses `/admin/me` with the schema now requires the key.
