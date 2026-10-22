# Contract: admin API, shared schemas and error codes

Source of truth: `packages/contracts/src/assets-library.ts` (written first, Principle II) and
`packages/contracts/src/errors.ts`. Every route below is under `/api/v1/admin/assets`, registered
in `packages/modules/assets_library/src/backend/routes.admin.ts` inside the multipart child
context `plugin.ts:125-137` already creates, gated as its `preHandler`
(`specs/conventions/module-admin-surfaces.md` item 3). No new permission code (FR-026, A-3).

## 1. Shared schemas and the validator

```ts
// packages/contracts/src/assets-library.ts — additions

export const ASSET_PERMALINK_MAX_LENGTH = 200;
export type AssetPermalinkInvalidReason =
  | 'empty' | 'too_long' | 'invalid_characters' | 'invalid_segment' | 'uuid_shaped';

/** One rule for the server and the admin form (research R-12). Pure; no I/O. */
export function validateAssetPermalink(
  value: string,
): { ok: true } | { ok: false; reason: AssetPermalinkInvalidReason };
// - '' → empty;  length > 200 → too_long
// - any character outside [A-Za-z0-9._/-] → invalid_characters
// - leading/trailing '/', '//' , a '.' or '..' segment → invalid_segment
// - whole value matches /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i → uuid_shaped

/** True for the shape the file route treats as an asset id. Exported for the route. */
export function isAssetIdShaped(segment: string): boolean;

export const assetPreviousVersionSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  sizeBytes: z.number().int().nonnegative(),
  contentVersion: z.string().min(1).max(32),
  replacedAt: isoDateTimeSchema,
  replacedBy: z.object({ id: uuidSchema, displayName: z.string() }).nullable(),
  /** `replacedAt` + `assets.soft_delete_retention_days` as read now (FR-022). */
  restorableUntil: isoDateTimeSchema,
});

// assetSummarySchema gains (all required — see tasks.md T012's and T035's record sweeps):
//   url:          unchanged type; now the EMBED form (public: stable URL + `?v=`; private: signed)
//   fileUrl:      z.string()             — the stable, unversioned file URL (FR-005, FR-021)
//   permalink:    z.string().nullable()
//   permalinkUrl: z.string().nullable()  — absolute, on the local public base (R-12)
//   contentVersion: z.string()
// assetDetailSchema gains:
//   previousVersion: assetPreviousVersionSchema.nullable()
//   retentionDays:   z.number().int().min(1) — `assets.soft_delete_retention_days` as the sweep
//                    reads it, in whole days; named by the replace confirmation (UI block review:
//                    read with the detail, not from the storage state, which probes the bucket)

export const setAssetPermalinkRequestSchema = z.object({
  permalink: z.string().max(ASSET_PERMALINK_MAX_LENGTH * 2), // shape judged by validateAssetPermalink
  /** Acknowledges taking a permalink whose last holder was a DIFFERENT asset (research R-22, owner rulings P5, B3); never needed by the asset that last held it. */
  confirmReuse: z.boolean().optional(),
});

/** Both required: a restore names the current file and the previous file it brings back (R-3). */
export const restorePreviousAssetVersionRequestSchema = z.object({
  expectedContentVersion: z.string().min(1).max(32),
  expectedPreviousContentVersion: z.string().min(1).max(32),
});

// AssetRecord (interface) gains:
//   contentVersion: string;
//   permalink: string | null;
// `storageUrl` is documented as "a URL that serves the CURRENT version, carrying its marker
// for local/s3/gcs rows; unchanged for legacy rows and data: URLs", and `purgeAfterAt` as
// "deletedAt + assets.soft_delete_retention_days as read now (at least one day)".
```

The `listAssetsQuerySchema` is unchanged; its `q` now also matches `permalink` (FR-021).

## 2. Routes

| Method & path | Gate | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /:id/replace` | `assets.write` | `multipart/form-data`: one `file` part; optional field `expectedContentVersion` (sent **before** the file part, as `folderId` is today) | `200 { data: AssetDetail }` | 400 `ASSET_UPLOAD_NO_FILE`; 404 `ASSET_NOT_FOUND`; 409 `ASSET_LEGACY_CANNOT_REPLACE` (also a row with no storage key — owner ruling S3); 409 `ASSET_REPLACE_CONFLICT`; 400 `VALIDATION_FAILED` (`expectedContentVersion` sent after the file part — refused before anything is committed, security review 2026-10-19); 410 `ASSET_GONE` (soft-deleted); 413 `ASSET_UPLOAD_TOO_LARGE`; 415 `ASSET_UPLOAD_TYPE_NOT_ALLOWED`; 415 `ASSET_REPLACE_KIND_MISMATCH`; 503 `ASSET_STORAGE_UNAVAILABLE` |
| `POST /:id/previous-version/restore` | `assets.write` | `restorePreviousAssetVersionRequestSchema` (both versions required) | `200 { data: AssetDetail }` | 400 `VALIDATION_FAILED` (a version missing); 404 `ASSET_NOT_FOUND`; 409 `ASSET_NO_PREVIOUS_VERSION`; 409 `ASSET_REPLACE_CONFLICT` (either version differs); 409 `ASSET_LEGACY_CANNOT_REPLACE`; 410 `ASSET_GONE`; 503 `ASSET_STORAGE_UNAVAILABLE` |
| `PUT /:id/permalink` | `assets.write` | `setAssetPermalinkRequestSchema` | `200 { data: AssetDetail }` (same value again: 200, no audit row) | 400 `ASSET_PERMALINK_INVALID` (`details.code` = reason); 404 `ASSET_NOT_FOUND`; 410 `ASSET_GONE` (soft-deleted; security review 2026-10-19); 409 `ASSET_PERMALINK_TAKEN` (`details: { permalink, assetId }`); 409 `ASSET_PERMALINK_PREVIOUSLY_USED` (`details: { permalink, releasedAt }`; only when the last holder was a different asset and `confirmReuse: true` is absent — the same asset taking its own former value back gets 200, FR-037) |
| `DELETE /:id/permalink` | `assets.write` | — | `200 { data: AssetDetail }` (none set: 200, no audit row) | 404 `ASSET_NOT_FOUND`; 410 `ASSET_GONE` (soft-deleted) |
| `GET /folders/:folderId/permalink-count` | `assets.read` | — | `200 { data: { permalinkedAssets } }` — live assets with a permalink in the folder's subtree, any depth (owner ruling S4) | 404 `ASSET_FOLDER_NOT_FOUND` |
| `GET /:id`, `GET /` | `assets.read` | — | as today, with the new members | as today |
| `GET /:id/url` | `assets.read` | — | **unchanged**: the stable form (`resolveUrl`) | as today |

The replace route also answers `413 ASSET_UPLOAD_TOO_LARGE` with `details.maxFileSizeMb = 5120` for a
replacement above S3's 5 GiB single-request ceiling on an S3 asset (research R-1), whatever the
configured maximum.

Replace and restore on a soft-deleted asset answer `410 ASSET_GONE` — restoring the asset first
is the way back. Setting or removing a permalink on a soft-deleted asset is allowed (it is
metadata; the permalink answers `410` until the asset is restored).

**Existing response whose value changes.** `DELETE /:id` keeps its shape
`{ data: { deletedAt, purgeAfterAt } }`. Master computes `purgeAfterAt` from the setting at deletion
and repeats the stamped value on a second `DELETE`; it is now `deletedAt +
assets.soft_delete_retention_days` (at least one day) with the setting read when the response is built
— also for the idempotent answer on an already-deleted asset — so it always agrees with the sweep
(owner rulings P1, P3). `AssetRecord.purgeAfterAt` follows the same rule. No type changes.

## 3. Commands (Constitution XIII, research R-6)

| Action | `objectType` / `objectId` | `before` | `after` |
| --- | --- | --- | --- |
| `asset.replace` | `asset` / asset id | `{ filename, mimeType, sizeBytes, contentVersion }` of the replaced file | same keys for the new file |
| `asset.restore_previous_version` | `asset` / asset id | the file that was current | the restored file |
| `asset.permalink_set` | `asset` / asset id | `{ permalink: old \| null }` | `{ permalink: new }`, plus `reusedPermalink: { previousAssetId, releasedAt, reason }` when a previously used permalink was taken with `confirmReuse` (R-22) |
| `asset.permalink_remove` | `asset` / asset id | `{ permalink: old }` | `{ permalink: null }` |

`skipAudit: true` for the two no-op answers in §2. None is declared reversible (the restore is
the undo for a replace; a permalink change is re-done by setting it again).

## 4. Error codes — seven new, all owned by `assets_library`

Each lands in **one commit** with its four places: `ERROR_CODES`
(`packages/contracts/src/errors.ts`), the `MINTED_ERROR_CODES` ledger
(`backend/test/fixtures/error-code-routing/reference-ledgers.ts`, `to: 'assets_library'`), the
manifest's `errorCodes`, and `errors.<CODE>` in `packages/modules/assets_library/i18n/{en,pl}.json`.

| Code | Status | `details` | English sentence (bundle) |
| --- | --- | --- | --- |
| `ASSET_REPLACE_KIND_MISMATCH` | 415 | `{ currentKind, newKind }` (`newKind: other` when a file declared as an image or a PDF is not recognised as one, R-5) | `This asset holds a {currentKind} file and can only be replaced with another {currentKind} file; the file you chose is {newKind}.` |
| `ASSET_LEGACY_CANNOT_REPLACE` | 409 | — | `This file is stored at an address the platform did not issue, so it cannot be replaced in place. Upload it again as a new asset.` |
| `ASSET_REPLACE_CONFLICT` | 409 | — | `Someone else changed this asset's file while you were uploading. Reload the asset and try again.` |
| `ASSET_NO_PREVIOUS_VERSION` | 409 | — | `This asset has no previous version to restore.` |
| `ASSET_PERMALINK_TAKEN` | 409 | `{ permalink, assetId }` | `The permalink "{permalink}" is already used by another asset.` |
| `ASSET_PERMALINK_PREVIOUSLY_USED` | 409 | `{ permalink, releasedAt }` | `The permalink "{permalink}" was used by another file before. Links already printed or shared with it will open this asset. Confirm to use it.` |
| `ASSET_PERMALINK_INVALID` | 400 | `{ code: reason }` | base `The permalink is not valid.`; per reason `errors.ASSET_PERMALINK_INVALID.<reason>` — `empty`: `Enter a permalink.`; `too_long`: `A permalink can be at most 200 characters long.`; `invalid_characters`: `A permalink may contain only letters, digits, "-", "_", "." and "/".`; `invalid_segment`: `A permalink cannot start or end with "/", contain "//", or have a "." or ".." part.`; `uuid_shaped`: `A permalink cannot look like an asset id.` |

Polish sentences are written in the same commit (FR-025); the kind tokens in
`ASSET_REPLACE_KIND_MISMATCH` are the machine tokens `image`, `video`, `pdf`, `other` — the admin
drawer renders its own translated sentence from `kind.<token>` keys for this one code (see
[admin-surfaces.md](./admin-surfaces.md) §4).
