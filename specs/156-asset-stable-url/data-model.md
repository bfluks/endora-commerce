# Data model: Stable asset URLs (`specs/156-asset-stable-url/`)

One migration owned by `assets_library`, scaffolded with
`pnpm --filter backend run migration:new -- --module assets_library --name asset_versions_permalinks`
(never a hand-picked timestamp — `specs/conventions/module-migrations.md`). Eleven columns on
`assets` and **two new small tables**, both owned by `assets_library` and `@GlobalEntity()` like
`Asset` (`packages/modules/assets_library/src/backend/entities/asset.entity.ts:15`): nothing here is
organization- or channel-scoped (Constitution XI, XII; spec A-1). No foreign key to another module's
table; other modules' rows are referenced by id only.

## 1. `assets` — new columns

| Column | Type | Null | Default / backfill | Meaning |
| --- | --- | --- | --- | --- |
| `content_version` | `varchar(32)` | not null | backfill `substr(md5(random()::text \|\| id::text), 1, 12)`; new rows set by the entity initialiser; column default `substr(md5(random()::text), 1, 12)` for rows written by raw SQL (the demo seed, other modules' fixtures) | Identity of the bytes the asset currently holds; the `v` marker and the ETag tail (research R-7). Public; no key is derived from it |
| `permalink` | `varchar(200)` | null | — | Operator-chosen path served at `<base>/assets/file/<permalink>` (R-12) |
| `previous_storage_locator` | `varchar(2048)` | null | — | Random sibling key `<dir>/<id>.prev-<32 hex>.<ext>` of the one kept previous version (R-1, R-21); private on cloud |
| `previous_filename` | `varchar(255)` | null | — | |
| `previous_mime_type` | `varchar(127)` | null | — | |
| `previous_mime_type_overridden` | `boolean` | null | — | Restored with the version on a swap |
| `previous_kind` | `varchar(16)` | null | — | Restored with the version (keeps `certificate`, R-5) |
| `previous_size_bytes` | `bigint` | null | — | |
| `previous_content_version` | `varchar(32)` | null | — | Its marker; becomes `content_version` again on restore; the restore request must name it (R-3) |
| `previous_replaced_at` | `timestamptz` | null | — | When it stopped being current; retention counts from here (FR-022) |
| `previous_replaced_by` | `uuid` | null | — | Admin user id of the actor; null for a system actor. Resolved through `adminUserReadPort` (R-14) |

**Constraints and indexes on `assets`**

- `assets_permalink_lower_unique` — `create unique index … on assets (lower(permalink)) where permalink is not null` (FR-015).
- `assets_previous_version_complete` — check: `previous_storage_locator`, `previous_filename`,
  `previous_mime_type`, `previous_mime_type_overridden`, `previous_kind`, `previous_size_bytes`,
  `previous_content_version`, `previous_replaced_at` are all null or all not null
  (`previous_replaced_by` may be null on its own).
- `assets_previous_replaced_at_idx` — `create index … on assets (previous_replaced_at) where previous_replaced_at is not null` (previous-version pass).
- `assets_soft_deleted_at_idx` — `create index … on assets (deleted_at) where deleted_at is not null` (soft-delete pass, `deleted_at <= now − retention`, owner ruling P1; the existing `assets_purge_due_index` on `purge_after_at` stays for the rollback case, research R-13).

## 1a. `asset_permalink_releases` — new table (research R-22, owner ruling P5)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `permalink_lower` | `varchar(200)` | PK | `lower(permalink)` of a permalink that stopped being held |
| `permalink` | `varchar(200)` | not null | As it was typed, for messages |
| `asset_id` | `uuid` | not null | The asset that held it (no foreign key: the asset may have been purged) |
| `released_at` | `timestamptz` | not null | |
| `reason` | `varchar(16)` | not null | check `in ('changed','removed','purged')` |

Upserted when a permalink is changed, removed, or released by a hard delete; deleted when a
permalink is taken again. One row per name, so the table is bounded by the number of distinct
permalinks ever used.

## 1b. `asset_object_cleanups` — new table (research R-21)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | |
| `storage_backend` | `varchar(8)` | not null | `local` / `s3` / `gcs` |
| `locator` | `varchar(2048)` | not null | Object key to delete |
| `reason` | `varchar(16)` | not null | check `in ('staging','previous','superseded','purge')` |
| `asset_id` | `uuid` | null | For logs only; no foreign key |
| `recorded_at` | `timestamptz` | not null | The sweep takes entries older than 24 hours |
| `attempts` | `integer` | not null, default 0 | |
| `last_error` | `text` | null | |

- `asset_object_cleanups_locator_unique` — unique `(storage_backend, locator)`.
- `asset_object_cleanups_recorded_at_idx` — `(recorded_at)`.

**Unchanged columns, changed meaning (documented in the entity)**

- `storage_locator` — the **stable key**: fixed at upload, never rewritten; always holds the current
  bytes (R-1).
- `storage_url` — still written once at upload and never rewritten. `AssetRecord.storageUrl` is
  derived from it at read time with the marker appended (R-8).
- `kind` — the stored kind is the replace guard's current kind; an admin MIME override never changes
  it (R-5).
- `updated_at` — still moves on every write; no longer part of the ETag.
- `mime_type_overridden` — cleared by a replace (spec *Edge Cases*); swapped by a restore.
- `purge_after_at` — still written by both delete paths at deletion (master), no longer read: the
  sweep and every reported purge date use `deleted_at + retention` read at that moment (P1). Kept so
  a rollback purges on a sane date.

**Down migration** drops both tables, the indexes and constraint, and the eleven columns. The stable
keys still hold the current bytes, so the platform keeps serving every asset; previous and staging
objects become unreferenced (listed in the documentation's rollback note).

## 2. Entities

- `Asset` (`asset.entity.ts`) adds the eleven properties (`[OptionalProps]` gains every nullable one
  and `contentVersion`, whose initialiser mints a token so `em.create(Asset, …)` call sites — the
  upload pipeline, `pim_ergonode` through the port, test fixtures such as
  `admin-retention.contract.test.ts:56-61` — need no change). Helpers on the entity module, not
  methods: `hasPreviousVersion(asset)`, `clearPreviousVersion(asset)` (nulls all nine together).
- `AssetPermalinkRelease` (`entities/asset-permalink-release.entity.ts`) and `AssetObjectCleanup`
  (`entities/asset-object-cleanup.entity.ts`), both `@GlobalEntity()`, added to the module's published
  `entities` array (`check:entity-tenant-classification` reads it).

No relation to another module's entity.

## 3. State transitions

```text
                upload                       replace (same kind)
   (none) ───────────────► CURRENT v1 ───────────────────────► CURRENT v2
                            prev: —                              prev: v1 (replaced_at=t)
                                                                     │
                  restore (swap; names v2 and v1)                    │ replace again
   CURRENT v1 ◄──────────────────── CURRENT v2, prev v1              ▼
   prev: v2 (replaced_at=now)                              CURRENT v3, prev: v2 (v1 object → cleanup)

   prev with replaced_at + retention <= now ──(sweep, under lock)──► columns nulled + cleanup entry
                                                                     ──► object deleted, entry cleared
   soft delete (single or recursive folder): deleted_at = now   (permalink kept, answers 410)
   restore before due: deleted_at = null                       (leaves the sweep, FR-033)
   deleted_at + retention(read at sweep, ≥ 1 day) <= now, not referenced ──(sweep, under lock)──►
       previous cleared as above; stable object deleted; row removed; permalink → release row
   stable delete fails: pending_cleanup = true ──(next sweep)──► retried (FR-032)
   cleanup entry older than 24 h, locator unreferenced ──(sweep)──► object deleted, entry removed
   permalink changed / removed / purged ──► release row upserted
   previously released permalink whose last holder was a DIFFERENT asset ──► 409 until confirmReuse; then release row deleted
   the same asset taking its own released permalink back ──► no 409, no reuse record; release row deleted (FR-037)
```

## 4. Contract shapes touched (full Zod in [contracts/admin-api.md](./contracts/admin-api.md))

| Shape | Change |
| --- | --- |
| `AssetSummary` | `url` → embed form (versioned when public); **new** `fileUrl`, `permalink`, `permalinkUrl`, `contentVersion` |
| `AssetDetail` | **new** `previousVersion: AssetPreviousVersion \| null`; **new** `retentionDays: number` (whole days, at least 1 — `assets.soft_delete_retention_days` as the sweep reads it; named by the replace confirmation, UI block review 2026-10-19); **new** `replaceable: boolean` (false for a legacy row or one with no storage key — owner ruling S3) |
| `AssetPreviousVersion` | **new**: `filename`, `mimeType`, `sizeBytes`, `contentVersion`, `replacedAt`, `replacedBy: { id, displayName } \| null`, `restorableUntil` |
| `AssetRecord` | **new** `contentVersion`, `permalink`; `storageUrl` carries the marker; `purgeAfterAt` derived at read time (same type) |
| `FolderPermalinkCountResponse` | **new** `{ data: { permalinkedAssets: number } }` — live permalinked assets in a folder subtree (owner ruling S4) |
| Request bodies | **new** `setAssetPermalinkRequestSchema` (`permalink`, optional `confirmReuse`), `restorePreviousAssetVersionRequestSchema` (both versions required); replace is multipart |

## 5. What is not stored

- No row per version; no history beyond one previous version (spec *Out of scope*).
- No setting: retention is `assets.soft_delete_retention_days`; the sweep cap is a constant.
