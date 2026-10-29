# Data model: Admin user preferences (`specs/164-admin-user-preferences/`)

One concept — an **admin preference** (spec *Key Entities*) — stored in one table owned by
`admin_users` (research R-1). The value shapes are defined once, in
`packages/contracts/src/admin-preferences.ts` (Principle II), and are restated here only as
far as the storage needs them; [contracts/admin-preferences-api.md](./contracts/admin-preferences-api.md)
is normative for the shapes.

## `admin_user_preferences` — owned by `admin_users` (new)

Entity: `packages/modules/admin_users/src/backend/entities/admin-user-preference.entity.ts`
(`AdminUserPreference`, `@GlobalEntity()` from `@endora-commerce/platform/tenancy`), appended to
the `entities` array in `packages/modules/admin_users/src/backend/index.ts`.

Migration: scaffolded with
`pnpm --filter backend run migration:new -- --module admin_users --name admin_user_preferences`
(timestamp and class name assigned by the tool; the tail begins `AdminUsers…`), added by hand to
`packages/modules/admin_users/src/migrations/index.ts` (array and named export), registered with
`pnpm --filter backend run composer:generate`.

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `admin_user_id` | uuid | no | PK part 1; FK → `admin_users(id)` `on delete cascade` |
| `preference_key` | varchar(64) | no | PK part 2; one of `ADMIN_PREFERENCE_KEYS` — validated by the contract, not by a DB constraint (R-1) |
| `value` | jsonb | no | the value in that key's shape (below) |
| `updated_at` | timestamptz | no | default `now()`; set on every write |

Constraints and indexes:

- `admin_user_preferences_pkey` — primary key `(admin_user_id, preference_key)`. It is the
  "at most one per admin and preference" rule and serves every read (`where admin_user_id = ?`
  uses its leading column), so no further index is created.
- `admin_user_preferences_admin_user_fk` — `foreign key (admin_user_id) references
  admin_users (id) on delete cascade`.

`down`: `drop table if exists "admin_user_preferences";`.

No `created_at`: nothing reads it, and the spec's entity names only "when it was last changed".

### Value shapes per key

| `preference_key` | `value` | Absent row means | Write bound |
| --- | --- | --- | --- |
| `sidebarPins` | JSON array of destination strings, in pin order, no duplicates | `[]` — no Pinned section | ≤ 200 entries, each ≤ 255 chars, leading-slash path, no query string |
| `sidebarCollapsedGroups` | JSON array of group-key tokens, no duplicates; may include `pinned` | `[]` — every group open | ≤ 32 entries, token `^[a-z][A-Za-z0-9]{0,63}$` |
| `sidebarRailMode` | JSON boolean | `false` | — |
| `listPageSizes` | JSON object, list id → page size | `{}` — every list at 20 | ≤ 128 lists after the merge; id `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤ 64; size ∈ `5, 10, 20, 50, 100, 500` |

A row is written only when the admin changes that preference (or the carry-over imports a page
size); reading never writes, and a default is never stored (FR-015, FR-018). Validation is
strict on write and tolerant on read (research R-2): a stored value the current release does not
understand is returned as stored and ignored by the Admin UI, or — if it does not even have the
key's JSON type — served as the default and logged, and left in place.

### What a pin is, and is not

A pin is the **destination string** only (spec *Key Entities*). Label, icon, section,
permission and owning module are resolved at render from the sidebar entry with that
destination, so a renamed entry shows its current label, a language switch needs no write, and a
pin can never carry a visibility answer of its own (FR-003, FR-006).

## Rules

| Rule | Where it holds |
| --- | --- |
| Only the signed-in admin's rows are read or written | Every route resolves the subject from the session (`resolveAdminContext`); no route accepts an admin id (FR-011) |
| One row per (admin, key) | Primary key |
| Last write wins per key | `insert … on conflict (admin_user_id, preference_key) do update` |
| `listPageSizes` merges per list on `PATCH` | Row lock (`insert … on conflict do nothing`, then `select … for update`) + merge + bound check, in one transaction on `tx.execute` (R-3) |
| Carry-over never overwrites | Same lock; merge `{ ...imported, ...stored }` (stored wins) |
| No audit entry | `command-coverage-ignore` on every writing method (R-4, FR-020) |
| Pin list order is the admin's | Stored array order; the client appends new pins (FR-007) and reorders visible ones slot-preservingly (FR-009) |

### Lifecycle

```text
(no row) --first PATCH of the key / import--> stored --PATCH--> stored
admin soft-deleted or deactivated: rows untouched; restored/reactivated: served again
admin hard-deleted (demo withdrawal, test truncate): rows removed by cascade
```

No soft delete, no versioning, no history (spec *Assumptions*, R-4). `admin_users` is
non-deactivatable, so there is no operator-off state; uninstalling the module reverts its
migrations and drops the table with it.

## Tenancy classification

| Entity | Classification | Proof |
| --- | --- | --- |
| `AdminUserPreference` | platform-global | `@GlobalEntity()`; `pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts` |

Global because its only reader is its own admin, a platform-side user rather than a tenant actor
— the same classification as `admin_users` rows and the saved-view tables
(`specs/147-saved-views/data-model.md`). It holds destinations, group keys, list ids and numbers,
never business records or organization data (FR-021). This is a classification, not a
"no-organization" path for tenant data (spec *Assumptions*, Principle XI).

## Client-side state (not persisted)

The Admin UI's store (research R-6) holds, per key: the current value, an in-flight flag, a
pending value, an unsaved flag; and globally an availability flag and, while unavailable, the
admin's deltas. None of it is written to browser storage (FR-010). The three legacy
`localStorage` shapes it removes on first load are listed in
[contracts/admin-preferences-client.md](./contracts/admin-preferences-client.md) §4.
