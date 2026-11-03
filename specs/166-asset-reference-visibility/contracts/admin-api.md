# Contract: admin API behaviour, route by route

No route is added or removed, and no request or response **schema** changes. What changes is
**which assets and references a caller is answered about**. The routes are those of
`packages/modules/assets_library/src/backend/routes.admin.ts`, plus the three owners'
attach-existing routes.

**Terms.**
- **Hidden**: the caller may not see the asset (FR-001; `data-model.md` §2).
- **Restricted caller**: an administrator without the platform wildcard `*`.
- The wildcard holder and the system actor are **unrestricted**. For them every row below behaves
  as today, except the R-6 repair of the recursive folder delete.
- **Not found**: `404`, `code: ASSET_NOT_FOUND`, `message: "Asset <id> not found."`. This is
  byte-identical to the answer for an id with no row (research R-7).

## 1. Library routes

| # | Route | Gate | For a hidden asset (restricted caller) | For a visible asset |
| --- | --- | --- | --- | --- |
| 1 | `POST /api/v1/admin/assets` (upload) | `assets.write` | n/a — a new asset is referenced by nothing | unchanged |
| 2 | `POST /assets/:id/replace` | `assets.write` | **Not found**, raised by the guard **before the multipart stream is read** (no bytes staged) | unchanged; the returned detail's `references` are filtered (#7) |
| 3 | `POST /assets/:id/previous-version/restore` | `assets.write` | **Not found** | unchanged; detail filtered |
| 4 | `PUT /assets/:id/permalink` | `assets.write` | **Not found** | unchanged; on `409 ASSET_PERMALINK_TAKEN`, `details.assetId` is `null` when the holder is hidden from the caller (R-11); detail filtered |
| 5 | `DELETE /assets/:id/permalink` | `assets.write` | **Not found** | unchanged; detail filtered |
| 6 | `GET /assets` (list, search, picker) | `assets.read` | **absent** from `data`. The offset cursor pages over the filtered sequence, so pages are full and `nextCursor` never points at or past a hidden row only. Applies with `includeDeleted` too. The response has no total (research F-2). | unchanged |
| 7 | `GET /assets/:id` (detail) | `assets.read` | **Not found** | `references` = unrestricted references plus the restricted references the caller may see (FR-007); hidden ones are neither listed nor counted |
| 8 | `GET /assets/:id/url` (download, preview) | `assets.read` | **Not found** | unchanged |
| 9 | `DELETE /assets/:id` | `assets.write` | **Not found** | refused with `409 ASSET_REFERENCED` when **any** reference exists, hidden ones included (FR-008). The message's count and `details` (first 20) are the **visible** references only. By invariant I-1 there is at least one. A soft-deleted asset answers as today (idempotent). |
| 10 | `POST /assets/:id/restore` | `assets.write` | **Not found** | unchanged; detail filtered |
| 11 | `POST /assets/:id/move` | `assets.write` | **Not found** | unchanged; detail filtered |
| 12 | `POST /assets/move-many` | `assets.write` | the id is **skipped exactly like a missing id**: not moved, not counted in `movedCount`, not in the audit row's `assetIds` (R-9) | moved as today |
| 13 | `PATCH /assets/:id` (rename, label, MIME type, visibility, folder) | `assets.write` | **Not found** | unchanged; detail filtered |
| 14 | `POST /assets/storage/self-check` | `assets.write` | n/a — storage, not assets | unchanged |
| 15 | `GET /assets/storage/state` | `assets.read` | `pendingCleanupCount` and `softDeletedCount` stay library-wide (R-12, owner may object) | unchanged |
| 16 | `GET /assets/folders` | `assets.read` | n/a — folders carry no asset data | unchanged |
| 17 | `POST /assets/folders` | `assets.write` | n/a | unchanged |
| 18 | `PATCH /assets/folders/:folderId` | `assets.write` | n/a | unchanged |
| 19 | `GET /assets/folders/:folderId/permalink-count` | `assets.read` | **not counted** | counted |
| 20 | `DELETE /assets/folders/:folderId` | `assets.write` | see §1.1 | see §1.1 |

Rows 2–5, 7–11 and 13 share one guard, `requireVisibleAsset`, a preHandler placed after the
permission gate. `packages/modules/assets_library/src/backend/routes.admin.guard.test.ts` (co-located, `specs/106-module-owned-tests/`) enumerates every
admin route with an `:id` asset parameter and fails on one without it.

### 1.1 Folder delete (`ifNonEmpty`)

The hidden assets of the folder (for `cancel` and `moveContentsToParent`) or of the subtree (for
`deleteRecursively`) are **moved to the deleted folder's parent**, or to the root when it has
none. The caller is answered as if those assets were not there (R-10).

| Strategy | Restricted caller |
| --- | --- |
| `cancel` | Refused with `409 ASSET_FOLDER_NOT_EMPTY` only for sub-folders or **visible** assets; the message counts visible assets. A folder holding only hidden assets is deleted, and its hidden assets are re-homed. |
| `moveContentsToParent` | As today: every asset, hidden or not, goes to the parent. |
| `deleteRecursively` | **References are checked for real** (repair of research F-8). Visible referenced assets refuse the whole delete with `409 ASSET_REFERENCED`, `details` = their ids only. Hidden assets are re-homed, not soft-deleted. Visible unreferenced assets are soft-deleted; `softDeletedAssetIds` lists only those. |

The `asset_folder.delete` audit row gains `stateBefore.rehomedAssetIds`, written in the same flush.

## 2. Public routes

`GET /assets/file/:id`, the permalink route and the signed-URL route are unchanged
(`routes.public.ts`). A public file stays reachable by its public address, and a private one by a
signed URL issued earlier, until that URL expires (spec, Edge Cases; Assumptions).

## 3. Owners' attach-existing routes (FR-006)

| Route | Change |
| --- | --- |
| `POST /api/v1/admin/tasks/:id/attachments` `{ assetId }` | `TaskAttachmentService.add` asks `assetReadPort.visibleToCaller([assetId])` right after `findById`. A hidden asset gets the existing `422 VALIDATION_FAILED`, *"The file does not exist in the media library."*, the same as a missing file, and gets it **before** the private-file and active-content refusals. |
| `POST /api/v1/admin/projects/:id/attachments` `{ assetId }` | The same, in `ProjectAttachmentService.add`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` `{ assetId }` | The same, in `OpportunityAttachmentService.add`. |

Attaching a file the record already has still answers `200` with the existing attachment: the
caller sees the record, so the file is visible to them through it. The upload routes
(`…/attachments/upload`) are unchanged; a new upload is referenced by nothing until it is attached.

## 4. Error codes

None added. `ASSET_NOT_FOUND`, `ASSET_REFERENCED`, `ASSET_FOLDER_NOT_EMPTY`,
`ASSET_PERMALINK_TAKEN` and `VALIDATION_FAILED` keep their sentences in `i18n/{en,pl}.json`. Only
the numbers interpolated into the English fallback message change.
