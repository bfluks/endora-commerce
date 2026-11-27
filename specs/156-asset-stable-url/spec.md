# Feature Specification: Stable asset URLs — replace an asset's file in place, and readable permalinks

**Feature Branch**: `feat/156-asset-stable-url` (spec directory `specs/156-asset-stable-url/`)
**Created**: 2026-10-16
**Status**: Implemented, accepted with notes (2026-10-19) — every phase of `tasks.md` built, block QA, code review, security review (pass with notes) and product-owner acceptance (accepted with notes) done, the CI gate green on the tip; T093 and the manual checks remain for the owner. History: clarified — ready for plan (2026-10-16: round 1 Q1–Q5 and A-5, round 2 R2-1 – R2-5 and
FR-018 answered by the product owner; round 3 Q1–Q3 and the architect's amendments to FR-006,
FR-020 and FR-024 encoded the same day; 2026-10-18: owner rulings P1–P5 — read-at-sweep due rule,
private permalinks answer `404`, purge safeguards, cloud `Content-Disposition`, confirmed reuse of a
freed permalink — encoded, and *Current state* re-measured; the same day, after analysis, owner
rulings B1 – B3 — by-id order for a soft-deleted private asset, the kind rule on stored kind and
recognised content, reuse confirmation only across assets — and the restore guard on both versions
encoded in FR-006, FR-013, FR-023 and FR-037)
**Issues**: #293. *(The soft-delete purge was tracked in #322, closed by master's retention fix; the purge sweep itself is still unscheduled on master, and this feature also wires it —
FR-029 – FR-035.)*
**Input**: GitHub issue **#293** — *Permalinks for Asset Library resources (URL retention on asset
replacement).* Replacing a file in the Asset Library changes its direct file URL, which breaks every
reference held outside the platform (the example given: a PDF certificate whose web link changes when
a new certificate is uploaded). The issue proposes alias/permalink definitions for assets — a short,
readable path on the shop's public hostname — such that uploading a new version of the asset keeps the
permalink unchanged while it serves the new content.

## Vocabulary

- **Asset** — one row of the Assets Library (`assets` table), identified by a UUID, holding one file.
- **File URL** — the URL the Library hands out for an asset today: `<base>/assets/file/<assetId>` on
  the local-filesystem backend, `<bucket or CDN base>/<locator>` on S3 and GCS (see *Current state*).
- **Replace** — swapping the file an existing asset holds for a newly uploaded one, **keeping the
  asset's identity** (its id, folder, label, alternate text, visibility and every record that
  references it).
- **Version** — one file an asset has held. The **current version** is what every URL of the asset
  serves; a **previous version** is a file the asset held before a replace.
- **Permalink** (alias) — an operator-chosen, human-readable path (for example `certificate.pdf` or
  `docs/iso-9001.pdf`), served at `<public base>/assets/file/<permalink>`, that always serves the
  asset's current version.
- **Version marker** — a value in the URLs the platform embeds itself that changes with every replace
  and restore, so those URLs can be cached long; a URL whose marker is no longer current is a
  **stale-marker URL**.
- **Internal reference** — a record inside the platform that points at an asset **by id** (a gallery
  item, a product attachment, a CMS `asset_ref` node, an e-mail branding logo). **External reference**
  — a URL copied out of the platform: a link in a PDF, a printed QR code, a partner's website, a feed
  consumer's cache, a pasted URL in a CMS block whose image source is "URL".

## Current state (measured on `origin/master` at `e6b1494f7`; re-measured at `194698a9e` on 2026-10-18)

### There is no replace — "replacing" an asset means uploading a new one

The issue says replacing a file changes its URL. Measured, the cause is narrower and different: the
Library **has no replace operation at all**.

- The service exposes `upload`, `resolveUrl`, `getAsset`, `listAssets`, `patchAsset`,
  `setVisibility`, `softDelete`, `restore`, `move`, `moveMany` and nothing else
  (`packages/modules/assets_library/src/backend/services/assets-library.service.ts:78-284`).
- The admin routes are upload, list, detail, url, delete, restore, move, move-many, storage
  self-check/state, folders CRUD and a metadata `PATCH`
  (`packages/modules/assets_library/src/backend/routes.admin.ts:49-291`). No route accepts a file for
  an existing asset.
- Every upload allocates a fresh UUID (`.../services/upload-pipeline.ts:179`), so the only way to
  "replace" a certificate is to upload a new asset (new id, new URL), re-link every internal reference
  by hand, and delete the old asset — which reference protection refuses while anything still points
  at it (`assets-library.service.ts:228-240`, `409 ASSET_REFERENCED`).
- The admin uploader (`packages/admin-kit/src/components/asset-picker/AssetUploader.tsx:16-24`) only
  creates new assets; the detail drawer
  (`packages/modules/assets_library/src/admin/components/AssetDetailDrawer.tsx:103-200`) offers
  "open file", filename, label, MIME type and visibility, and no "replace file" or "copy link".

The file URL is **already id-based and stable** on the local backend:
`<base>/assets/file/<assetId>` (`.../services/storage/local-fs-adapter.ts:133`). It changes only
because the id changes. The module documentation already claims *"Public URLs are stable"*
(`packages/modules/assets_library/docs/assets-library/index.md:74`) — true of the id form, and
misleading to an operator who needs to update a file.

### Cloud URLs carry the file extension

On S3 and GCS the public URL is `<base>/<locator>` (`.../storage/s3-adapter.ts:127`,
`.../storage/gcs-adapter.ts:110`), and the locator is `aa/bb/<assetId>.<ext>`, with the extension
taken from the original filename (`.../storage/locator.ts:7-16`). On those backends a replace that
changes the extension (`.pdf` → `.docx`) would change the URL even under the same asset id; on the
local backend it would not.

### A frozen URL copy is still read by other modules

`storageUrl` is written once at upload with the public URL form
(`upload-pipeline.ts:226-240`), marked deprecated on the entity
(`.../entities/asset.entity.ts:49-55`), exposed on the cross-module read model `AssetRecord`
(`packages/contracts/src/assets-library.ts:263-283`), and still read by `catalog` to build product
image URLs (`packages/modules/catalog/src/backend/services/gallery.service.ts:175-179`,
`packages/modules/catalog/src/backend/services/primary-asset-url.ts:116-123`). A replace that moves the
file to a new locator without rewriting `storageUrl` would leave those reads pointing at a dead
object.

### Most internal references resolve the URL at render time

- CMS bodies hold `{ type: 'asset_ref', assetId }` and resolve URLs per request
  (`.../services/cms-body-resolver.ts:13-51`); the shared renderer falls back to
  `/assets/file/<assetId>` (`packages/cms-components/src/utils/resolve-image-url.ts:35-38`).
- Product feeds resolve image links through `assetReadPort.resolvePublicUrls` when a feed is
  generated (`packages/modules/product_feeds/src/backend/index.ts:84,177`); a consumer that has
  already fetched a feed holds absolute file URLs — an external reference. Whether a generated feed
  file is stored and served later was not traced.
- Page-builder backgrounds build `/assets/file/<id>` from an asset id
  (`packages/page-builder-core/src/types/background.ts:72,90`).
- Transactional e-mail branding stores a `logoAssetId` and resolves its URL when rendering
  (`packages/modules/transactional_emails/src/backend/services/branding.service.ts:106-122`).
- A CMS image whose source is **URL** stores the pasted string verbatim
  (`resolve-image-url.ts:41`); nothing can follow that string through a replace unless it is a URL
  that survives one.
- `crm` recognises the Library's file route by path suffix `/assets/file/<assetId>` to turn it into a
  download link (`packages/modules/crm/src/backend/services/attachment-active-content.ts:84-89`).

So once a replace exists, every by-id internal reference follows it for free; external references
follow it only if the URL they hold is one that survives a replace.

### Caching: public files are served as immutable for a year

The local file route answers public assets with
`Cache-Control: public, max-age=31536000, immutable` and an ETag of `"<assetId>-<updatedAt seconds>"`
(`packages/modules/assets_library/src/backend/routes.public.ts:101-133`). A browser or CDN honouring
`immutable` does not revalidate, so a file replaced under an unchanged URL would keep being served
stale for up to a year. The S3 adapter sets an ACL on `put` (`s3-adapter.ts:114,173`); neither
cloud adapter sets a cache header, so cloud caching is whatever the bucket or CDN defaults to. Private assets
are `private, no-store` (`routes.public.ts:128-133`) and are reached through signed, expiring URLs with a
TTL from `assets.private_url_ttl_sec` (manifest setting at `.../src/manifest.ts:80-86`).

### Serving policy: content headers, inline types and the signature check

Master serves stored files under a content policy (`.../services/content-policy.ts`, documented at
`docs/assets-library/index.md:54-70`, changeset `.changeset/assets-library-serving-policy.md`):

- Every response of `GET /assets/file/:assetId` carries `X-Content-Type-Options: nosniff` and a
  `Content-Security-Policy` chosen by `servingPolicyFor` (`routes.public.ts:59-61`,
  `content-policy.ts:114-123`): `default-src 'none'; style-src 'unsafe-inline'; sandbox`, and the same
  without `sandbox` for PDF (`content-policy.ts:99,106`).
- Only displayable media — raster images, SVG, video, audio, PDF and plain text — is served
  `Content-Disposition: inline`; every other stored type is an `attachment` whatever the request asks
  (`routes.public.ts:142-146`, `content-policy.ts:78-91,114-123`).
- Uploads of HTML, XHTML, XML (including XSL) and JavaScript are refused with
  `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`, judged by declared type and by extension, independently of
  `assets.allowed_file_types`; SVG is accepted and always stored as `image/svg+xml`
  (`upload-pipeline.ts:108-123`, `content-policy.ts:14-76`).
- For a private asset the platform signature is verified **before** the storage-backend branch: a
  private asset without a valid, unexpired signature answers `403 ASSET_ACCESS_DENIED` on every
  backend, and a private cloud asset with a valid one is redirected to its time-limited storage URL
  (`routes.public.ts:63-90`). The soft-delete check (`410`) runs before the signature check
  (`routes.public.ts:55-57`); this feature reverses that order (FR-013). Covered by `routes.public.test.ts:200-240` and
  `backend/test/contract/assets_library/public-asset-file.contract.test.ts`.
- The policy lives on the API route only. Neither cloud adapter sets `Content-Disposition` (or any
  content-policy header) on the object it writes (`s3-adapter.ts:104-122`, `gcs-adapter.ts:87-104`),
  so a public cloud object is served by the bucket with whatever disposition the bucket defaults to.

### Other facts that bound the design

- No transformation step exists in `assets_library`: its adapters serve the stored bytes unchanged
  (catalog's "thumbnail" is a gallery label, not a rendition).
- Soft delete answers `410 ASSET_GONE` on the file route (`routes.public.ts:55-57`). A sweep that
  hard-deletes the file and row after the retention window exists
  (`.../jobs/hard-delete-asset.job.ts:1-12`, `HardDeleteAssetWorker`), but **nothing schedules it**:
  its header says the repeatable scheduling "lives in composition.ts", and nothing outside the job,
  its integration test (`backend/test/integration/assets_library/hard-delete-worker.test.ts`) and the
  module documentation references the class — so soft-deleted assets are never purged today. The
  sweep selects rows by the stored `purgeAfterAt` (`hard-delete-asset.job.ts:38`).
- Both soft-delete paths read the retention from `assets.soft_delete_retention_days`
  (`manifest.ts:87-93`): a single asset (`assets-library.service.ts:241-244`) and a recursive folder
  delete (`folders.service.ts:206-212`), through `settings-view.ts:43-46` wired in `plugin.ts:83-103`.
  The deadline is **fixed at deletion**: `purgeAfterAt = deletedAt + days` is stored on the row, and a
  later change of the setting does not move it — asserted by
  `.../services/soft-delete-retention.test.ts:74` and
  `backend/test/contract/assets_library/admin-retention.contract.test.ts:87`, stated in the module
  documentation (`docs/assets-library/index.md:94-102`) and in the changeset
  `.changeset/fix-assets-soft-delete-retention.md`. A negative or non-finite value falls back to 30
  days, and `0` makes an asset eligible on the next sweep (`settings-view.ts:43-46`, the same contract
  test's `it.each([7, 90, 0, undefined])` at `:75,96`).
- The module declares **no command-palette action**: `src/admin/index.ts:26-32` records that as a
  deliberate gap ("choosing a landing action for a screen is a product decision") and its off-state
  test asserts the empty answer. The Library screen is `/assets-library` (`src/admin/index.ts`,
  `ROUTE_PATH`).
- Rows on the `legacy` backend point at URLs the platform did not issue; the service refuses to make
  them private for the same reason (`assets-library.service.ts:182-189`).
- `Asset` is a `@GlobalEntity()` (`asset.entity.ts:15`): assets are platform-global, owned by no
  organization and no sales channel.
- Asset writes are audited through `recordAuditFromContext` (`assets-library.service.ts:59-73`,
  `upload-pipeline.ts:249-256`), not through `CommandBus.run`.
- The module declares two permission codes, `assets.read` and `assets.write` (`manifest.ts:241-242`),
  and is `nonDeactivatable` (`manifest.ts:164-168`).
- The storefront has no redirect or alias mechanism; its routing ends in a CMS catch-all
  (`storefront/app/(content)/[...slug]/page.tsx`). The deployment templates already proxy
  `/assets/file/` from the public hostname to the API (`packages/cli/src/new-instance/deploy.ts:1362-1365`;
  the one-host install summary says the same, `packages/cli/src/install/index.ts:2694`) and nothing
  else under `/assets/`; every other path on that host goes to the storefront, where `assets` is not a
  reserved first segment (`storefront/app/reserved-segments.ts:54`).
- An asset's kind is derived from its sniffed MIME type at upload — `image/*` → image, `video/*` →
  video, `application/pdf` → pdf, anything else → other (`upload-pipeline.ts:63-74`); `certificate` is
  a declared kind no upload produces. Product attachments accept `pdf`, `certificate` and `other`
  (`packages/modules/catalog/src/backend/services/attachment.service.ts:33,233-237`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Replace an asset's file and keep every link working (Priority: P1)

An admin keeps a quality certificate in the Assets Library. It is attached to products, linked from a
CMS page, and its link was sent to customers and printed on documents. A renewed certificate arrives.
The admin opens the asset, chooses **Replace file**, and uploads the new PDF. Every place that showed
or linked the old certificate — inside the platform and outside it — now serves the new one; nothing
had to be re-linked.

**Why this priority**: it is the root cause behind the issue. Without it a permalink would have nothing
to point at, and with it alone every existing internal reference and every already-distributed file URL
keeps working.

**Independent Test**: upload an asset, reference it from a product attachment and a CMS page, record
its file URL, replace the file, then fetch the recorded URL and the product/CMS responses — all return
the new content under the same asset id.

**Acceptance Scenarios**:

1. **Given** a public asset with id A and file URL U, **When** an admin with `assets.write` replaces
   its file, **Then** the asset keeps id A, its folder, label, alternate text, visibility and every
   reference, and a request to U returns the new file's bytes, type and size.
2. **Given** a replaced asset, **When** a client that fetched U before the replace requests it again
   with its cached validator, **Then** it receives the new content rather than a "not modified"
   answer, within the freshness bound fixed by FR-011.
3. **Given** a product whose gallery or attachment references A, **When** the storefront product
   page is rendered after the replace, **Then** it shows the new file and no URL in the response
   points at the previous file.
4. **Given** an admin without `assets.write`, **When** they attempt a replace, **Then** it is refused
   and the asset is unchanged.
5. **Given** a replace whose storage write fails, **When** the request ends, **Then** the asset still
   serves its previous file unchanged and no partial new file is left referenced.
6. **Given** a replace, **When** it completes, **Then** an audit entry records who replaced which asset,
   with the previous and new filename, type and size.

---

### User Story 2 — Give an asset a readable permalink (Priority: P2)

The admin wants a link that reads well on a business card or in a contract — for example a path
ending in `certificate.pdf` on the shop's public hostname — instead of a UUID. They set a permalink on
the asset. The permalink serves the asset's current file, and keeps doing so after every replace.

**Why this priority**: it is the issue's proposed solution and what makes a link presentable, but it
only delivers stability on top of User Story 1.

**Independent Test**: set a permalink on a public asset, fetch it, replace the file, fetch it again —
same permalink, new content.

**Acceptance Scenarios**:

1. **Given** a public asset, **When** an admin with `assets.write` sets a valid, unused permalink,
   **Then** requesting `<public base>/assets/file/<permalink>` returns the asset's current file.
2. **Given** an asset with a permalink, **When** its file is replaced, **Then** the permalink serves
   the new file and is itself unchanged.
3. **Given** a permalink already used by another asset, **When** an admin tries to assign it, **Then**
   it is refused with a translated message naming the conflict, and neither asset changes.
4. **Given** a permalink that is malformed or collides with a reserved path (FR-016), **When** an admin
   tries to assign it, **Then** it is refused with a translated message.
5. **Given** an asset with a permalink, **When** an admin changes the permalink, **Then** the new
   permalink serves the asset and the old one behaves as FR-019 states.
6. **Given** the asset detail panel, **When** an admin opens it, **Then** it shows the asset's
   shareable URL (the permalink when one is set, otherwise the file URL) with a copy action.
7. **Given** an admin with `assets.read`, **When** they open the command palette (⌘K / CTRL+K) and
   search for "Assets library", **Then** an entry opens `/assets-library`; an admin without
   `assets.read` does not see the entry (FR-028).
8. **Given** a private asset with a permalink, **When** the permalink is requested without a valid,
   unexpired platform signature — whether or not the asset is soft-deleted — **Then** the answer is
   `404 ASSET_NOT_FOUND`, identical to the answer for a permalink that does not exist; **When** it is
   requested with a valid signature, **Then** a live asset's bytes are served with `private, no-store`
   (FR-018) and a soft-deleted one answers `410 ASSET_GONE` (FR-020).
9. **Given** a permalink that asset X held before and released (changed, removed, or freed by hard
   deletion), **When** an admin assigns it to a **different** asset Y, **Then** the admin is asked to
   confirm that the name was used before; without the confirmation nothing changes, with it the
   permalink is assigned and an audit entry records the reuse (FR-019, FR-037).
10. **Given** a permalink that asset X held before and released, and that no other asset has held
   since, **When** an admin assigns it back to the **same** asset X, **Then** it is assigned without a confirmation and no reuse is recorded; the
   ordinary permalink-change audit entry is written (FR-037).

---

### User Story 3 — See and restore the previous file (Priority: P3)

The admin replaced the certificate with the wrong PDF. They open the asset, see that it was replaced,
when and by whom, and restore the previous file. Every URL and permalink serves the restored file.

**Why this priority**: a safety net for User Story 1; exactly one previous version is kept (Q5).

**Independent Test**: replace a file, restore the previous version, fetch the file URL — the original
bytes are served.

**Acceptance Scenarios**:

1. **Given** an asset replaced at least once, **When** an admin opens its detail, **Then** they see the
   previous version kept under FR-022 with filename, type, size, replace date and who replaced it.
2. **Given** a kept previous version, **When** an admin with `assets.write` restores it, naming both
   the current version and the previous version they were shown, **Then** it becomes the current
   version under the same asset id and every URL serves it; the restore is audited.
3. **Given** a previous version older than `assets.soft_delete_retention_days`, **When** the cleanup
   runs, **Then** its file is removed from storage and it no longer appears as restorable.
4. **Given** an asset that already has a kept previous version, **When** it is replaced again, **Then**
   the older previous version is discarded (its file removed) and the file just replaced becomes the
   one previous version.
5. **Given** an admin who opened an asset's detail, **When** the asset's current or previous version
   changes (another replace or restore) before they confirm a restore, **Then** their restore is
   refused with `409 ASSET_REPLACE_CONFLICT` and nothing changes — whether the current version, the
   previous version or both are stale (FR-023).

---

### User Story 4 — Deleted assets are purged after the retention period (Priority: P3)

An operator sets `assets.soft_delete_retention_days` to the period their business needs. An admin
deletes an asset, or a whole folder. The assets stay restorable for that period and are then removed
for good — file and row — without anyone having to act.

**Why this priority**: master reads the setting when an asset is deleted, but nothing schedules the
purge sweep, so deleted files are never removed from storage (see *Current state*). The sweep is
shared with the previous-version cleanup of User Story 3 (FR-022) and both follow one retention rule,
so both are delivered together. This story deliberately changes master's due rule from "fixed at
deletion" to "read when the sweep runs" (FR-030).

**Independent Test**: set the retention to N days, soft-delete an asset and a folder holding assets,
run the sweep with a clock N days later — the files are gone from storage, the rows are gone, the file
URLs answer `404`; an asset deleted fewer than N days earlier is untouched.

**Acceptance Scenarios**:

1. **Given** `assets.soft_delete_retention_days` = N, **When** an admin soft-deletes an asset and the
   sweep runs more than N days later, **Then** the asset's file is removed from storage, the row is
   removed, and its file URL (and permalink, if it had one) answers `404`.
2. **Given** the same setting, **When** an admin deletes a folder recursively, **Then** every asset in
   the subtree follows the same rule as a single delete — restorable for N days, purged afterwards.
3. **Given** a soft-deleted asset within the retention period, **When** the sweep runs, **Then** the
   asset is untouched and can still be restored; once restored it is never purged by that deletion.
4. **Given** a purge whose storage delete fails, **When** the sweep runs, **Then** the row stays
   soft-deleted and marked for cleanup, and a later sweep retries it.
5. **Given** a deployment that ships this feature onto a database holding assets soft-deleted longer
   ago than the retention period, **When** the sweeps after deployment run, **Then** all of those
   assets are purged, at most the per-sweep cap in each sweep and the remainder in the following
   sweeps (FR-035) — and the module documentation and the release changeset say so before it happens
   (FR-034).
6. **Given** a purged asset that had a kept previous version, **When** it is purged, **Then** the
   previous version's file is removed from storage as well.
7. **Given** an asset soft-deleted at time D under a retention of 30 days, **When** the setting is
   changed to 7 days and the sweep runs after D + 7 days, **Then** the asset is purged; and the purge
   date the admin API reports for it is D + 7 days from the moment the setting changes (FR-030).
8. **Given** `assets.soft_delete_retention_days` set to `0` (or any value between 0 and 1), **When** an asset is
   soft-deleted and the sweep runs less than one day later, **Then** the asset is untouched; it is
   purged once one day has elapsed (FR-035).
9. **Given** more due assets than the per-sweep cap, **When** a sweep runs, **Then** it purges at most
   the cap, leaves the rest for later sweeps, and writes one structured log line with the counts and
   the retention used (FR-035).

---

### Edge Cases

- **Caching and CDNs.** Public files are cached as `immutable` for a year today. Under the split
  answer (Q3, R2-2) the bare file URL and the permalink are served `no-cache` with an ETag
  (FR-011), and the URLs the platform embeds itself carry a version marker and keep long-lived caching
  (FR-012). A stale-marker URL — an image in an e-mail sent before the replace, a feed a consumer
  fetched earlier — redirects to the current version's URL when it reaches the API's file route, and
  serves the current file when it is a cloud bucket URL, which cannot redirect (FR-012a, round 3 Q3).
  A third-party CDN configured in front of `assets.*.public_base_url` is outside the platform's control;
  the documentation must tell operators what the platform does and what they must configure (FR-027).
- **Replacing with a different type or extension.** Allowed only within the same kind (Q4): a JPEG
  with a PNG or a WebP (image → image), a PDF with a PDF, an MP4 with a WebM, and — because every
  other type shares the kind `other` — a DOCX with an XLSX. A PDF replaced with a DOCX (pdf → other) or
  an image with a PDF is refused (FR-006). The asset's URL and permalink do not change, including on
  S3/GCS where the locator carries the extension (FR-005); the served `Content-Type` and download
  filename follow the new file.
- **Kind comparison.** The asset's kind is its **stored** kind (`certificate` counted as pdf); the new
  file's kind comes from what its bytes are recognised as, with an SVG counting as an image. A MIME
  type the client declares, or one an admin set on the asset, plays no part. A file declared as an
  image or a PDF whose bytes are not recognised as one counts as `other`, so it cannot replace an
  image or a PDF (FR-006, Assumption A-8).
- **A manually overridden MIME type.** An asset whose MIME type an admin overrode
  (`mimeTypeOverridden`) — the override does not affect the kind check (FR-006); after a replace the
  new file is sniffed again and the override is cleared.
- **Filename.** After a replace the asset's filename becomes the new file's name (it drives
  `Content-Disposition`); the permalink is independent of the filename.
- **Deleting an asset that has a permalink.** Soft delete keeps answering `410 ASSET_GONE` on the
  file URL and on the permalink of a public asset (a private one answers by id under FR-013 and by
  permalink under FR-018 — `410` only with a valid signature); restoring the asset
  restores both. A permalink is not by itself an
  internal reference that blocks deletion — it is the asset's own attribute — but when the asset has a
  permalink, the delete confirmation tells the admin so (FR-020; no confirmation exists today, and none
  is added for an asset without one). After hard deletion (FR-031) the permalink is released and
  answers `404`.
- **Private or restricted assets.** Private assets are served only with a valid platform signature,
  on every storage backend (FR-013). The permalink is served by the same API next to the file route
  (Q2) and requires the same signature, but answers differently without one (P2): it answers
  `404 ASSET_NOT_FOUND`, identical to a permalink that does not exist, so a readable name reveals
  nothing about a private asset; the signature check runs before the soft-delete check, so a
  soft-deleted private asset without a valid signature also answers `404` (FR-018, FR-020). By id the
  file route keeps answering `403 ASSET_ACCESS_DENIED` without a valid signature, and the signature
  check precedes the soft-delete check there too: a soft-deleted private asset answers `403` by id
  without a valid signature, exactly as a live one, and `410` only with one (FR-013, owner ruling B1).
  An admin may keep or set a permalink
  on a private asset; the panel says that it is not publicly reachable while the asset is private.
- **Visibility change.** A public asset with a permalink made private: the permalink stops serving the
  bytes publicly at once and answers `404` without a valid signature (FR-018).
- **Cloud objects and the serving policy.** The API route sends a content policy and a disposition per
  type (see *Current state*); a bucket serves the object's stored metadata only. Objects written by
  this feature on S3/GCS carry `Content-Disposition: attachment` for SVG and for every type outside
  the inline-display list, so opening such a URL directly downloads the file, while embedding an SVG
  through `<img>` keeps working (FR-036).
- **Renamed assets.** Renaming the asset's filename or label does not change its file URL or its
  permalink.
- **Changing or removing a permalink.** The old permalink answers `404` at once, with no redirect, and
  is free for another asset (FR-019, A-5 accepted); the panel warns before a set permalink is changed.
  Taking a name that a **different** asset held before — including one since hard-deleted — asks the
  admin to confirm and is audited as a reuse; an asset taking back a name it released itself, which
  no other asset has held since, needs no confirmation and records no reuse (FR-037, P5, owner ruling
  B3).
- **Replacing twice within the retention period.** Only one previous version is kept (Q5): the second
  replace discards the older previous file.
- **Legacy-backend rows.** An asset whose file lives at a URL the platform did not issue cannot have
  its bytes replaced in place; the replace is refused with a translated message (FR-008), the same
  stance the module already takes for making such rows private.
- **Switching the active storage backend.** An asset stored on `local` is replaced while the active
  adapter is `s3`. The replace must not change the asset's URL; the plan decides whether the new file
  goes to the asset's existing backend or the asset migrates, under FR-005.
- **Concurrent replaces.** Two admins replace the same asset at once: one wins entirely; the asset
  never ends up with one admin's bytes and the other's metadata.
- **Upload policy.** A replace obeys the same size and type policy as an upload
  (`assets.allowed_file_types`, `assets.max_file_size_mb`, the refusal of HTML, XHTML, XML and
  JavaScript documents, SVG stored as `image/svg+xml`; FR-003).
- **Frozen URL copies.** Consumers that still read `storageUrl` (catalog) must see a URL that serves
  the current version after a replace (FR-007).
- **Form of the version marker.** `crm` recognises the file route by the path suffix
  `/assets/file/<assetId>` (`attachment-active-content.ts:84-89`); a marker carried as a query
  parameter keeps that working, one carried as a path segment would break it. The plan chooses the
  form and must keep that consumer working.
- **Cloud backends.** On S3/GCS the bare file URL already handed out is the bucket URL of the
  object's key (`s3-adapter.ts:127`), and the object's cache header applies to whatever URL reaches
  that key. The plan must reconcile FR-005, FR-011 and FR-012 on cloud backends — the bucket URL
  already distributed keeps serving the current file and revalidates. A bucket cannot redirect, so a
  cloud URL carrying a stale version marker serves the current file — never the previous one
  (FR-012a, round 3 Q3); long-lived caching of cloud images is the job of the operator's CDN in front
  of the bucket, and the documentation states what it needs (FR-027).
- **Retention change and existing deletions.** Decided by the product owner (2026-10-18, P1): the
  sweep evaluates the retention period from the setting when it runs (FR-030), so shortening or
  lengthening `assets.soft_delete_retention_days` applies to assets already soft-deleted, and the
  sweeps after deployment purge every asset soft-deleted longer ago than the period, up to the
  per-sweep cap each (FR-034, FR-035). The purge date the admin API reports is derived from the
  current setting in the same way. This replaces master's fixed-at-deletion deadline (see *Current
  state*); the stored `purgeAfterAt` is no longer what decides a purge.
- **Retention of zero or less.** Master treats `0` as "eligible on the next sweep". With this feature
  the effective retention is never below one day (P3): a value from `0` up to 1 is applied as 1, a
  negative, missing or non-numeric value as the default 30, as on master (FR-035). The same floor applies to previous versions (FR-022).
- **A large backlog.** A sweep purges at most the per-sweep cap of assets, oldest deletion first; the
  rest wait for the following sweeps (FR-035).
- **Restore of a soft-deleted asset.** Restoring an asset before its purge clears it from the sweep;
  a later delete starts a new retention period.
- **Restore twice.** Because a restore swaps (R2-5), restoring again returns to the file that was
  current before the first restore; each swap starts a new retention period for the file it demotes.
- **Pasted URLs.** A CMS image block whose source is "URL" and holds a pasted file URL keeps working
  only because the file URL itself is stable; a pasted URL of something else is not this feature's
  concern.
- **Feeds and e-mails already sent.** A product feed consumer or an e-mail already delivered holds an
  absolute file URL; they see the new content after the replace, subject to the same freshness bound.

## Requirements *(mandatory)*

### Functional Requirements

**Replace**

- **FR-001**: An admin with `assets.write` MUST be able to replace the file of an existing asset from
  the Assets Library admin screen and through the admin API.
- **FR-002**: A replace MUST keep the asset's id, folder, label, alternate text, visibility, permalink
  and every internal reference unchanged, and MUST update its filename, MIME type (re-sniffed as on
  upload), kind (as FR-006 states, a stored `certificate` being kept) and size to those of the new
  file.
- **FR-003**: A replace MUST apply the same upload policy as a new upload (allowed types, maximum
  size, content sniffing, the refusal of HTML, XHTML, XML and JavaScript documents, and storing SVG as
  `image/svg+xml`) and refuse with the same error codes.
- **FR-004**: A replace MUST be atomic from a reader's point of view: until it commits, every URL
  serves the previous file; after it commits, every URL serves the new file; on failure the asset is
  unchanged and no orphaned file remains referenced.
- **FR-005**: The asset's public file URL (the bare file URL, not a cache-busting form the platform
  embeds itself under FR-012) MUST NOT change because of a replace, on every storage backend,
  including when the new file has a different extension.
- **FR-006**: A replace MUST be refused, with a translated error naming the current and the new kind,
  when the new file's kind differs from the asset's current kind (A-8):
  - the **current kind** is the asset's **stored** kind, with `certificate` compared as pdf; a MIME
    type an admin set on the asset (an override) plays no part;
  - the **new kind** is derived from what the new file's bytes are **recognised** as, by the upload
    rule (`image/*` → image, `video/*` → video, `application/pdf` → pdf, anything else → other); a
    file whose bytes are not recognised counts as `other`, except an SVG, which counts as an image. A
    MIME type supplied by the admin or the client is **ignored** for this decision, so a file counts
    as an image, a video or a PDF only when its bytes are recognised as one.

  Within the same kind the extension, MIME type and filename may change, and the asset's filename
  becomes the new file's name. After a replace the stored kind is the new kind, except that a stored
  `certificate` stays `certificate`. No internal reference can be invalidated by a replace, and this is
  satisfied **by construction**, not by a runtime check: every reference constraint is a constraint on
  the stored kind, the same-kind rule keeps it fixed, and a stored `certificate` is never re-derived,
  so every reference that accepted the asset before accepts it after. A restore performs no kind check
  (the previous version passed this check when it was current). *(Architect amendment, 2026-10-16;
  current kind and new kind restated by owner ruling B2, 2026-10-18.)*
- **FR-007**: After a replace or restore, every cross-module read of the asset's URL (including the
  deprecated `storageUrl` on `AssetRecord`) MUST yield a URL that serves the current version. Because
  catalog builds storefront image URLs from `storageUrl` (`gallery.service.ts:178`), the value it reads
  MUST change with every replace and restore (or carry the current version marker under FR-012) —
  never stay the upload-time copy.
- **FR-008**: A replace on an asset whose storage backend is `legacy` MUST be refused with a
  translated error.
- **FR-009**: Concurrent replaces of the same asset MUST serialise; the losing request either fails
  with a conflict or is applied wholly after the winner — never interleaved.
- **FR-010**: Every replace MUST be audited with the actor, the asset, and the previous and new
  filename, MIME type and size.

**Caching**

- **FR-011**: A public asset's bare file URL and its permalink MUST be served as `no-cache` with a
  validator (ETag) that changes with every replace and restore — never `immutable`, never a freshness
  lifetime — so every fetch revalidates and a client or shared cache that honours the header receives
  the new content on its first request after a replace (R2-2). An unchanged file answers `304 Not
  Modified` to a matching validator. The documentation states this behaviour.
- **FR-012**: The URLs the platform embeds itself — storefront responses (catalog images, galleries,
  attachments), CMS and page-builder renders, and transactional e-mails — MUST carry a marker of the
  asset's current version and MAY be served with long-lived immutable caching; after a replace or
  restore, newly rendered embeds carry the new marker. Product feed image links (`image_link`,
  `additional_image_link`) MUST carry the marker as well, so a replaced image changes the URL a feed
  consumer sees (R2-4). The versioned form is never shown to the admin as the shareable URL (FR-021),
  and the marker's form must keep the `/assets/file/<assetId>` path suffix intact (see *Edge Cases*).
- **FR-012a**: A request whose version marker is not the asset's current one MUST NOT serve the
  previous file (FR-024), on any backend:
  - on the API's file route (the local backend, and any request that reaches the API), it MUST
    redirect to the URL of the current version (R2-3), with a temporary redirect that is not itself
    cached long-term, so a later replace is followed too;
  - on a cloud bucket URL (S3, GCS), where the bucket cannot redirect, it MUST serve the current file
    (round 3 Q3). Long-lived caching of cloud images is the operator's CDN's responsibility, which the
    documentation describes (FR-027).

  A stale-marker URL of a private asset follows FR-013 (by id) or FR-018 (by permalink) first; a
  stale-marker URL of a soft-deleted public asset, or of a soft-deleted private one carrying a valid
  signature, answers `410 ASSET_GONE` on the API route.
- **FR-013**: Private assets are served only with a valid platform signature, on every storage
  backend. Requested **by id** (`/assets/file/<assetId>`, with or without a version marker), the API
  route checks the signature **before** the soft-delete state: a private asset without a valid,
  unexpired signature answers `403 ASSET_ACCESS_DENIED` whether it is live or soft-deleted, so the
  answer reveals nothing about deletion; with a valid signature a soft-deleted private asset answers
  `410 ASSET_GONE`. An id is a random UUID, so the `403` reveals no readable name. A soft-deleted
  **public** asset requested by id keeps answering `410 ASSET_GONE`. Requested **by permalink**,
  FR-018 applies (`404` without a valid signature, also checked before `410`). *(Owner ruling B1,
  2026-10-18: this reverses master's order, where `410` was answered before the signature check.)*
  Private assets keep `private, no-store`
  caching and expiring signed URLs (`assets.private_url_ttl_sec`), and every response keeps master's
  serving policy (`nosniff`, content security policy, inline only for displayable media).

**Permalinks**

- **FR-014**: An admin with `assets.write` MUST be able to set, change and remove one permalink on an
  asset, from the asset detail panel and the admin API.
- **FR-015**: A permalink MUST be unique across the platform (assets are platform-global), compared
  case-insensitively.
- **FR-016**: A permalink MUST be served on the public base of the asset URLs (the same base as the
  file route) at `<public base>/assets/file/<permalink>` (Q2, R2-1), so it reaches the API through
  every reverse proxy configured from today's templates with no change. It MUST be validated: a
  relative path of segments made of letters, digits, `-`, `_` and `.`, separated by `/`; no empty,
  `.` or `..` segments; a bounded length; and it MUST NOT have the shape of a UUID, so it can never be
  mistaken for an asset id. A rejected permalink returns a translated validation message.
- **FR-017**: A request for a permalink MUST serve the asset's current version with the same headers
  as its file URL (type, length, disposition, `nosniff`, content security policy, cache policy per
  FR-011/FR-012), and `?download=1` MUST behave as it does on the file URL.
- **FR-018**: A permalink request for a private asset without a valid, unexpired platform signature
  for that asset MUST answer `404 ASSET_NOT_FOUND`, **identical** — status, error code, body and
  headers — to a request for a permalink that does not exist; with a valid signature it serves the
  bytes with `private, no-store` caching. The signature check runs **before** the soft-delete check
  (FR-020), so a soft-deleted private asset without a valid signature also answers `404`. A permalink
  MAY be set on or kept by a private asset, and the detail panel MUST state that it is not publicly
  reachable while the asset is private. Making a public asset with a permalink private takes effect on
  the permalink on the next request. *(Owner ruling P2, 2026-10-18; supersedes the `403` answer
  confirmed on 2026-10-16. By id the route keeps `403`, with the same signature-first order, FR-013.)*
- **FR-019**: When a permalink is changed or removed, the old permalink MUST answer `404` (it does not
  redirect), and is immediately free to be assigned to another asset, subject to FR-037. The panel
  MUST warn before a set permalink is changed or removed. *(A-5, accepted by the product owner
  2026-10-16; reuse confirmation added by owner ruling P5, 2026-10-18.)*
- **FR-020**: A permalink request for a soft-deleted **public** asset MUST answer `410 ASSET_GONE`; a
  soft-deleted private asset follows FR-018 first (`404` without a valid signature, `410` with one;
  by id, FR-013 gives `403` and `410` respectively).
  After hard deletion the permalink is released (and remembered as used, FR-037) and answers `404`.
  When the asset has a permalink, deleting it MUST ask for confirmation stating that the asset has a
  public permalink; an asset without a permalink keeps today's delete flow, which has no
  confirmation. *(Architect amendment, 2026-10-16; private ordering by owner ruling P2, 2026-10-18.)*
- **FR-021**: The asset detail panel MUST show a shareable URL — the absolute permalink when set,
  otherwise the absolute file URL — with a copy-to-clipboard action, and the Library list MUST let an
  admin find assets by permalink in the existing search.

**Versions**

- **FR-022**: After a replace the platform MUST keep exactly **one** previous version of the asset —
  the file it held immediately before — restorable for the number of days in the
  `assets.soft_delete_retention_days` setting (default 30), read from the setting at the time of
  cleanup, never less than one day (FR-035), and counted from the replace. When the period ends, or when a further replace supersedes it,
  the previous file is removed from storage and is no longer restorable.
- **FR-023**: An admin with `assets.read` MUST see the asset's kept previous version (filename, type,
  size, replaced at, replaced by); an admin with `assets.write` MUST be able to restore it, which
  behaves as a replace (FR-002 – FR-012a, without FR-006's kind check) and is audited. A restore
  request MUST carry both the current version (`expectedContentVersion`) and the previous version
  (`expectedPreviousContentVersion`) the admin was shown; when either differs from the asset's at the
  time of the restore it MUST be refused with `409 ASSET_REPLACE_CONFLICT` and nothing changes, so an
  admin restores exactly the file they saw. A restore MUST swap (R2-5): the file that
  was current becomes the one previous version, with a new retention period counted from the restore,
  so a restore can itself be undone.
- **FR-024**: A previous version MUST NOT be reachable through the asset's file URL, its permalink or
  any versioned URL. This feature provides no download of a previous version; an admin inspects it
  by restoring it (FR-023). *(Architect amendment, 2026-10-16: an admin-authorised download was
  optional and is not built.)*

**Cross-cutting**

- **FR-025**: Every new user-facing string (admin labels, confirmation copy, error messages for every
  new error code) MUST ship in English and Polish, through the module's own `i18n/{en,pl}.json` and
  manifest-declared error codes.
- **FR-026**: Replace, permalink and restore mutations MUST be gated by `assets.write`; viewing
  versions and the shareable URL by `assets.read`. No new permission code is introduced
  (Assumption A-3).
- **FR-027**: The module's documentation page MUST describe replacing a file, permalinks, the
  freshness bound after a replace, what an operator running a CDN in front of the bucket or the API
  must configure — including that on S3/GCS a stale-marker URL serves the current file and that
  long-lived caching of cloud images is the CDN's job (FR-012a) — the soft-delete retention setting
  and the purge (FR-029 – FR-035), the `404` answer of a private asset's permalink (FR-018), the
  disposition of cloud objects (FR-036), the confirmation when taking a permalink another asset held
  (FR-037), the same-kind rule judged on the stored kind and the file's recognised content (FR-006),
  and
  correct the current statement that public URLs are stable to say exactly which URLs are stable and
  under what conditions. It MUST replace master's statement that a changed retention does not
  reschedule assets already soft-deleted and that `0` makes an asset eligible on the next sweep
  (`docs/assets-library/index.md:99-102`).
- **FR-028**: The new admin actions (replace file, set permalink) MUST be reachable from the asset
  detail panel; no new admin page is introduced. The module MUST add a command-palette entry
  "Assets library" (English and Polish, FR-025) that opens `/assets-library`, gated by `assets.read`;
  the module has no palette entry today (`src/admin/index.ts:26-32`), and the off-state test that
  asserts the empty answer is updated to assert this entry. *(Round 3 Q2.)*

**Retention and purge** *(round 3 Q1; owner rulings P1 and P3, 2026-10-18)*

- **FR-029**: Soft-deleting a single asset and deleting a folder recursively MUST apply the retention
  period from the `assets.soft_delete_retention_days` setting; neither path may hard-code a period.
  *(Already true on master; kept as a requirement so the change of FR-030 cannot regress it.)*
- **FR-030**: An asset soft-deleted at time D is due for purge when D plus the effective retention
  period (FR-035) read from the setting **when the sweep runs** has elapsed — the same rule FR-022
  applies to previous versions. A changed setting therefore applies to assets already soft-deleted;
  the sweep MUST NOT decide on a deadline stored at deletion. Any purge date the admin API reports
  (`purgeAfterAt`) MUST be derived the same way — deletion time plus the setting's current effective
  value — so it agrees with the sweep. **This is a deliberate behaviour change** from master, where the
  deadline is fixed at deletion: master's unit and contract tests that assert the fixed deadline
  (`soft-delete-retention.test.ts:74`, `admin-retention.contract.test.ts:87`), its documentation
  (FR-027) and the release changeset (FR-034) are changed to state the new rule. *(Owner ruling P1,
  2026-10-18.)*
- **FR-031**: The purge sweep MUST be scheduled as a repeating job and run without operator action.
  Purging an asset removes its file from storage, removes the row, releases its permalink (FR-020;
  the name stays remembered as used, FR-037) and removes the file of its kept previous version, if any
  (FR-022). The same sweep removes expired previous versions (FR-022).
- **FR-032**: When a storage delete fails, the asset MUST stay soft-deleted and marked for cleanup,
  and a later sweep MUST retry it; a failure on one asset MUST NOT stop the sweep for the others.
- **FR-033**: Restoring a soft-deleted asset before it is due MUST remove it from the sweep; a later
  soft delete starts a new retention period.
- **FR-034**: Because no purge has ever run, the sweeps after deployment purge every asset
  soft-deleted longer ago than the retention period, up to the per-sweep cap each (FR-035). The module
  documentation and the release changeset MUST state this consequence, how an operator who wants to
  keep those assets can lengthen the setting before upgrading, and — as a behaviour change — that a
  changed retention now applies to assets already soft-deleted (FR-030) and that the effective
  retention is never below one day (FR-035).
- **FR-035**: The purge sweep MUST apply three safeguards *(owner ruling P3, 2026-10-18)*:
  - **a per-sweep cap** — one sweep purges at most **500** soft-deleted assets, oldest deletion first,
    and leaves the remainder for the following sweeps; expired previous-version files removed in the
    same sweep are bounded by the same number, counted separately;
  - **one structured log line per sweep**, written whether or not anything was due, carrying the
    retention used (days), the number of assets purged, the number whose storage delete failed and
    were left marked for cleanup, the number of previous-version files removed, and the number of due
    assets left for later sweeps;
  - **a minimum effective retention of one day** — a setting value from `0` up to (not including) 1
    is applied as 1 day; a negative, missing or non-numeric value is applied as the default 30, as on
    master. The effective value is what FR-022, FR-030 and the reported `purgeAfterAt` use. This
    changes master's rule that `0` makes an asset eligible on the next sweep.
- **FR-036**: On cloud backends (S3, GCS), every object this feature writes — on upload, replace and
  restore — MUST carry a `Content-Disposition` derived from the API route's serving policy:
  `attachment` for every type outside the inline-display list, and `attachment` for SVG as well,
  because a bucket cannot send the content security policy under which the API route displays SVG
  inline. Types on the inline list other than SVG are stored `inline`. Embedding an SVG through
  `<img>` keeps working. A visibility change or a restore MUST NOT leave an object with a disposition
  that disagrees with this rule. *(Owner ruling P4, 2026-10-18.)*
- **FR-037**: The platform MUST remember every permalink an asset has held and released (changed,
  removed, or freed by hard deletion), together with the asset that last held it. A freed permalink is
  immediately assignable (FR-019), but assigning a remembered name to an asset **other than the one
  that last held it** MUST be refused with a distinct, translated conflict error unless the request
  carries an explicit confirmation; the admin panel shows a confirmation dialog naming that the
  permalink was used before, and on a confirmed reuse the permalink-change audit entry additionally
  records that it was a reuse and the asset that held the name before. The asset that last held the
  name taking it back (no other asset having held it since) needs no confirmation and records no
  reuse; the ordinary audit entry of a permalink change (FR-014, Constraints XIII) is still written. *(Owner ruling P5,
  2026-10-18; scoped to a different asset by owner ruling B3, the same day.)*

### Key Entities

- **Asset** — gains an optional **permalink** and a notion of current version; its id is the stable
  identity every internal reference already uses.
- **Asset version** — a file an asset holds or held: storage location, filename, MIME type, kind, size,
  created at, created by; exactly one is current.
- **Permalink** — a unique, validated path owned by exactly one asset at a time.
- **Released permalink** — a name some asset held and released, with the asset that last held it;
  kept so that another asset taking it asks for confirmation and is audited as a reuse (FR-037). It
  owns no asset and serves nothing (`404`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin replaces an asset's file in one action from the asset panel, with zero
  re-linking of products, CMS pages, e-mails or feeds.
- **SC-002**: 100% of internal references and previously issued public file URLs serve the new
  content after a replace, within the freshness bound of FR-011, on local, S3 and GCS backends.
- **SC-003**: A permalink set before any number of replaces serves the current file after each one.
- **SC-004**: No private asset's bytes are obtainable through a permalink or file URL without a valid
  authorisation, before or after a replace or visibility change.
- **SC-005**: A wrong replace is undone (restore previous version) in one action within the retention
  window, with the original bytes served afterwards.
- **SC-006**: Every new admin string and error message renders in both English and Polish.
- **SC-007**: With the retention set to N days (N ≥ 1), 100% of assets soft-deleted (singly or through
  a folder) more than N days before a sweep are gone from storage and from the Library once the sweeps
  have worked through them at no more than the per-sweep cap each (FR-035), and none deleted fewer
  than N days before a sweep is touched by it.
- **SC-008**: No request by permalink distinguishes a private asset from a permalink that does not
  exist without a valid signature (FR-018).

## Assumptions

- **A-1**: Assets stay platform-global; permalinks are platform-global and not per sales channel.
- **A-2**: One permalink per asset is enough; several aliases for one asset are out of scope.
- **A-3**: `assets.write` covers replace, restore and permalink management; `assets.read` covers
  viewing versions and copying the shareable URL.
- **A-4**: *(Withdrawn 2026-10-16, round 3 Q1 — the soft-delete retention and the purge are now in
  scope; see FR-029 – FR-035.)*
- **A-5**: *(Accepted by the product owner 2026-10-16.)* An old permalink is not redirected after a
  change; operators are expected to treat a permalink as permanent, and the admin UI warns before
  changing one that is set.
- **A-6**: Replacing does not re-run any external delivery (feeds are not regenerated, e-mails are not
  resent); they pick up the new content the next time their URL is fetched.
- **A-7**: The asset's existing file URL form (`/assets/file/<assetId>` on local) keeps working for
  every asset, with or without a permalink.
- **A-8**: The "same kind" rule (Q4) compares the asset's **stored** `kind` (with `certificate`
  counted as pdf) with the kind of what the new file's bytes are recognised as (an SVG counting as an
  image, unrecognised bytes as `other`); a declared or overridden MIME type plays no part (FR-006,
  owner ruling B2, 2026-10-18 — this replaces the earlier reading that compared kinds derived from
  MIME types).

## Out of scope

- Image transformations, resizing or format negotiation.
- Per-sales-channel or per-organization assets or permalinks.
- Bulk replace (one asset at a time).
- A general-purpose redirect manager for the storefront.
- Purging third-party CDNs the platform does not operate; the documentation tells the operator what to
  configure (FR-027).
- Migrating the module's existing writes from `recordAuditFromContext` to `CommandBus.run` (see
  *Constraints*).
- Removing the deprecated `storageUrl` column; this feature only keeps it truthful (FR-007).
- Full version history; exactly one previous version is kept (Q5).

## Clarifications

### Session 2026-10-16

- Q: Scope — replace only, permalinks only, or both? → A (product owner): Both, with restore: replace
  the file in place (P1), readable permalinks (P2), restore the previous version (P3).
- Q: Where is a permalink served? → A (product owner): On the public API address, next to the files:
  `<public base>/assets/<permalink>`. Not on the storefront root and not per sales channel. *(The exact
  path was refined in round 2 to `/assets/file/<permalink>`; see below.)*
- Q: How quickly does everyone see the new file after a replace (caching)? → A (product owner): Split.
  The bare file URL and the permalink get a short cache with revalidation; the URLs the platform embeds
  itself (storefront, CMS, e-mails) carry a version marker and keep long-lived caching.
- Q: May a replace change the file type? → A (product owner): Only within the same kind (image → image,
  PDF → PDF, video → video); the extension and the filename may change, and the filename is taken from
  the new file.
- Q: What happens to the previous file after a replace? → A (product owner): One previous version is
  kept and restorable for the retention period — the existing `assets.soft_delete_retention_days`
  setting (default 30 days), read from the setting rather than hard-coded.
- Q: After a permalink is changed or removed, does the old one redirect? → A (product owner): No. The old
  permalink answers `404` (Assumption A-5 accepted).
- Q (round 2): Exact permalink path — `/assets/<permalink>` or `/assets/file/<permalink>`? (Asked after measuring
  that today's proxy templates route only `/assets/file/` to the API.) → A (product owner):
  `/assets/file/<permalink>`; it works on today's proxies, and a permalink may not have the shape of a
  UUID. Refines the Q2 answer.
- Q: How short is the cache of the bare file URL and the permalink? → A (product owner): Always
  revalidate — `no-cache` with an ETag.
- Q: What does a URL with a stale version marker answer (for example an image in an e-mail sent
  earlier)? → A (product owner): It redirects to the current version's URL.
- Q: Do product feeds get versioned image URLs? → A (product owner): Yes, like the storefront.
- Q: Does restoring the previous version swap or discard the current file? → A (product owner): Swap —
  the current file becomes the previous version with a new retention period, so a restore can be undone.
- Q: Private asset permalink (FR-018 as derived from Q2) — confirmed? → A (product owner): Confirmed as
  written: without a valid signature it answers `403`; a permalink may be kept on a private asset; the
  admin is shown that it is not public. *(The `403` answer on the permalink is superseded by owner
  ruling P2, 2026-10-18, below; the rest stands.)*
- Q (round 3, Q1): Does this feature also make soft delete honour `assets.soft_delete_retention_days`
  and actually purge soft-deleted assets? → A (product owner): Yes — for single deletes and recursive
  folder deletes, with the purge job wired; the pull request closes #293 (the separate purge issue
  has since been closed by master's retention fix, which left the sweep unscheduled — this feature
  still wires it). The first sweeps after deployment purge every asset soft-deleted longer ago than
  the retention period, and the documentation and changeset must say so (FR-029 – FR-035; A-4
  withdrawn).
- Q (round 3, Q2): Should the Library get a command-palette entry? → A (product owner): Yes — "Media
  library", opening `/assets-library`, gated by `assets.read` (FR-028; the module has none today).
- Q (round 3, Q3): On S3/GCS, what does a URL with a stale version marker answer, given a bucket
  cannot redirect? → A (product owner): Option A — it serves the current file, never the previous one;
  long caching of cloud images is the operator's CDN's job, described in the documentation. The
  redirect answer above applies to the API's file route (FR-012a).

### Session 2026-10-18

- *(Duplicate of Q (P1) below, recorded before it; answered there, no open question.)* Q: Does a
  changed retention setting apply to assets already soft-deleted? → A (product owner): Yes — due =
  deletion time + the setting's current value, read when the sweep runs; the admin API's
  `purgeAfterAt` is derived the same way (FR-030).
- Q (P1): Master now fixes the purge deadline at deletion (its retention fix, with a unit test, module
  documentation and changeset). Keep the read-at-sweep rule, or adopt master's? → A (product owner):
  Option A — keep "deletion time + the current retention value, read at sweep time" (FR-030). This
  feature deliberately changes master's fixed-at-deletion behaviour, its tests, documentation and
  changeset, and states it as a behaviour change (FR-030, FR-034).
- Q (P2): What does a request by permalink answer for a private asset without a valid signature? →
  A (product owner): Option A — `404`, identical to a permalink that does not exist; the
  visibility/signature check runs before the soft-delete (`410`) check, so a private soft-deleted
  asset without a valid signature also answers `404`. By id the file route keeps `403` (FR-013,
  FR-018, FR-020; the by-id order for a soft-deleted private asset is settled by B1 below).
- Q (P3): Does the purge sweep need safeguards? → A (product owner): Option A — a per-sweep cap on
  purged assets (500, the rest in later sweeps), one structured log line per sweep with the counts and
  the retention used, and a minimum effective retention of one day (FR-035).
- Q (P4): How are files served directly from a cloud bucket, which cannot send the API route's
  content policy? → A (product owner): Option A — SVG and every type outside the inline-display list
  are stored with `Content-Disposition: attachment` (embedding through `<img>` still works); the
  disposition follows the same serving policy as the API route (FR-036).
- Q (P5): May a freed permalink be taken again? → A (product owner): Option A — immediately, but
  taking a name used before asks the admin for confirmation and writes an audit entry (FR-019,
  FR-037). *(Scoped by B3 below to a name another asset held.)*
- Q (B1): For a request **by id** to a soft-deleted private asset, which check comes first — the
  signature or the deleted state? → A (product owner): The signature. Without a valid signature it
  answers `403 ASSET_ACCESS_DENIED`, as a live private asset does, so nothing about the deletion is
  revealed; with a valid signature it answers `410 ASSET_GONE`. A soft-deleted public asset keeps `410`.
  This matches the permalink order of P2 (FR-013, FR-018, FR-020).
- Q (B2): What decides an asset's kind for the same-kind rule of a replace? → A (product owner):
  Option A — the asset's stored kind (`certificate` counted as pdf) against what the new file's bytes
  are recognised as; a MIME type the admin or the client supplies is ignored, and a file counts as an
  image or a PDF only when its bytes are recognised as one (an SVG counting as an image), otherwise it
  is `other` (FR-006, A-8).
- Q (B3): Does an asset taking back a permalink it released itself need the reuse confirmation? →
  A (product owner): Option A — no. The confirmation and the reuse audit record apply only when the
  name was last held by a different asset; the ordinary permalink-change audit still applies (FR-037).
- Q (analysis): What must a restore of the previous version carry to be safe against a concurrent
  replace? → A (product owner, 2026-10-18, from the analysis finding): Both the current and the
  previous version the admin was shown (`expectedContentVersion`, `expectedPreviousContentVersion`); either stale → `409
  ASSET_REPLACE_CONFLICT` (FR-023).

## Constraints from the constitution and the conventions

- **I. Modular architecture** — replace, versions and permalinks belong to `assets_library`. Other
  modules keep referencing assets by id through `AssetReadPort` and the reference registry; no module
  reads another's tables to follow a replace.
- **II. API-first** — the replace, permalink and version shapes and the permalink-serving route are
  defined as Zod schemas in `packages/contracts/` first. `AssetRecord.storageUrl` keeps its type; its
  meaning ("a URL that serves the asset") is preserved by FR-007.
- **III. TDD** — every FR and acceptance scenario above traces to a test, including the cloud-backend
  extension case (FR-005) and the private-asset permalink case (FR-018).
- **IV. Minimal dependencies** — no new runtime dependency is expected; any CDN-purge client would
  need written justification and is currently out of scope.
- **VIII. English only** — code, specs and docs in English; Polish only in translation bundles.
- **IX. UI reuse** — the replace and permalink controls use admin-kit primitives (the existing uploader
  and dialog components), not new ones.
- **XI. Multi-tenant isolation** — assets are `@GlobalEntity` (platform-global) and this feature keeps
  them so: permalinks carry no organization and expose nothing tenant-scoped. A private asset is
  served only with a valid platform signature, through every new URL as through the existing ones.
- **XII. Sales-channel content scoping** — not applicable: assets and permalinks are channel-independent
  (A-1), and the permalink is served by the API next to the file route, not by a channel's
  storefront (Q2), so no channel resolution is involved.
- **XIII. Uniform write auditing** — the new mutations (replace, restore, set/remove permalink) are
  admin writes and must be audited uniformly. The module currently audits through
  `recordAuditFromContext` rather than `CommandBus.run`; the plan decides whether the new writes go
  through the Command Bus and records the reason if not. Converting the existing writes is out of scope.
  The purge sweep (FR-031) is not an operator write: the auditable decision is the soft delete, as
  the job's existing `command-coverage-ignore` note records. A confirmed reuse of a released permalink is an
  admin write and is audited as such (FR-037).
- **XVI. Command palette** — no new admin page; the module gains its first palette entry, "Media
  library", gated by `assets.read` (FR-028, round 3 Q2).
- **Release intent** (`specs/conventions/release-intent.md`) — the changeset states the first-sweep
  consequence of FR-034 and, as behaviour changes against the previous release, the read-at-sweep due
  rule (FR-030), the one-day retention floor (FR-035), the `404` answer of a private asset's permalink
  (FR-018), the `403` answer by id for a soft-deleted private asset without a valid signature
  (FR-013) and the disposition of cloud objects (FR-036).
- **XVII. Operator-toggleable modules** — `assets_library` is `nonDeactivatable`
  (`manifest.ts:164-168`); there is no off state, so no off-state scenarios are required. The
  storefront takes no part in serving permalinks (Q2).
- **i18n** (`specs/conventions/module-i18n.md`) — every new error code is declared in the module
  manifest's `errorCodes` and translated in `packages/modules/assets_library/i18n/{en,pl}.json`.
- **Documentation** (`specs/conventions/module-documentation.md`) — the page is
  `packages/modules/assets_library/docs/assets-library/index.md` (FR-027).
- **Commercial data** (`specs/conventions/commercial-data.md`) — examples use neutral names
  (`certificate.pdf`); no customer, domain or ticket identifiers.
