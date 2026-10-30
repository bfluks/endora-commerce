# Contract: admin surfaces, translations and the palette

Owner: `packages/modules/assets_library/src/admin/`. One kit change in
`packages/admin-kit/src/components/asset-picker/AssetUploader.tsx`. Research R-15, R-16.

## 1. Kit: `AssetUploader` gains one optional prop

```ts
export interface AssetUploaderProps {
  // existing: acceptPrefix, defaults, onUploaded, triggerLabel
  /**
   * Replaces the default `uploadAsset(file, defaults)` call — the Library's replace action
   * passes `(file) => assetsLibraryClient.replaceAsset(id, file, contentVersion)`.
   * Optional; every existing caller is unchanged.
   */
  upload?: (file: File) => Promise<AssetDetail>;
  /** Full `accept` attribute override (e.g. 'application/pdf'); `acceptPrefix` still applies when absent. */
  accept?: string;
}
```

Its copy stays in `core` (`assetPicker.upload.*`); no new `core` key.

## 2. Module client (`src/admin/api/assets-library-client.ts`)

```ts
replaceAsset(id: string, file: File, expectedContentVersion: string): Promise<AssetDetail>;
restorePreviousVersion(
  id: string,
  versions: { expectedContentVersion: string; expectedPreviousContentVersion: string },
): Promise<AssetDetail>;
setPermalink(id: string, permalink: string, options?: { confirmReuse?: boolean }): Promise<AssetDetail>;
removePermalink(id: string): Promise<AssetDetail>;
```

## 3. Drawer (`src/admin/components/AssetDetailDrawer.tsx`)

| Section | Visible with | Behaviour |
| --- | --- | --- |
| Shareable URL | `assets.read` | `permalinkUrl ?? fileUrl`, read-only, **Copy** button → "Copied" for 2 s, or *could not copy* when the clipboard refuses or is absent; a muted notice when private: *not publicly reachable while the asset is private* (FR-018, FR-021) |
| Permalink | input visible with `assets.read`, editable with `assets.write` | inline error from `validateAssetPermalink`; **Save** disabled while invalid or unchanged; changing or removing a set permalink opens a `ModalDialog` warning that the old address will stop working at once (FR-019); a `409 ASSET_PERMALINK_PREVIOUSLY_USED` opens a second `ModalDialog` (*reuse*) — **Use it anyway** re-sends with `confirmReuse: true`, **Cancel** sends nothing (owner ruling P5); other server refusals shown in an `Alert` with `error.message` |
| Replace file | `assets.write`, and `replaceable` (owner ruling S3: absent for a legacy row or one with no storage key, which shows `detail.replace.unavailable` instead) | `AssetUploader` with `upload`, `accept` and (image, video) `acceptPrefix` by kind; after a file is chosen, a `ModalDialog` names the current and the new filename, the detail's `retentionDays` (a sentence without the number when absent) and says every link will serve the new file; confirm → upload; success shows the detail the replace answered; kind mismatch shows the drawer's own sentence (§4), or the server's when the refusal names no kinds; conflict shows the server sentence and a **Reload** button |
| Previous version | `assets.read`, Restore with `assets.write` | filename, type, size, replaced at, replaced by (or *unknown*), restorable until; **Restore** → `ModalDialog` → restore with the asset's `contentVersion` and `previousVersion.contentVersion`; a `409 ASSET_REPLACE_CONFLICT` shows the message and **Reload**; absent section when `previousVersion` is null |
| Soft delete | unchanged gate | when `permalink` is set, a `ModalDialog` first states that `<permalinkUrl>` will answer "gone" (FR-020); without a permalink unchanged |

The drawer is keyed by the asset id, so no draft, dialog or refusal carries from one asset to another. A permalink dialog returns focus to the permalink input; the restore dialog to **Restore**. A confirming button stays focusable with `aria-busy` while its request runs. An answer that is not an error envelope shows `detail.error.generic`, never a raw body.

All async actions follow the StrictMode rules (tasks.md standing rule 2): an `alive` flag set in
the effect body and cleared in cleanup; "done" only after the response arrives.

## 4. Bundle keys (`packages/modules/assets_library/i18n/{en,pl}.json`, flat)

```text
detail.shareUrl.label            Shareable link
detail.shareUrl.copy             Copy link
detail.shareUrl.copied           Copied
detail.shareUrl.privateNotice    This link is not publicly reachable while the asset is private.
detail.permalink.label           Permalink
detail.permalink.help            A readable address for this file, for example certificate.pdf or docs/iso-9001.pdf. It keeps working when the file is replaced.
detail.permalink.save            Save permalink
detail.permalink.remove          Remove permalink
detail.permalink.invalid.empty | too_long | invalid_characters | invalid_segment | uuid_shaped   (same sentences as the error bundle)
detail.permalink.changeTitle     Change the permalink?
detail.permalink.changeBody      {oldUrl} will stop working immediately. Links already printed or shared will no longer open this file.
detail.permalink.removeTitle     Remove the permalink?
detail.permalink.removeBody      {oldUrl} will stop working immediately.
detail.permalink.reuseTitle      Use a permalink that was used before?
detail.permalink.reuseBody       {permalink} pointed to another file until {releasedAt}. Links printed or shared with it will open this asset from now on.
detail.permalink.reuseConfirm    Use it anyway
detail.replace.trigger           Replace file
detail.replace.confirmTitle      Replace this file?
detail.replace.confirmBody       {currentFilename} will be replaced with {newFilename}. Every page, e-mail and link that uses this asset will show the new file. You can restore the current file for {retentionDays} days.
detail.replace.confirm           Replace
detail.replace.kindMismatch      This asset holds {currentKind} and can only be replaced with {currentKind}. The chosen file is {newKind}.
detail.replace.reload            Reload
detail.previous.title            Previous version
detail.previous.replacedAt       Replaced
detail.previous.replacedBy       Replaced by
detail.previous.unknownActor     unknown
detail.previous.restorableUntil  Can be restored until
detail.previous.restore          Restore previous version
detail.previous.confirmTitle     Restore the previous version?
detail.previous.confirmBody      {previousFilename} becomes the current file again; {currentFilename} is kept as the previous version and can be restored in turn.
detail.delete.permalinkTitle     Delete an asset with a permalink?
detail.delete.permalinkBody      {permalinkUrl} will answer that the file is gone. Restoring the asset brings it back.
kind.image | kind.video | kind.pdf | kind.other     an image | a video | a PDF | a document
actions.openLibrary.label        Assets library   (pl: Biblioteka zasobów; owner ruling 2026-10-19)
actions.openLibrary.description  Browse, upload and replace files, and manage permalinks.
errors.ASSET_REPLACE_KIND_MISMATCH … errors.ASSET_PERMALINK_PREVIOUSLY_USED, errors.ASSET_PERMALINK_INVALID.<reason>   (contracts/admin-api.md §4)
# Added by the owner rulings S3 – S5 (2026-10-19):
detail.replace.unavailable       This file was not uploaded through the assets library, so it cannot be replaced in place. Upload the new file as a new asset.
folders.permalinkNotice          Files in this folder with a shareable link: {count}. Their links keep working: the files move to the parent folder.
page.title, nav.assetsLibrary.label   master values kept (Assets Library / Assets library; pl: Biblioteka zasobów)
# Added by the UI block review (2026-10-19):
detail.close                     Close asset detail
detail.error.generic             The request failed. Try again.
detail.shareUrl.copyFailed       The link could not be copied. Select it and copy it by hand.
detail.permalink.reuseBodyNoDate {permalink} pointed to another file before. Links printed or shared with it will open this asset from now on.
detail.replace.confirmBodyNoRetention  {currentFilename} will be replaced with {newFilename}. Every page, e-mail and link that uses this asset will show the new file. You can restore the current file afterwards for a limited time.
```

Polish values are written in the same commit; `check:bundle-pairing`,
`check:error-translations` and `test/unit/_i18n/registered-bundles-shape.test.ts` hold them.
`i18n:hardcoded` must stay at its baseline for `AssetDetailDrawer.tsx` (it may go down, never up).

## 5. Palette (round 3 Q2 — confirmed 2026-10-16)

```ts
// manifest.ts
actions: [{
  id: 'open-assets-library',
  labelKey: 'actions.openLibrary.label',
  descriptionKey: 'actions.openLibrary.description',
  icon: 'Image',
  targetRoute: '/assets-library',
  requiredPermission: 'assets.read',
  keywords: ['assets', 'media', 'files', 'images', 'permalink', 'pliki', 'multimedia'],
  weight: 250,
}],
```

`src/admin/index.ts`' "No palette action" paragraph is rewritten, and
`admin/test/modules/batch-nine-surfaces.module-owned-surface.test.tsx` expects the one action.
