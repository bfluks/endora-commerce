# Research: Stable asset URLs (`specs/156-asset-stable-url/`)

**Input**: [spec.md](./spec.md) (clarified 2026-10-16; owner rulings P1–P5 of 2026-10-18), issue #293.
**Measured on**: `origin/master` at `194698a9e`. Every path below is relative to the repository root;
every line reference was re-measured on that commit.

Each entry is **decision → rationale → alternatives rejected**. Entries that change what the
clarified spec says are marked **[spec amendment]** and are listed again in plan.md
§ *Spec amendments for analyze*.

**What master already ships that this feature builds on** (and does not redo):

- `assets.soft_delete_retention_days` is read by both delete paths: `createSettingsView`'s
  `softDeleteRetentionDays()` (`packages/modules/assets_library/src/backend/services/storage/settings-view.ts:43-46`),
  injected as `loadRetentionDays` into `AssetsLibraryService` and `FoldersService` by
  `plugin.ts:83-104`, used at `assets-library.service.ts:241` and `folders.service.ts:206-208`. It
  fixes the deadline at deletion; the purge worker is still not scheduled. R-13 re-scopes.
- The file route serves under a strict content policy (`services/content-policy.ts`,
  `servingPolicyFor`): `X-Content-Type-Options: nosniff` and a `Content-Security-Policy` on every
  `200`/`304` (`routes.public.ts:59-61`), `inline` only for displayable media
  (`routes.public.ts:144`), HTML/XHTML/XML/JavaScript refused at upload and SVG stored as
  `image/svg+xml` (`upload-pipeline.ts:98-124`). The private-signature check runs before the
  storage-backend branch (`routes.public.ts:63-79`); a valid signature on a private cloud asset is
  a `302` to the time-limited storage URL (`routes.public.test.ts:215-224`). R-4, R-9, R-10 and
  R-11 extend this; none of it is weakened.

---

## R-1 Replace keeps the asset's storage key; bytes are swapped by copy under a row lock

**Decision.** An asset's `storage_locator` is fixed at upload and never changes again. It is the
**stable key**: the object (local file, S3 key, GCS object) that always holds the asset's
*current* bytes. A replace:

1. Resolves the adapter of the asset's **own** backend
   (`AdapterRegistry.getForBackend(asset.storageBackend)`), never the active one; an unconfigured
   backend answers `503 ASSET_STORAGE_UNAVAILABLE` as an upload does.
2. Records a cleanup entry for a **staging key** and for the **new previous key** (R-21), then
   streams the new file through `stage()` (R-4) to the staging key. Both keys are siblings of the
   stable key carrying an unguessable component: `<dir>/<assetId>.stage-<32 hex>.<ext>` and
   `<dir>/<assetId>.prev-<32 hex>.<ext>`, the hex from `crypto.randomBytes(16)`, never derived
   from `content_version` and never placed in any URL (R-21 *Key naming*). A failure here changes
   no row; the staging object is deleted and its entry cleared.
3. Runs one Command (`asset.replace`, R-6) whose transaction:
   1. reads the row `FOR UPDATE` (pessimistic write lock);
   2. refuses with `409 ASSET_REPLACE_CONFLICT` when the row's `content_version` is no longer the
      one read before staging (or the one the client sent as `expectedContentVersion`);
   3. copies stable → new previous key with an explicit **private** ACL;
   4. copies staging → stable with an explicit ACL from the **locked** row's visibility (R-18), the
      new `Content-Type`, a `Content-Disposition` chosen by the serving policy (R-10) and
      `Cache-Control: no-cache` on cloud;
   5. updates the row: filename, MIME type (`mime_type_overridden = false`), kind (R-5), size, a
      new `content_version`, and the `previous_*` columns (R-2) — `previous_storage_locator` is the
      new previous key;
   6. deletes the new previous key's cleanup entry in the same transaction (the row now references
      it).
4. After commit, deletes the staging object and the **superseded** previous object, each through
   the cleanup ledger: the entry is cleared only once the delete succeeds, so a failed delete is
   retried by the sweep (R-21).

If anything in step 3 fails after the copy onto the stable key, the transaction rolls back and a
compensating copy new-previous → stable restores the old bytes, **with an explicit ACL from the
locked row's visibility** and the old metadata, before the error is re-thrown; the new previous
object is then deleted and its entry cleared. A failing compensation is logged at `error` with
both locators, and the cleanup entries stay for the sweep.

**Rationale.**
- **FR-005 on cloud is only satisfiable this way.** The cloud URL already handed out is
  `<bucket base>/<locator>` (`services/storage/s3-adapter.ts:127`, `gcs-adapter.ts:110`). A bucket
  answers that URL from that key and no other, so the key must hold the current bytes for ever —
  including after a replace that changes the extension (`locator.ts:14-16` puts the *original*
  extension into the key). The served type comes from object metadata on cloud and from the row on
  local (`routes.public.ts:117`), so a `.jpg` key holding PNG bytes serves `image/png`.
- **FR-009 (concurrent replaces) needs the bytes to land under the lock.** Two requests that each
  `put` straight onto the stable key would let the loser's metadata commit over the winner's bytes.
  Staging outside the lock and copying under it means a stream of any length never holds a row
  lock, and only the short server-side copies do.
- **FR-004 (atomic for a reader).** Every copy onto the stable key is atomic at the destination:
  S3 `CopyObject` and GCS `copy` replace an object atomically, and the local adapter copies to a
  temporary file and `rename`s it over the key (`local-fs-adapter.ts:107-126` already uses the same
  temp-then-rename for `put`). Between the copy and the commit a reader may see new bytes with the
  old row's headers for the duration of one transaction — accepted and stated in the module
  documentation.
- **An explicit ACL on every copy, compensation included.** S3 `CopyObject` and GCS `copy` do not
  carry the source object's ACL over by default; a copy that named none would leave the stable key
  at the bucket default. Naming it on every write onto the stable key — the forward copy and the
  compensating one — keeps the stable key's ACL equal to the row's visibility whatever path wrote
  it last (SC-004).
- **The asset's own backend, not the active one.** The spec's *Switching the active storage
  backend* edge case: moving a local asset to S3 on replace would change its bare URL from
  `<api>/assets/file/<id>` to a bucket URL, breaking FR-005. tasks.md T026a pins it with the
  active adapter switched away from the asset's backend.
- **The S3 single-request ceiling.** S3 `PutObject` and `CopyObject` each accept at most 5 GiB in
  one request. The adapter's `put` is a single `PutObject`, so no S3 object it wrote exceeds 5 GiB and
  every copy this feature makes — previous key, stable key, compensation — stays within one
  `CopyObject`. The one way past it is a replacement larger than 5 GiB, which the operator's
  `assets.max_file_size_mb` can allow (the multipart parser's own fallback ceiling is exactly 5 GiB,
  `plugin.ts:122`). An upload of such a file on S3 already fails at `PutObject` with `503`;
  `stage()` refuses it on an S3 asset before it is streamed, with the existing `413
  ASSET_UPLOAD_TOO_LARGE` and `details: { maxFileSizeMb: 5120 }`, so the admin reads the limit
  instead of a storage failure. Below 5 GiB the replace accepts exactly what an upload accepts
  (FR-003); above it neither stores the file, and only the answer differs. GCS `copy` is a rewrite
  that the SDK continues internally for any size.

**Alternatives rejected.**
- *New locator per version, row points at the current one* — correct on local, where the route
  resolves by id, and wrong on cloud, where the already-distributed URL names the old key.
- *Overwrite the stable key directly from the upload stream* — the stream runs while either no
  lock is held (FR-009 violated) or a row lock is held for the whole upload.
- *A Postgres session-level lock held across the upload stream* — same lock-duration problem, plus
  a second locking mechanism in a module that has none.
- *S3 multipart copy (`UploadPartCopy`) for objects above 5 GiB* — code for objects the adapter's
  own `PutObject` cannot create today.

---

## R-2 One previous version, stored as columns on `assets`

**Decision.** The kept previous version is nine nullable columns on `assets`
(`previous_storage_locator`, `previous_filename`, `previous_mime_type`,
`previous_mime_type_overridden`, `previous_kind`, `previous_size_bytes`,
`previous_content_version`, `previous_replaced_at`, `previous_replaced_by`), all null when there is
none. `previous_storage_locator` holds the random previous key of R-1; on cloud that object is
private.

**Rationale.** Exactly one previous version is kept (spec round 1 Q5, FR-022); a second replace
discards the older one. A table with a unique index on `asset_id` would model "at most one row"
with a join, a new entity and a hard-delete cascade, to hold what nine columns hold. The columns
are null together, which the entity enforces in one helper and a check constraint states in SQL
(data-model §1).

**Alternatives rejected.** *`asset_versions` table holding every version* — full history is out of
scope (spec *Out of scope*). *Previous version as a second `assets` row* — it would show up in every
list, picker and reference query.

---

## R-3 Restore is a swap through the same Command shape, guarded on both versions

**Decision.** `POST …/previous-version/restore` takes **both** `expectedContentVersion` and
`expectedPreviousContentVersion` (each required) and runs `asset.restore_previous_version`: record
a cleanup entry for a new random previous key, lock, refuse `409 ASSET_REPLACE_CONFLICT` when either
version differs from the locked row, copy stable → new previous key (private), copy previous →
stable (explicit ACL from the locked row's visibility, the previous MIME, its disposition), swap
the row's current and `previous_*` metadata, set `previous_replaced_at = now()` and
`previous_replaced_by = actor` (a new retention period for the file it demotes — spec R2-5), clear
the new key's entry, commit, then delete the old previous object through the ledger. With no
previous version it answers `409 ASSET_NO_PREVIOUS_VERSION`.

**Rationale.** FR-023 says a restore "behaves as a replace" and swaps. Requiring the previous
version's token as well as the current one means an admin restores exactly the file the drawer
showed them: if a replace or a sweep changed the previous version between the read and the click,
the restore is refused rather than applied to a different file. The restored version keeps its own
`content_version` (R-7), so its ETag and any immutable cached copy of it are valid again.

**Alternatives rejected.** *Swap the two locators without copying* — the stable key must hold the
current bytes (R-1). *Only `expectedContentVersion`* — does not pin which previous file is brought
back.

---

## R-4 Policy, sniffing and size are shared with upload by extracting a staging step

**Decision.** `UploadPipeline.run` (`upload-pipeline.ts:129-260`) is split: a
`stage({ adapter, locator, filename, declaredMime, stream, declaredSize, sizeCapBytes? })` step
performs the size pre-flight, the declared-type check, the sniff, **`storedMimeFor`** (master's
rule: HTML, XHTML, XML and JavaScript refused by declared type and by extension; SVG stored as
`image/svg+xml`, `upload-pipeline.ts:115-124`), the sniffed-type re-check, and the counting `put`
with the cloud metadata of R-10; it returns `{ storedMime, detectedMime, sizeBytes }`, where
`detectedMime` is what `file-type` recognised from the bytes (`undefined` when nothing was
recognised). `run` keeps the id allocation, the row insert and the compensating delete. Replace
calls `stage` with the staging key. `mimeToKind` (`upload-pipeline.ts:69-74`) is exported from the
same file.

**Rationale.** FR-003 requires the same policy and the same error codes; one function makes that
true by construction instead of by a second copy, and it carries master's content policy into the
replace path unchanged. `detectedMime` is what R-5's kind guard needs.

**Alternatives rejected.** *Call `UploadPipeline.run` and then re-point the old row at the new row's
file* — creates and deletes a throw-away `Asset` row, audits an upload that did not happen, and
briefly shows the file in the Library list.

---

## R-5 The kind rule is an integrity guard

**Decision.** A replace keeps every reference valid by keeping the asset's kind. The comparison:

- **Current kind** — the stored `kind` column, with `certificate` compared as `pdf`. The column is
  set from the stored MIME at upload and is never touched by an admin's MIME override
  (`assets-library.service.ts:175-178` changes `mimeType` only), so the override plays no part.
- **New kind** — `mimeToKind(detectedMime)` when the bytes were recognised; when they were not,
  `image` for an SVG (stored as `image/svg+xml` by R-4) and `other` for anything else. An `image`,
  `video` or `pdf` asset can therefore only be replaced by bytes that positively look like one (an
  SVG excepted for `image`, which no magic-byte detector recognises); a declared type alone never
  makes a file an image or a PDF.
- A difference is refused with `415 ASSET_REPLACE_KIND_MISMATCH`, details `{ currentKind, newKind }`
  — `newKind: 'other'` when a file declared as an image or a PDF was not recognised as one.
- The new stored `kind` is the new kind, **except** that a stored `certificate` stays
  `certificate`. The new stored MIME is R-4's `storedMime`.

This guard applies to replace only; the upload rules master ships are unchanged. Restore performs
no kind check: the previous version was accepted by this guard when it was current.

**Rationale.** Every reference kind constraint in the tree is a stored-kind constraint
(`packages/modules/catalog/src/backend/services/attachment.service.ts:33,237` accepts `pdf`,
`certificate`, `other`; the gallery accepts images). A guard keyed on the stored kind and on what
the bytes are — rather than on a type the client declared or the admin typed — is what makes "no
reference is invalidated" true of the bytes the references end up serving. Preserving
`certificate` closes the one case where re-deriving the kind would change what a reference accepts.
The FR-006 reference safeguard is therefore satisfied by construction and has no runtime check; a
test proves a `certificate` attachment survives a replace (tasks.md T026).

**Alternatives rejected.** *Compare `mimeToKind(asset.mimeType)`* — an admin's MIME override would
then decide which bytes an image reference may end up serving. *Re-sniff the current object's bytes
before staging* — one more storage read per replace, and it answers `other` for every unrecognised
upload, which the stored kind already records. *Add kind constraints to `AssetReferenceRegistry`
descriptors* — four contributing modules would change for an empty set of refusals.
**[spec amendment]**: FR-006 — the current kind is the stored kind (an override is ignored) and the
new kind is derived from the file's recognised content, an SVG counting as an image.

---

## R-6 Auditing: the four new writes run through `CommandBus.run`

**Decision.** `asset.replace`, `asset.restore_previous_version`, `asset.permalink_set` and
`asset.permalink_remove` are Commands run through the cradle's `commandBus`, the way
`packages/modules/catalog/src/backend/services/gallery.service.ts:76-89` runs its writes. The audit
before/after carries filename, MIME type, size and `content_version` (FR-010) or the old and new
permalink; `asset.permalink_set`'s `after` also carries `reusedPermalink: { previousAssetId,
releasedAt, reason }` when the admin confirmed taking a previously used permalink (R-22). The
existing writes keep `recordAuditFromContext` (`assets-library.service.ts:59-75`).

**Rationale.** Constitution XIII (non-negotiable): new sensitive writes MUST be expressed as
Commands, and `assets_library` is already in `MIGRATED_MODULES`
(`backend/scripts/check-command-coverage.ts`), so `--strict` applies to it. The bus gives
co-transactional audit and the transaction R-1 needs for its lock. Converting the existing writes
is out of scope (spec *Out of scope*).

**Alternatives rejected.** *`recordAuditFromContext` like the rest of the module* — consistent
inside the file and a direct violation of XIII for new code.

---

## R-7 The version marker: an opaque per-version token, carried as `?v=`

**Decision.** A new column `content_version` (12 lowercase hex characters from `randomBytes(6)`)
identifies the bytes the asset holds. It is minted at upload and at every replace; a restore brings
back the restored version's own token. Embedded URLs carry it as a **query parameter** `v`:
`<base>/assets/file/<assetId>?v=<contentVersion>`. The local ETag becomes
`"<assetId>-<contentVersion>"` (today `"<id>-<updatedAt seconds>"`, `routes.public.ts:102`). The
migration backfills existing rows with `substr(md5(random()::text || id::text), 1, 12)`. The token
is public by design; no storage key is derived from it (R-1).

**Rationale.**
- *Query parameter, not a path segment*: `crm`'s `asDownloadLink`
  (`packages/modules/crm/src/backend/services/attachment-active-content.ts:77-89`) tests the **path**
  suffix `/assets/file/<assetId>` (`:85`) and appends `&download=1` when a query exists (`:87`) — so
  `?v=` keeps it working unchanged (spec *Edge Cases*).
- *A dedicated column, not `updatedAt`*: `updatedAt` moves on a label or folder edit
  (`asset.entity.ts:88-89`), which would change every embedded URL and defeat the long cache.
- *Identity of bytes, not a counter*: after replace-then-restore the marker returns to the first
  token, so an immutable copy cached under it is valid again and a `304` against the old ETag is
  correct.

**Alternatives rejected.** *Integer `version` incremented per write* — restore would mint a new
number for old bytes. *Content hash* — needs the whole file read on every replace and on backfill.
*Path segment `/assets/file/<id>/<v>`* — breaks the `crm` suffix check.

---

## R-8 Which URL each consumer gets, and where the marker is added

**Decision.** The marker is appended **in the service layer, never in the storage adapters**, by one
pure function `versionedAssetUrl(url, contentVersion, backend)` that leaves `legacy` rows, `data:`
URLs and signed (private) URLs untouched. Three URL forms exist:

| Form | Value | Who gets it |
| --- | --- | --- |
| **Embed** | public: stable URL + `?v=<contentVersion>`; private: the signed URL, unchanged | `AssetSummary.url` / `AssetDetail.url` (so `cms`, `megamenu`, `pwa`, `blog`, `crm`, `invoices` — every `getAsset(...).url` reader — and the admin's own previews); `AssetRecord.storageUrl` (so every `catalog` read: `catalog-query.service.ts:1398,1429,1436,1478,1496`, `gallery.service.ts:178`, `primary-asset-url.ts:122`); `AssetReadPort.resolvePublicUrls` (product feeds, FR-012 / spec R2-4); the transactional e-mail logo (`backend/src/composition.ts:1062-1064` and `backend/test/helpers/test-server.ts:2241-2243` switch to the new `resolveEmbedUrl`) |
| **Stable file URL** | `<base>/assets/file/<id>` on local, `<bucket base>/<stable key>` on cloud — what `resolveUrl` answers today | `GET /api/v1/admin/assets/:id/url` (unchanged; `public-asset-file.contract.test.ts:171` stays green), the new `AssetSummary.fileUrl`, the cloud redirect target |
| **Permalink URL** | `<local public base>/assets/file/<permalink>` | the new `AssetSummary.permalinkUrl` |

`AssetRecord.storageUrl` is **derived at read time** in `toAssetRecord` (`asset-read-port.ts:185-206`)
as `versionedAssetUrl(asset.storageUrl, asset.contentVersion, asset.storageBackend)`; the
`storage_url` column is never rewritten. `data:` values stay untouched because `orders` reads that
prefix (`packages/modules/orders/src/backend/routes.ts:476`). The admin's shareable URL (FR-021) is
`permalinkUrl ?? fileUrl`.

**Completeness of the embed population.** `git grep -n '\.resolveUrl(' -- packages/modules backend/src`
outside `assets_library` finds one caller, `backend/src/composition.ts:1064` (its harness twin is
`backend/test/helpers/test-server.ts:2243`) — the e-mail logo. `AssetsLibraryPort` publishes no
`resolveUrl`; every other module reads `getAsset().url`, `AssetRecord.storageUrl` or
`resolvePublicUrls`. So the three members above plus the one closure are the whole population.

**Rationale.**
- FR-007: the value `catalog` reads now carries the current marker and changes with every replace
  and restore, with **no change in `catalog`**.
- FR-012's embed sites are all reached: storefront (via `catalog`'s DTOs; `storefront/lib/asset-url.ts:24`
  passes absolute URLs through, so no storefront code changes), CMS and page-builder renders (via
  `cms`'s `asset-embed-resolver.ts:25`, which reads `getAsset().url`), transactional e-mails, feeds.
- The page-builder and `cms-components` fallbacks that build a bare `/assets/file/<id>` when an asset
  is missing from the resolved map (`packages/page-builder-core/src/types/background.ts:72,90`,
  `packages/cms-components/src/utils/resolve-image-url.ts:37`) stay bare: the bare URL is `no-cache`
  (R-9), so they serve the current file, only without the long cache.
- FR-021: the versioned form is never the shareable one; `fileUrl` and `permalinkUrl` are separate
  members.

**Alternatives rejected.** *Rewrite `storage_url` on every replace* — two sources of truth. *Add the
marker inside each adapter's `resolveUrl`* — four adapters, and the admin's "stable URL" route
would stop being stable. *Change `resolveUrl` to return the embed form* — breaks the admin URL
route's contract and the cloud redirect target.

---

## R-9 Caching, the stale-marker redirect, and the headers every response carries

**Decision.** The file route answers through one pure function, `decideFileResponse`
(contracts/file-serving.md §2), tested without HTTP. For a **public, local** asset:

| Request | Status | `Cache-Control` | Notes |
| --- | --- | --- | --- |
| no `v` (bare id or permalink) | 200, or 304 on matching `If-None-Match` | `public, no-cache` | ETag `"<id>-<contentVersion>"` (FR-011, FR-017) |
| `v` = current | 200 / 304 | `public, max-age=31536000, immutable` | FR-012 |
| `v` ≠ current | 302 → canonical path with `v=<current>` | `no-store` | FR-012a; never serves the previous file (FR-024) |

**The redirect's `Location` is built from the resolved row, never from the request.** It is
path-absolute: `/assets/file/<row.id>` when the request named the id, `/assets/file/<row.permalink>`
(the stored value, each segment percent-encoded) when it named a permalink, then `?v=<current>`,
then `&download=1` only when the request carried exactly `download=1`. No other query parameter is
copied — in particular never `token` or `exp`.

**Headers on every response.** `X-Content-Type-Options: nosniff` on every status. A `200`/`304`
carries the stored type's `Content-Security-Policy` from `servingPolicyFor` (master's rule). Every
other status — `302`, `403`, `404`, `410` — carries the fixed `SANDBOX_CSP` and
`Cache-Control: no-store`, whatever the asset's type, so an error or a redirect never varies with
the stored type and is never cached. The route applies the decided headers before it throws the
error envelope.

**Private assets** (R-11): the signature is checked before anything else that depends on the row, so
an unsigned conditional request on a private asset — even one carrying the asset's current ETag in
`If-None-Match` — never receives a `304`; it receives what an unsigned plain request receives.

**Rationale.** Spec round 1 Q3 and R2-2/R2-3. `no-cache` (not `max-age=0`) is what the owner chose:
"always revalidate". The redirect is `no-store` so a later replace is followed too. Building the
`Location` from the row keeps the header free of request-controlled text, and keeping the signature
parameters out of it means a signed URL is never re-emitted by the route.

**Alternatives rejected.** *`max-age=60` on the bare URL* — rejected by the owner (R2-2). *Serve the
current bytes for a stale marker instead of redirecting* — the owner chose the redirect (R2-3).
*Echo the request path and query in `Location`* — the identifier a client typed is not the stored
one (case), and arbitrary parameters would be reflected. *Type-specific CSP on error statuses* (what
master sends on its `403` today) — it varies with the stored type of an asset the caller may not
read.

**Known transition limit (documented, FR-027).** A client that cached a bare URL **before this
feature deploys** holds it as `immutable` for up to a year (`routes.public.ts:131`) and will not
revalidate; nothing a server sends later reaches it. The documentation says so.

---

## R-10 Cloud backends: object metadata, no redirect at the bucket **[round 3 Q3 — confirmed 2026-10-16]**

**Decision.**
- The stable key is written with `Cache-Control: no-cache`, `Content-Type` and a
  `Content-Disposition` on upload and on every replace/restore copy. Both cloud adapters set no
  cache header and no disposition today (`s3-adapter.ts:107-116`, `gcs-adapter.ts:90-94`).
- **Disposition by the serving policy (owner ruling P4).** A bucket cannot send a
  `Content-Security-Policy`, so the object's disposition is `inline` only when
  `servingPolicyFor(mime).inline` is true **and** the type is not SVG; every other type — SVG
  included — is stored with `attachment`. One pure function, `cloudContentDisposition(mime,
  filename)`, decides it; `contentDispositionHeader(mode, filename)` builds the value (R-12a).
- The cloud **embed** URL is the bucket URL of the stable key plus `?v=<contentVersion>`. S3 and GCS
  ignore an unrecognised query parameter on an anonymous object `GET`, so it serves the stable key —
  the **current** bytes — and the marker only changes the cache key.
- A **stale** marker on cloud therefore serves the current file rather than redirecting: a bucket has
  no request handler that could redirect. The invariant FR-012a protects — never the previous file,
  and later replaces are followed — holds.
- Long-lived caching of cloud embeds, `X-Content-Type-Options: nosniff` and a restrictive CSP on
  bucket responses are the operator's CDN configuration; the documentation states each, together with
  purging the bare URL and the permalink at the CDN after a replace when the CDN overrides origin
  freshness, and a cache key restricted to the path plus `v` and `download` (FR-027).
- `GET /assets/file/<id or permalink>` on a public cloud asset keeps today's behaviour: `302` to the
  stable bucket URL, now with `Cache-Control: no-store` on the redirect.

**Rationale.** FR-005 forces the stable key to hold the current bytes (R-1), and an object has one
header set. Serving SVG and non-displayable types as downloads from a bucket gives cloud the
protection the API route gets from its CSP header.

**Alternatives rejected.**
- *Route every cloud embed through the API*: the literal redirect at the cost of one API request per
  image per page view, or of every image's bytes passing through the API. Offered as round 3 Q3's
  second option and not chosen.
- *Immutable per-version public objects* embedded directly: a stale embed would serve the previous
  file, violating FR-012a and FR-024.
- *SVG `inline` on cloud* — a directly opened SVG would render with no policy header.

**[spec amendment, round 3 Q3 confirmed]**: FR-012a gains "On S3/GCS, where the platform does not
answer the request, a stale-marker URL serves the current file instead of redirecting."

---

## R-11 Private assets: the platform signature check is preserved and extended to the permalink

**Decision.** The route keeps master's rule — a private asset is served only with a valid platform
HMAC signature, checked before the storage-backend branch, on every backend — and extends it to the
permalink form, with the identifier-dependent answer of owner ruling **P2**:

| Private asset, request… | Answer |
| --- | --- |
| by id, signature missing or invalid | `403 ASSET_ACCESS_DENIED` (master, unchanged) |
| by permalink, signature missing or invalid | `404 ASSET_NOT_FOUND` — the status, envelope, message and headers of an identifier that resolves to nothing |
| valid signature, local | `200` (or `304`) with `private, no-store, max-age=0`; `v` ignored |
| valid signature, S3/GCS | `302` to the time-limited storage URL from `resolveUrl`, `Cache-Control: no-store` (`routes.public.test.ts:215-224` stays green) |

The signature check runs **before** the soft-deleted check, so a soft-deleted private asset answers
`403` (by id) or `404` (by permalink) without a valid signature and `410` only with one. The
signature signs `{ assetId, exp }` (`services/hmac.ts`), so the query of a signed file URL is valid
on the asset's permalink as well.

**Rationale.** FR-018, SC-004. A permalink is chosen to be readable (`contract.pdf`), so answering a
readable name exactly as an unused name keeps the route from confirming which readable names belong
to private assets; the id form keeps master's `403`, which its existing tests pin. Checking the
signature before the deleted state means the deleted state of a private asset is visible only to a
holder of a valid signature.

**Alternatives rejected.** *`403` on the permalink too* — confirms that a readable name exists. *`404`
on the id form too* — changes master's answer and its tests for no gain: an id is not guessable.
*Deleted check first (master's order)* — answers `410` to a caller with no signature.
**[spec amendment, P2]**: FR-013/FR-018 — by permalink, a private asset without a valid signature
answers `404` identical to a missing one; the signature check precedes the `410`.

---

## R-12 Permalink model, validation and route resolution

**Decision.**
- Column `permalink varchar(200) null`; unique index on `lower(permalink)` (FR-015: platform-wide,
  case-insensitive); stored as the admin typed it.
- Validation is one pure function in `packages/contracts/src/assets-library.ts`,
  `validateAssetPermalink(value)`, used by the service and the admin form: 1–200 characters; segments
  of `[A-Za-z0-9._-]+` separated by single `/`; no empty, `.` or `..` segment; no leading or trailing
  `/`; **not UUID-shaped**. It answers `{ ok: true } | { ok: false, reason }` with
  `reason ∈ { empty, too_long, invalid_characters, invalid_segment, uuid_shaped }`, raised as
  `400 ASSET_PERMALINK_INVALID` with `details: { code: reason }` — the envelope's `refusalToken`
  reads `details.code`, so each reason has its own translated sentence (FR-016).
- Assigning a taken permalink: `409 ASSET_PERMALINK_TAKEN`, details `{ permalink, assetId }`. The
  unique index is the authority; the service checks first and maps the index violation to the same
  code for the race.
- Assigning a **previously used** permalink: R-22.
- Routes: Fastify's `:assetId` matches one segment only, so the file route becomes **two**
  registrations sharing one handler — `/assets/file/:assetId` and `/assets/file/*`. The handler
  resolves the identifier: UUID-shaped → by id; otherwise → by `lower(permalink)`; neither →
  `404 ASSET_NOT_FOUND`. This also turns today's answer for a non-UUID segment — a Postgres cast
  error on `findOne({ id })` (`routes.public.ts:51`) — into a clean `404`.
- No "reserved path" exists below `/assets/file/` other than the UUID shape; the deployment
  templates proxy the whole prefix to the API (`packages/cli/src/new-instance/deploy.ts:1363`).
- A changed or removed permalink answers `404` at once and is immediately free (FR-019, owner ruling
  P5); a soft-deleted asset keeps its permalink reserved and answers `410` on it (FR-020, subject to
  R-11); hard delete removes the row and releases the permalink.

**Rationale.** Spec round 1 Q2 and R2-1, FR-014 – FR-020. One validator in `contracts` is the API-first
answer (Principle II) and stops the admin and the server disagreeing.

**Alternatives rejected.** *A separate `asset_permalinks` table* — one permalink per asset (A-2).
*Store lower-cased* — the admin's casing is what they will print. *A third route `/assets/p/<permalink>`*
— the owner fixed the path (R2-1).

### R-12a `Content-Disposition` values

**Decision.** One builder, `contentDispositionHeader(mode, filename)` in `services/asset-urls.ts`,
produces every disposition the module writes — the route's response header and the cloud object
metadata: `<mode>; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`. The ASCII
fallback replaces `"`, `;`, `\`, `%`, CR, LF, every other control character and every non-ASCII
character with `_`; the `filename*` value percent-encodes per RFC 5987 (`encodeURIComponent` plus
`'`, `(`, `)`, `*`). **Storage key extensions** are separately restricted: a sibling key's extension
is the new filename's extension lower-cased when it matches `[a-z0-9]{1,10}`, `bin` otherwise.

**Rationale.** A filename is admin- or uploader-supplied text that ends up in a header and in an
object key. One builder is one place to test it; S3 refuses raw non-ASCII header values. The stable
key's extension is master's (`computeLocator`, original casing — `locator.test.ts` pins it) and is
not touched.

---

## R-13 Retention and the purge sweep — what remains after master **[round 3 Q1; owner rulings P1, P3]**

**What master ships** (`1a89920b4`): both delete paths read the setting through
`softDeleteRetentionDays()` and stamp `purge_after_at = deletedAt + retention` at deletion; the
answer of a repeated `DELETE` keeps the stamped date; `0` is accepted and negative or non-finite
values fall back to 30. `HardDeleteAssetWorker` (`jobs/hard-delete-asset.job.ts`) is still
constructed only by `backend/test/integration/assets_library/hard-delete-worker.test.ts`; nothing
schedules it, and its header comment ("repeatable scheduling lives in composition.ts", `:11-12`) is
not true.

**Decision (what this feature adds).**
- **Read at sweep time (P1).** An asset soft-deleted at D is due when D plus the retention period
  **read when the sweep runs** has elapsed — the rule FR-022 applies to previous versions. The
  soft-delete pass selects on `deleted_at`, not on the stored `purge_after_at`, with a partial index
  on `deleted_at` (data-model §1). Every purge date the platform reports is derived by the same rule
  at read time: the `DELETE /:id` response's `purgeAfterAt` — including the idempotent answer for an
  already-deleted asset (`assets-library.service.ts:224-227`) — and `AssetRecord.purgeAfterAt`
  (`asset-read-port.ts:200`). `purge_after_at` is still written by both delete paths at deletion but
  read by nothing in this release: it keeps a rollback to the previous release purging on a sane
  date. Restore clears `deleted_at` and `purge_after_at`, so a restored asset leaves the sweep, and a
  later delete starts a new period (FR-033).
- **Minimum effective retention of one day (P3).** `softDeleteRetentionDays()` answers
  `max(1, value)` for a finite non-negative value (30 for missing, negative or non-finite, as today;
  no rounding — `7.5` stays `7.5`). The clamp lives in the one reader, so the sweep, every reported
  date, `restorableUntil` and the stamped `purge_after_at` agree.
- **The sweep.** A BullMQ Job Scheduler copied from
  `packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` and its wiring
  (`quote_requests/src/backend/index.ts:722-748`): queue `assets_library.retention.sweep` (no `:` —
  `check:queue-names`), scheduler id equal to the queue name, every hour, `concurrency: 1`, consumer
  attached through `ctx.worker`, started only where `processRunsWorkers` and `moduleQueueRedis` say
  so. No tick enters a system scope: `Asset` and the two new tables are `@GlobalEntity()`.
- **One tick, four passes, a cap per pass (P3, FR-035).** The retention is read once at the start.
  Each pass is bounded by **500 rows per tick** (`ASSET_RETENTION_SWEEP_BATCH`), counted separately,
  in this order: previous versions due, soft-deleted assets due (**oldest deletion first**), pending
  retries, object cleanups (R-21). What a cap leaves is taken by the next tick. Every tick — idle or
  not — writes **one** structured `info` log line, `assets_library.retention.sweep`, with
  `retentionDays` (the effective value), `hardDeleted`, `pendingCleanup` (deletes that failed and
  were left marked), `previousPurged`, `cleanupsDone`, `skippedReferenced`, `skippedNotDue` and
  `dueRemaining` (due soft-deleted assets left for later ticks, one count query after the pass).
- **Every claim re-checks under the row lock (P3).** Rows are selected, then each is claimed in its
  own transaction with `for update skip locked` and re-checked under the lock: for a previous
  version, that `previous_replaced_at <= now − retention` and the locator is the one selected; for a
  soft-deleted asset, that `deleted_at` is still set and due and that
  `referenceRegistry.findReferences(id)` is empty — a referenced asset is skipped, counted and left
  soft-deleted. A row a concurrent restore holds is skipped by `skip locked`; one a restore changed is
  no longer due on re-check.
- **Clear first, then delete (previous-version pass).** Under the lock: insert a cleanup entry for
  the previous locator and null the nine columns, commit; then delete the object and clear the entry.
  A failed delete leaves the entry for the cleanup pass. No row ever points at a deleted object.
- **Soft-deleted pass (FR-031, FR-032).** Under the lock: the previous version (if any) is cleared
  first, as above; then the stable object is deleted; success removes the row and records the
  permalink release (R-22); failure sets `pending_cleanup` and leaves the row soft-deleted (FR-032,
  the spec's order — the stable object is what the row describes). The pending pass retries.
- **Failure isolation.** Each row is its own transaction; one failure never stops the others.
- A composition test beside `index.ts` (`retention-sweep-is-scheduled.test.ts`, the
  `quote_requests/src/backend/expiry-sweep-is-scheduled.test.ts` pattern) fails if the schedule stops
  being installed.

**What this supersedes in master, deliberately** (R-20): the fixed-at-deletion report
(`soft-delete-retention.test.ts:74-85`, `admin-retention.contract.test.ts:87-93`), the zero-day
answers (`soft-delete-retention.test.ts` cases *global zero-day override* and *zero days*;
`admin-retention.contract.test.ts:75,96` `0` rows), the documentation's "the value is read when an
asset is deleted; changing it does not reschedule assets already soft-deleted … a value of `0` makes
an asset eligible … on the next sweep" (`packages/modules/assets_library/docs/assets-library/index.md:99-102`
and its Polish twin), and the closing sentence of `.changeset/fix-assets-soft-delete-retention.md`
("Existing soft-deletion deadlines are preserved."). That changeset is still unreleased on master (it
landed after the last version commit) and would ship in the same release as this feature's, so tasks.md
T048 removes that one sentence and states the change under *Behaviour change* in this feature's
changeset.

**Rationale.** The owner's rulings: a changed setting applies to assets already deleted (P1); a
bounded, observable, conservative sweep (P3). The cost is one worker file, one composition test and
the per-row claim — the schedule shape already exists in `quote_requests`.

**Operator consequence (FR-034).** The first tick after deploy purges every asset soft-deleted longer
ago than the retention period, up to 500 per hour. The changeset and the documentation say so, and
that an operator who wants to keep those assets lengthens the setting before upgrading.

**Alternatives rejected.** *Period fixed at deletion* (master's behaviour) — rejected by the owner
(P1): the first-sweep consequence would follow the hard-coded 30 days stamped on historic rows.
*Re-stamp every soft-deleted row when the setting changes* — a settings subscriber and a bulk write
for a value the sweep can compute. *No cap* — an unbounded first tick on an instance with a large
backlog. *A `setInterval` in the API process* — Constitution X forbids it.

---

## R-14 "Replaced by" needs the admin's name: `adminUserReadPort`

**Decision.** `previous_replaced_by` stores the actor's admin user id (`actor.actorAdminUserId`); the
detail read resolves a display name through
`lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort').findByIds([...])` and answers
`replacedBy: { id, displayName } | null`. `admin_users` joins the manifest's `dependencies`.

**Rationale.** FR-023 shows who replaced it. `catalog` reads admin names the same way
(`packages/modules/catalog/src/backend/index.ts:622`). `admin_users` depends on nothing that depends
on `assets_library`, so the edge closes no cycle (`test/unit/db/module-graph.test.ts`).

**Alternatives rejected.** *Snapshot the name at write time* — stale after a rename. *Let the admin
UI look the user up* — needs a permission the asset screen does not require.

---

## R-15 Admin surface: drawer only; design-system reuse

**Decision.** All new controls live in `AssetDetailDrawer.tsx`; no new page (FR-028):
- **Replace file** — the kit's `AssetUploader` gains an optional `upload` prop and an `accept`
  override; a `ModalDialog` confirms, naming the current and the new filename.
- **Shareable URL** — a read-only row with a copy button (the
  `packages/modules/product_feeds/src/admin/components/FeedLinkCard.tsx:62` pattern), plus a notice
  when the asset is private.
- **Permalink** — an `Input` with Save and Remove; inline validation from `validateAssetPermalink`; a
  `ModalDialog` before a set permalink is changed or removed (FR-019); a second `ModalDialog` when the
  server answers `409 ASSET_PERMALINK_PREVIOUSLY_USED`, and **Use it anyway** re-sends with
  `confirmReuse: true` (R-22).
- **Previous version** — filename, type, size, replaced at, replaced by, restorable until; **Restore**
  with a `ModalDialog`; the request carries both `contentVersion` and `previousVersion.contentVersion`
  (R-3).
- **Soft delete** — when the asset has a permalink, a `ModalDialog` first (FR-020).
- Write controls hidden without `assets.write` (`useAuth().hasPermission`); viewing needs
  `assets.read` (FR-026). Every string a key in the module's own bundle.

**Alternatives rejected.** *A second uploader component* — duplicates the kit's. *`window.confirm`* —
`LibraryPage.tsx:136` uses it, and feature 147 removed the pattern from saved views for
accessibility.

---

## R-16 Command palette **[round 3 Q2 — confirmed 2026-10-16]**

**Finding.** The module declares no `actions`, and `src/admin/index.ts:26-31` states the absence
deliberately with an off-state test asserting the empty answer
(`admin/test/modules/batch-nine-surfaces.module-owned-surface.test.tsx`).

**Decision.** One landing action "Assets library", `actions.openLibrary` → `/assets-library`,
`requiredPermission: 'assets.read'`, icon `Image`; update the batch-nine test and rewrite that
paragraph.

---

## R-17 No domain event, no cache invalidation, no new setting

- **No event.** Nothing subscribes to asset changes and nothing caches asset URLs in Redis. A
  storefront page cached by Next.js before a replace still carries the old marker and is followed by
  R-9's redirect (local) or served the current bytes (R-10, cloud).
- **No Redis pub/sub invalidation** — no cache to invalidate.
- **No new setting** — retention reuses `assets.soft_delete_retention_days`; the sweep cap is a
  constant (P3); no secret.
- **No new runtime dependency** — `CopyObjectCommand` is in `@aws-sdk/client-s3` and `File.copy` in
  `@google-cloud/storage`, both already dependencies.
- **No signature value in this feature's logs.** Nothing the feature adds logs a `token`, an `exp` or
  any other signature value; request-line logging belongs to the platform's HTTP layer, which serves
  every signed URL in the platform, so a platform-wide redaction there is the right home for that and
  is recorded as a follow-up in plan.md § *Risks* rather than built per route here.

---

## R-18 Visibility changes take the same row lock

**Decision.** `patchAsset`'s visibility branch (`assets-library.service.ts:181-207`) is wrapped in
`em.transactional(...)` (it runs on a bare `em` today, and a pessimistic lock needs a transaction) and
reads the row `FOR UPDATE` there; replace and restore read the visibility they copy with from the
row they locked. tasks.md T028a proves the lock (a held row lock blocks the visibility write) and
T025 proves the copy uses the locked row's visibility.

**Rationale.** On cloud the ACL lives on the stable object. A visibility flip racing a replace could
otherwise leave the copied object `public-read` under a row that says `private` — SC-004.

---

## R-19 Testing cloud adapters without a bucket

**Finding.** No S3 or GCS adapter unit test exists, and `docker-compose.yml` has no MinIO service.
**Decision.** New co-located `s3-adapter.test.ts` and `gcs-adapter.test.ts` mock the SDK and assert
the object metadata and ACLs of `put` and `copy`. What only a real bucket can show is a **manual**
check in quickstart §6 and is marked so in tasks.md *Requirement → test*: SC-002's cloud half (a
bucket URL serves the new bytes after a replace), FR-005 on a real bucket, FR-012a's bucket half (a
stale `?v=` on the bucket serves the current file), and the ACL actually applied to a copied object.
Adding MinIO is out of scope (Principle IV).

---

## R-20 Existing tests, documents and changesets that change on purpose

Each is updated in the task that changes the behaviour it pins, and named there:

| Item | Today | After | Task |
| --- | --- | --- | --- |
| `packages/modules/assets_library/src/backend/services/assets-library-url.test.ts:82,88` | `detail.url` / list `url` bare | versioned; new `fileUrl` bare | T061 |
| `packages/modules/assets_library/src/backend/services/asset-read-port.test.ts:89` | `resolvePublicUrls` bare | versioned | T061 |
| `backend/test/contract/cms/storefront-asset-embed.contract.test.ts:83` | embed `url` bare | versioned | T065 |
| `backend/test/integration/transactional_emails/channel-and-branding.test.ts:105` | logo bare | versioned | T063 |
| `backend/test/integration/pwa/cross-module-wiring.test.ts:143` | rendition URL bare | versioned | T065 |
| `backend/test/integration/assets_library/hard-delete-worker.test.ts` | worker driven by hand, `purge_after_at` predicate | also clears the previous version; due by `deleted_at` + retention | T041a |
| `backend/test/contract/assets_library/public-asset-file.contract.test.ts` | `Cache-Control` contains `public` | adds `no-cache` / immutable / redirect / header cases; `:171` (absolute unsigned URL) and `:139` (private `403` by id) stay as they are | T055 |
| `packages/modules/assets_library/src/backend/routes.public.test.ts` | fake `em` resolves by id only | **extended, stays green**: the fake learns the permalink lookup; `:184-213` (private cloud `403` before any storage URL) and `:215-224` (valid signature on a private cloud asset → `302` to the time-limited URL) unchanged | T055a |
| `packages/modules/assets_library/src/backend/services/upload-pipeline.test.ts` | `run()` content policy | **extended**: the same assertions through `stage()` | T023 |
| `packages/modules/assets_library/src/backend/services/soft-delete-retention.test.ts:74-85` | a repeated delete keeps the first deadline | **superseded** (P1): the repeated answer reports `deletedAt` + the current setting | T032 |
| `soft-delete-retention.test.ts` cases *global zero-day override*, *zero days* | `0` days | **superseded** (P3): 1 day | T032 |
| `backend/test/contract/assets_library/admin-retention.contract.test.ts:87-93` | "a later setting change must not move an existing deletion deadline" | **superseded** (P1): the repeated `DELETE` reports the new period; the stored column keeps the first | T042 |
| `admin-retention.contract.test.ts:75,96` (`0` rows) | 0 days | **superseded** (P3): 1 day | T042 |
| `backend/test/contract/assets_library/admin-soft-delete.contract.test.ts` | 30 days | retention from the setting, derived at read time | T042 |
| `packages/modules/assets_library/docs/assets-library/index.md:99-107` (+ Polish twin and translation cache) | read at deletion; `0` eligible next sweep; worker "finalises after `purgeAfterAt`" | **superseded**: read at sweep, minimum one day, scheduled hourly sweep | T078, T079 |
| `.changeset/fix-assets-soft-delete-retention.md` ("Existing soft-deletion deadlines are preserved.") | unreleased, ships in the same version | **superseded**: the sentence is removed and this feature's changeset *Behaviour change* paragraph states the new rule (if a release consumed it before the final rebase, only the paragraph remains) | T048 |
| `admin/test/modules/batch-nine-surfaces.module-owned-surface.test.tsx` | empty palette | one action | T075 |

`backend/test/integration/product_feeds/image-urls-are-absolute.test.ts:215` uses `toContain` on the
bare prefix and stays green; it gains an assertion on `?v=` (T065).

---

## R-21 Orphaned objects: a cleanup ledger

**Decision.** A small platform-global table, `asset_object_cleanups` (data-model §1b), records every
storage object the module is about to create or stop referencing outside a row's own columns:

| Entry written | When | Cleared |
| --- | --- | --- |
| `staging` | before `stage()` writes the staging key | after the staging object is deleted |
| `previous` | before the Command copies onto a new previous key | inside the Command's transaction, once the row references the key; on rollback, after compensation deletes it |
| `superseded` | inside the Command's transaction, for the previous key the replace or restore stops referencing | after commit, once the object is deleted |
| `purge` | inside the previous-version purge, with the columns nulled | once the object is deleted |

The sweep's fourth pass takes entries older than **24 hours** (so an in-flight staging upload is never
touched), skips any whose locator is still referenced by an asset row (`storage_locator` or
`previous_storage_locator` on the same backend), deletes the object — a missing object counts as
deleted — and removes the entry; a failure increments `attempts` and records `last_error`. A crash at
any point therefore leaves either a referenced object or an entry for it.

**Key naming.** Staging and previous keys carry 128 random bits (`randomBytes(16)`), so a key cannot be
derived from anything public — the asset id and `content_version` are both in URLs. The documentation
states that a bucket policy must not grant public read beyond the objects the module itself makes
public: the module's object ACLs are the authority, and a prefix-wide public-read policy would expose
previous and staging objects regardless of their names.

**Rationale.** A best-effort delete that only logs (the plan's first draft) leaves a private copy of a
replaced file in the bucket for ever when it fails, with nothing to find it again. Recording the intent
before the object exists closes the crash window as well as the error window.

**Alternatives rejected.** *Orphan scan* — needs a `list(prefix)` method on three adapters and a scan
per asset. *Log only* — nothing retries. *A column on `assets`* — an asset can have several orphaned
objects, and a hard-deleted asset has no row to hold one.

---

## R-22 Previously used permalinks **[owner ruling P5]**

**Decision.** A freed permalink is immediately reusable (FR-019), but taking one that **another asset
held before** needs the admin's confirmation and leaves an audit entry:

- Table `asset_permalink_releases` (data-model §1a), keyed by `lower(permalink)`, upserted whenever a
  permalink stops being held: changed, removed, or released by a purge. The row records the asset that
  held it, when, and why.
- `PUT …/permalink` with a value whose `lower()` has a release row **for a different asset** and
  without `confirmReuse: true` answers `409 ASSET_PERMALINK_PREVIOUSLY_USED`, details
  `{ permalink, releasedAt }`. With `confirmReuse: true` it proceeds; the release row is deleted in the
  Command's transaction and the `asset.permalink_set` audit `after` carries
  `reusedPermalink: { previousAssetId, releasedAt, reason }`. The row is keyed by the name, so it always
  names the **last** holder: an asset taking back a permalink it released itself, with no other asset
  holding it since, needs no confirmation and its audit `after` carries no `reusedPermalink` (the row
  is still deleted); if another asset took and released it in between, the original holder needs the
  confirmation like anyone else.
- The admin drawer turns the `409` into a confirmation dialog stating that links printed or shared with
  that address will open this asset (R-15).

**Where "previously used" is recorded, and why a table.** It must survive the hard delete of the asset
that held the name — a printed QR code outlives the purge — and be answered by an indexed lookup at
`PUT` time.

**Alternatives rejected.** *Audit lookup* — `AuditPort.query` is capped at 500 entries and filters by
action and object, not by a value inside `before`/`after`
(`packages/platform/src/kernel/ports/audit.ts:43-90`); audit retention may also prune it. *A history
column on `assets`* — dies with the row on hard delete, and a lookup across all assets needs an
array index. *Block reuse outright* — contradicts FR-019's "immediately free".
**[spec amendment, P5]**: FR-037 carries the confirmation and the audit entry for a permalink whose last
holder was a different asset, and the same-asset exemption (US2-9, US2-10); FR-019 keeps "immediately
free".
