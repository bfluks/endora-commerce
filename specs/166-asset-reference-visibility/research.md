# Research: Asset visibility follows the records that reference it

**Feature**: `specs/166-asset-reference-visibility/` · **Date**: 2026-10-29 · **Base**: `origin/master`
at `4d2c03490` (feature 165 merged in #533). **Input**: GitHub issue #513, owner ruling option A,
owner rulings Q1 = A (fail closed while the owner is switched off) and Q2 = A (the platform
wildcard `*` is the only override).

The facts (F-n) were measured in the tree. The decisions (R-n) follow from them. Each decision
names the alternatives it rejected. Paths are relative to the repository root. `AL/` stands for
`packages/modules/assets_library/src/backend/`, `T/` for `packages/modules/tasks/src/backend/`,
`P/` for `packages/modules/projects/src/backend/` and `C/` for `packages/modules/crm/src/backend/`.

---

## Facts

### The library today

**F-1 — Every admin route reads by id with no reader rule.** `AL/routes.admin.ts` registers 20
admin routes. The ones that take an asset id are: replace (136), previous-version restore (211),
permalink set (228) and remove (241), detail (272), URL (282), delete (297), restore (312),
move (322) and patch (436). Each passes the id straight to the service, whose first statement is
`em.findOne(Asset, { id })` followed by `404 ASSET_NOT_FOUND`, message `Asset ${id} not found.`
(`AL/services/assets-library.service.ts` 313, 324, 338, 416, 472, 507, 519;
`AL/services/asset-replace.ts` 182, 410). The gates are `assets.read` / `assets.write` only.

**F-2 — The list is offset-paginated, always folder-scoped, and carries no total.**
`listAssets` (`assets-library.service.ts:342-385`) builds an `$and` of folder, visibility, MIME
prefix, `q` (filename, label or permalink) and `deletedAt` clauses. It pages by an opaque offset
cursor over `(createdAt desc, id desc)` (365-380) because keyset paging lost rows sharing a
truncated millisecond. The route always passes `folderId: parsed.folderId ?? null`
(`routes.admin.ts:259`), so a list is the content of one folder. `listAssetsResponseSchema`
(`packages/contracts/src/assets-library.ts:198`) is `{ data, nextCursor }`. **There is no total
anywhere in the list contract.** The list reads no references.

**F-3 — The detail carries every reference, unfiltered.** `detail()` (`assets-library.service.ts:585-599`)
calls `referenceRegistry.findReferences(a.id)`, one call per registered descriptor, and puts the
result in `AssetDetail.references` (`contracts/src/assets-library.ts:166-168`,
`assetReferenceSchema` 50-55: `{ kind, entityId, label }`). Every write route answers with the
detail, so every write also discloses the references.

**F-4 — The delete refusal names and counts every reference.** `softDelete`
(`assets-library.service.ts:482-494`) answers `409 ASSET_REFERENCED`, message
`Asset is in use by ${refs.length} record(s); detach those first.`, details the first 20
references as `{ path: kind, issue: label }`. The admin drawer disables *Delete* whenever
`detail.references.length > 0` (`AL/../admin/components/AssetDetailDrawer.tsx:610-632`).

**F-5 — Move-many skips ids it cannot find.** `moveMany` (`assets-library.service.ts:526-538`)
loads `id in (…)`, moves what it found and answers `{ movedCount }`. A missing id is silently
skipped; nothing is refused.

**F-6 — The permalink conflict names the asset that holds the name.** `#refuseTaken`
(`assets-library.service.ts:241-255`) and the unique-violation branch (200-212) answer
`409 ASSET_PERMALINK_TAKEN` with `details.assetId` = the holder's id.

**F-7 — Folders carry no asset counts except two.** `listFolderTree` (`AL/services/folders.service.ts:42-61`)
returns folders only. The two counts are `countPermalinkedAssets` (236-242, the folder delete
confirmation) and the `ASSET_FOLDER_NOT_EMPTY` message of a `cancel` delete,
`Folder is not empty (${n} sub-folder(s), ${m} asset(s)).` (170-176). The storage state route
counts `pendingCleanup` and soft-deleted assets library-wide (`routes.admin.ts:356-382`).

**F-8 — `findReferencesMany` never attributes a reference, so the recursive folder delete never
refuses.** The registry keys each reference by a hidden `__assetId` field
(`AL/services/reference-registry.ts:63-84`). **No descriptor sets it** (`grep -rn __assetId`
finds only the reader). Every list in the returned map is therefore empty, and
`deleteFolder(…, 'deleteRecursively')` (`folders.service.ts:187-223`) soft-deletes assets that
Tasks, Projects, CRM, products or pages still use. No test covers a recursive delete of a
referenced asset (`backend/test/contract/assets_library/admin-folders.contract.test.ts:284` deletes
unreferenced assets). This is a live integrity defect, independent of this feature.

**F-9 — The registry honours every descriptor whatever its owner's state, and knows nothing about
presence.** The policy comment (`reference-registry.ts:23-41`) and the composition note
(`AL/index.ts:100-124`): the contribution seam is ungated, boot hooks run regardless of effective
state, and `findReferences` asks every descriptor. `owners()` exists only to attribute a 409.

**F-10 — System work reads the registry directly.** The hard-delete job asks
`referenceRegistry.findReferences` inside the system scope (`AL/jobs/hard-delete-asset.job.ts:143`);
the retention sweeper is built on the same registry (`AL/plugin.ts:179-185`).

**F-11 — The module-facing ports are used on other modules' terms.** `assetsLibraryPort`
(`AL/index.ts:207-212`) is the library service itself. `cms` and `blog` call `getAsset` to render
storefront embeds and read only url, MIME type, filename, label and visibility
(`packages/modules/cms/src/backend/services/asset-embed-resolver.ts:18-42`,
`packages/modules/blog/src/backend/index.ts:105-118`). CRM resolves its attachments' signed links
through `getAsset` (`C/services/opportunity-attachment-service.ts:218`). `assetReadPort`
(`AL/index.ts:190-205`) is read by catalog, orders, invoices, product_feeds, document_templates,
megamenu, Tasks, Projects and CRM.

**F-12 — The shared picker is a client of the same list and detail routes.**
`packages/admin-kit/src/components/asset-picker/assets-api.ts:32-56` calls `GET /api/v1/admin/assets`
and `GET /api/v1/admin/assets/:id`. The only other client is `cms`' preview provider
(`packages/modules/cms/src/admin/components/AdminCatalogPreviewProvider.tsx`).

**F-13 — `assets_library` cannot be switched off and depends on `auth` and `admin_users`.**
`AL/../manifest.ts:146` (`dependencies`), 187-191 (`activation.nonDeactivatable`), 278-280
(`assets.read`, `assets.write`).

### The contributors

**F-14 — Fourteen descriptors from seven modules; three of them are reader-restricted.**

| Owner | Descriptors | Batching | Reader-specific visibility today |
| --- | --- | --- | --- |
| `catalog` | 5: gallery, attachment, virtual download, category image, category content (`packages/modules/catalog/src/backend/services/asset-references.ts:21-27`) | 4 batched; category content loops one jsonpath query per asset (163-185) | none |
| `cms` | 1 (`packages/modules/cms/src/backend/services/asset-references.ts:38`) | loops per asset (43-74) | none |
| `blog` | 2 (`packages/modules/blog/src/backend/services/blog-asset-references.ts:35, 73`) | first batched; content loops per asset (78-108) | none |
| `megamenu` | 1 (`packages/modules/megamenu/src/backend/services/asset-references.ts:31`) | batched | none |
| `tasks` | 1 (`T/services/task-asset-references.ts:25-41`) | batched | private, draft, context (F-16) |
| `projects` | 1 (`P/services/project-asset-references.ts:27-46`) | batched | membership, viewers, setting, Organization reach (F-17) |
| `crm` | 1 (`C/services/crm-asset-references.ts:32-51`) | batched | Organization reach and `crm:read` (F-18) |

`transactional_emails` contributes none; its contract only mentions the registry
(`packages/contracts/src/transactional-emails.ts:403`). The contract says each descriptor
"MUST issue a single batched query" (`contracts/src/assets-library.ts:516-521`); three do not.
None returns the asset id it found (F-8). Each restricted descriptor pushes from a
contribution-only boot hook with no presence probe (`T/index.ts:542-547`, `P/index.ts:638-643`,
`C/index.ts:439-444`), and labels by number only, never by title.

**F-15 — The attachment tables are indexed on `asset_id`.** `task_attachments_asset_id_index`,
`project_attachments_asset_id_index`, `crm_opportunity_attachments_asset_id_index` (each module's
init migration). Attachments are uploaded into the library's **root folder**, as private files
(`T/services/attachment-service.ts:192-194`, `P/services/attachment-service.ts:196-198`).

**F-16 — Tasks: one visibility predicate, ambient caller, and no `tasks:read` check inside it.**
`TaskVisibility` (`T/services/task-visibility.ts`) reads the caller from the tenant context
(`T/index.ts:185-206`, `actingAdminUserId` at `T/services/task-access.ts:165-168`). It narrows by
context (a present contributor must list the context id, 11-13, fail closed when the context owner
is off) and by the draft/private conjunct (14-18, 82-96: a draft is its Creator's only, even for a
`tasks:see_private` holder). The system actor is unrestricted (19-21, 108-111). **It does not
check `tasks:read`** — "the route's gate decides that" (9-10). `TaskAccess.visibleIds(ids)` is one
statement (`T/services/task-access.ts:203-212`), and `condition('t')` is the list pre-filter.

**F-17 — Projects: an ambient viewer that already includes `projects:read`.**
`ProjectAccess.currentViewer()` (`P/services/project-access.ts:284-302`) carries `canRead`
(`projects:read`), `seeAll` (`projects:see_all`) and the Organization reach; a non-reader sees
nothing (`visibleProjectSqlFor`, 189-222). `visibleIds(ids)` (474-487) and `allVisibleIds()`
(524-533) are one statement each; `visibleProjectSql()` is the predicate over `projects p`.

**F-18 — CRM has no assignment-scoped visibility.** An Opportunity is `@OrgScoped`
(`C/entities/crm-opportunity.entity.ts:27`). Its one rule is the Organization reach of the scoped
EntityManager (`C/services/opportunity-access.ts:13-45`, "missing, malformed or out of scope are
indistinguishable") plus the route gate `crm:read`. The manifest declares `crm:read`,
`crm:write`, `crm:configure`, `crm:analytics` (`packages/modules/crm/src/manifest.ts:295-325`)
and nothing scoping a sales representative to their own Opportunities; *assigned to me* is a list
filter (`C/services/opportunity-service.ts:623-630`). **The spec's FR-002 / US1 scenario 6
premise — "a sales representative who may see only the Opportunities assigned to them" — does not
match the code.** The equivalent reader is an administrator whose Organization reach excludes the
Opportunity's Organization, or who lacks `crm:read`.

**F-19 — Attaching an existing asset checks only the attaching module's own records.**
Tasks (`T/services/attachment-service.ts:92-103, 220-226`), Projects
(`P/services/attachment-service.ts:94-104, 226-232`) and CRM
(`C/services/opportunity-attachment-service.ts:103-112, 186-…`) each load the asset through
`assetReadPort.findById(id, { liveOnly: true })` and refuse a file held by *their own* record the
caller cannot see. A file held by another module's hidden record is attached. The answer for a
refused file is `422 VALIDATION_FAILED`, *"The file does not exist in the media library."*, the
same as for a missing one. The routes also require `assets.read`
(`T/routes/routes.collaboration.ts:155-167`, `P/routes/routes.attachments.ts:51-54`,
`C/routes/routes.attachments.ts:36-42`). **The private-file refusal (422, a different sentence)
comes after the existence check**, so a hidden *public* file would be distinguishable from a
missing one if the new check were placed after it.

### Presence, permissions and composition

**F-20 — The wildcard is read through `permissionService.listPermissions`.** `admin_notifications`
(#518) asks `listPermissions(adminUserId)` and tests `ADMIN_PERMISSION_WILDCARD` or the code
(`packages/modules/admin_notifications/src/backend/index.ts:88-95`); `listPermissions` is the
published `PermissionReadPort` (`packages/contracts/src/admin-roles.ts:177`),
`ADMIN_PERMISSION_WILDCARD = '*'` (59). `hasPermission` refuses an administrator without a role
(`packages/modules/admin_roles/src/backend/services/permission-service.ts:59-65`). `admin_roles`
is non-deactivatable (`packages/modules/admin_roles/src/manifest.ts:84`).

**F-21 — Presence is a synchronous in-memory read.** `effectiveState.isPresent(moduleId)`
(`packages/platform/src/kernel/lifecycle/effective-state.ts:33, 144`), exported from
`@endora-commerce/platform/kernel`, kept fresh by the `b2b:module:state-changed` refresh; Tasks
uses it for its own context registry (`T/index.ts:187`).

**F-22 — A module unavailable on the platform axis is still composed and still contributes.**
The composition root composes every supplied module entry
(`packages/platform/src/composition/compose-app.ts:518, 806`) and `composeModules` registers each
without consulting `module_registrations` (`packages/platform/src/kernel/compose.ts:358-371`).
Boot hooks "run regardless of effective state" (`AL/index.ts:103-106`). So a module disabled by
`module:disable`, or soft-uninstalled, still pushes its descriptor and its references still
count. **Only a module that is not composed at all** — its package removed after
`module:uninstall --hard`, or an instance scaffolded without it — contributes nothing; its
`registerModule` never runs. (A hard uninstall that reverts the migrations and leaves the package
composed would point the descriptor at dropped tables — D-159 §7, `orchestrator.ts:482-490`, says
the package is removed after it; that hazard predates this feature.) **The spec's FR-009a
premise — "take the module out of the deployment (platform availability)" — is true only of the
second reading.**

**F-23 — The visibility seams already read the ambient caller, so they can run inside a library
request unchanged.** Tasks, Projects and CRM each answer for "whoever the tenant context says is
asking" (F-16 – F-18). A library request runs under the admin's tenant context, so an owner asked
from inside it answers for that admin, including their Organization reach.

---

## Decisions

### R-1 — The rule is enforced on the library's admin surface and at attach time, not in the ports

**Decision.** The reader rule applies to:
- the 20 admin routes of `AL/routes.admin.ts` (route-by-route in `contracts/admin-api.md`);
- one new caller-aware read on `assetReadPort`, `visibleToCaller(assetIds)`, which Tasks, Projects
  and CRM call when an existing asset is attached (R-13).

It does **not** apply to `assetsLibraryPort`, the existing `assetReadPort` methods,
`objectStoragePort`, the public file routes or the reference registry. Those serve modules that
decide by their own record's rules (F-11), and system work (F-10).

**Rationale.** A library reader is "an administrator using the library's screens, or the picker
that reuses them" (F-12). The modules that resolve asset details for a storefront page, a Task's
attachment list or a product feed are not library readers: filtering there would break storefront
embeds for customers (who see no Task) and Tasks' own download links (which follow Task
visibility already).

*Rejected:*
- Filtering inside `AssetsLibraryService.getAsset` / `resolveUrl`: the same methods back
  `assetsLibraryPort` (F-11).
- Filtering in the registry: the deletion guard and the sweeper must count every reference
  (FR-008, FR-011).

### R-2 — The descriptor gains an optional `readerRestriction`, answered for the ambient caller

**Decision.** Additive contract change (`contracts/ports.md` §1):
- `AssetReferenceHit = AssetReference & { assetId?: string }`; `findReferences` returns hits. A
  restricted descriptor must set `assetId`; every in-tree descriptor will (R-6).
- `AssetReferenceDescriptor.readerRestriction?: AssetReferenceReaderRestriction` — an optional
  **data property**. Present means the kind is reader-restricted (FR-003); absent means it never
  hides an asset, so catalog, CMS, blog and megamenu change nothing but R-6.
- `AssetReferenceReaderRestriction` has three methods, each a bounded number of statements
  independent of input size:
  - `visibleEntityIds(entityIds)` — which of these records the ambient caller may see, by the
    owner's own screen rule **including its read permission**;
  - `assetIdsWithHiddenReferences()` — every asset id at least one record the caller may *not*
    see points at; the exact, NULL-safe complement of the first;
  - `allReferencedAssetIds()` — every asset id the kind points at, whoever asks; plain SQL over
    the owner's tables, asked only while the owner is switched off (R-4).

The caller is **ambient**, not a parameter.

**Rationale.**
- The three owners already answer for the ambient caller (F-16 – F-18, F-23): Tasks through
  `TaskVisibility`, Projects through `ProjectAccess.currentViewer`, CRM through the scoped
  EntityManager. A parameter would force each to rebuild the reader's reach from an id — only
  Projects has that (`canSeeAs`), and it costs an `admin_users` and an `organizations` read.
- It is the precedent of `TaskContextDescriptor.allVisibleContextIds()` / `visibleContextIds()`,
  which Projects already implements over the same `ProjectAccess` (`P/services/task-context-descriptor.ts:65-66`).
- An optional data property passes `check:port-shape` (it refuses optional *methods* on a
  published port), and the descriptor is a contribution shape, not a port.
- `assetIdsWithHiddenReferences` exists for the list (R-5): without it the library cannot narrow
  a page in SQL. `allReferencedAssetIds` exists so that a switched-off owner's code — which may
  resolve gated ports — is never asked a visibility question (R-4).
- The read-permission clause matters for Tasks: `TaskVisibility` does not check `tasks:read`
  (F-16), and the spec's assumption is that a reader without Tasks access sees no Task.

*Rejected:*
- `restricted: true` plus `visibleReferences(references, readerId)`: an explicit reader id (see
  above), and no way to narrow a list in SQL.
- Marking restriction per **kind** in `assetReferenceKindSchema`: a kind is a closed contract enum;
  restriction is the owning module's runtime knowledge, and an overlay may register kinds' owners
  differently.
- A dedicated visibility port per owner (`taskAssetVisibilityPort`, …): three new ports and three
  new edges from `assets_library` onto switchable modules, for what the contribution already
  carries. A port read from the library onto Tasks would also make the library's list 503 whenever
  Tasks is off (D-40), the opposite of R-4.

### R-3 — Who the caller is: four classes, decided once per request

**Decision.** `AssetVisibility.caller()` classifies the ambient tenant context:

| Caller | Treatment |
| --- | --- |
| System actor (sweeps, jobs, migrations, the deletion guard) | **unrestricted** (FR-011) |
| Admin whose `permissionService.listPermissions(id)` contains `*` | **unrestricted** (FR-010), including while an owner is off |
| Any other admin | **restricted**, asks present owners |
| Anything else: no context, a customer, an API key | **sees no restricted record** — every restricted reference is hidden (fail closed) |

It is computed at most once per request (the guard of R-7 stores it on the request).
`assets_library` gains `admin_roles` in `dependencies` for the `permissionService` read (F-20);
`admin_roles` is non-deactivatable, so the edge needs no degrade classification.

**Rationale.** `listPermissions` is #518's precedent and does not throw for a role-less
administrator. The wildcard is the only override (Q2 = A); no new permission.

*Rejected:*
- `hasPermission(id, '*')`: refuses a role-less administrator with a 403 inside a read.
- A new `assets.see_all` permission: excluded by Q2 = A.
- Reading the actor from `request.adminActor`: the services and `assetReadPort` run without a
  request object; the tenant context is the one source both have.

### R-4 — Fail closed while an owner is switched off, decided by the library

**Decision.** Before asking a restricted descriptor anything about visibility, `AssetVisibility`
asks `effectiveState.isPresent(descriptor.ownerModuleId)` (F-21). When the owner is not present:
- its references are all invisible to a restricted caller;
- its contribution to the hidden-candidate set is `allReferencedAssetIds()` (plain SQL);
- `visibleEntityIds` and `assetIdsWithHiddenReferences` are **not** called.

The deletion guard keeps asking `findReferences` of every descriptor (F-9) — unchanged, so nobody,
the wildcard holder included, can delete those files while the owner is off (FR-009).

**Rationale.**
- Q1 = A. Asking the owner is impossible while it is off: its visibility code resolves gated
  ports (`permissionService` is fine, but Tasks' context contributors and CRM's scoped services
  are the module's own composed state), and a `ModuleDisabledError` must not be caught
  (`check:port-catches`).
- Presence is read per evaluation, so switching the owner back on restores the previous answer
  without a restart (SC-005), and nothing is written in either direction (Constitution XVII).
- A file used by a switched-off Task **and** a product stays visible, because the product is a
  visible reference (FR-001 b).

*Rejected:*
- Skipping a switched-off owner's descriptor in the visibility evaluation: files used only by it
  would become "used by nothing" and visible to every reader — fail open, the opposite of Q1 = A.
- Hiding through a registry-level presence filter: the registry also serves the deletion guard,
  which must keep honouring the descriptor.

### R-5 — The list is narrowed in SQL by a per-request exclusion set

**Decision.** For a restricted caller, `listAssets` and the permalink count compute an exclusion
set **H** before their query and add `and id <> all(?::uuid[])`:

1. **Candidates C** = the union over restricted descriptors of `assetIdsWithHiddenReferences()`
   (owner present) or `allReferencedAssetIds()` (owner off, or a caller who sees no restricted
   record). One call per restricted descriptor, in parallel.
2. If C is empty, stop: nothing is hidden.
3. **Scope** C_s = `select id from assets where <the list's own where> and id = any(C)` — one
   library statement, so only candidates that could appear on this list are evaluated.
4. **H = hiddenAmong(C_s)** (the evaluation of R-7, batched): the restricted descriptors'
   `findReferences(C_s)` and, for present owners, `visibleEntityIds` of the entity ids found; the
   assets with no visible restricted reference are then checked against the unrestricted
   descriptors' `findReferences` (FR-001 b) — the "rescue" step; whatever is left is hidden.

The offset cursor then pages over the filtered sequence, so every page is full and the cursor
never skips or repeats a visible row. A wildcard or system caller skips all of it.

**Rationale.**
- Pages stay exact and the existing cursor contract is untouched (F-2). There is no total to keep
  exact; the only counts are the folder ones (R-10).
- Work is bounded by the candidates *in this folder and filter*, not by the library's size: a
  product-image folder evaluates nothing beyond step 1, and the root folder — where attachments
  land (F-15) — evaluates the hidden attachments once per page, in a constant number of
  statements (FR-014).
- Every call is a batch; no step is per asset once R-6 lands.

*Rejected:*
- **Filter after fetch, refilling the page.** A reader who sees none of 2 000 Task attachments in
  the root folder would scan 2 000 rows to fill one page, and page latency would vary with how
  much is hidden — a timing signal (FR-012).
- **Owners return every record id the reader may see**, and the library joins in SQL: the sets
  are unbounded (every Task a `tasks:see_private` holder sees), and the join would need the
  owners' tables in the library's query, which `check:module-boundary` refuses.
- **A library-side reference index** (an `asset_references` table fed by events): a second copy of
  three modules' data, kept in sync across switch-offs, plus a migration — and the owner would
  still have to decide visibility, so it saves only step 3.
- **A per-admin cached exclusion set**: invalidated by every attach, detach, draft publish, privacy
  flip, membership change, permission change and presence change — a cache whose correctness
  would be the leak.

*Measured by:* `backend/test/perf/assets_library/reference-visibility.perf.test.ts` (R-16). The
fallback, only if SC-004 fails, is to memoise each owner's scope within one request (Tasks
computes `TaskVisibility.scope()` in both `assetIdsWithHiddenReferences` and `visibleEntityIds`).

### R-6 — Every descriptor attributes its references to an asset, in one statement

**Decision.**
- Every in-tree descriptor sets `assetId` on each hit: 5 catalog, 1 cms, 2 blog, 1 megamenu,
  1 each in Tasks, Projects and CRM.
- The three loop-per-asset descriptors (catalog category content, cms, blog content; F-14) become
  one jsonpath statement each over the batch, as the contract already requires.
- The registry attributes by `hit.assetId`. For a descriptor (an overlay's or a package's) that
  returns untagged hits for a batch of more than one asset, the registry falls back to one call per
  asset for that descriptor, so the answer is correct whatever the contributor did.
- `findReferencesMany` is repaired by this, and with it the recursive folder delete (F-8).

**Rationale.** R-5's rescue step and R-10's folder delete ask about many assets at once. With a
per-asset loop the root-folder page would cost three jsonpath scans per hidden candidate, and with
untagged hits every batched answer is wrong (F-8). SC-003 ("refusal fires for 100% of assets used
by any record") covers the folder delete, which does not refuse today.

*Rejected:*
- Leaving the three loops and capping the batch: correctness would depend on the cap.
- Making `assetId` required on `AssetReference`: the wire shape of the detail would change for no
  reader's benefit. The hit type is the descriptor's, and the detail strips the field.

### R-7 — One guard on every by-id route, before anything is read or parsed

**Decision.** A `requireVisibleAsset` preHandler runs on every admin route with an `:id` asset
parameter (10 routes, F-1), after the permission gate and **before** the body or multipart stream
is read. It:
1. classifies the caller (R-3) and stores it on the request;
2. for a restricted caller, asks the restricted descriptors `findReferences([id])`;
3. if it found any, asks present owners `visibleEntityIds`;
4. if none is visible, asks the unrestricted descriptors (rescue);
5. if still none, throws the **same** `HttpError(404, ASSET_NOT_FOUND, 'Asset ${id} not found.')`
   the service throws for a missing row (one shared `assetNotFound(id)` helper).

Step 2 runs whether or not the row exists, so a missing id and a hidden id issue the same first
reads. A structural test lists every `:id` route of `routes.admin.ts` and fails on one without
the guard.

**Rationale.**
- One seam that a later route cannot forget, which is the lesson the kernel's gating wrappers
  record (`specs/conventions/module-activation.md` item 1).
- Before the multipart parse, so a hidden asset's replace never stages bytes (no storage write, no
  timing difference from the upload).
- Status, code and message are byte-identical (FR-012).

**Residual timing.** For a hidden id, steps 3-4 add the owner and rescue reads — a few
milliseconds against a request of tens. That is not "detectable in normal use", since asset ids
are random v4 UUIDs a reader must already know. The perf suite records the missing-versus-hidden
difference without gating on it.

*Rejected:*
- A check inside each service method: the service is also `assetsLibraryPort` (R-1).
- A 403 for hidden assets: distinguishes "exists" (FR-012).

### R-8 — The detail lists visible references; the delete refusal counts all and names the visible ones

**Decision.**
- `AssetDetail.references` for a restricted caller = every unrestricted reference plus the
  restricted references whose `entityId` is in the owner's `visibleEntityIds` (FR-007). The
  wildcard and the system see all. `assetId` is stripped from the wire.
- `DELETE /assets/:id` still asks every descriptor and refuses when **any** reference exists
  (FR-008, SC-003). The 409's count and its `details` are the **visible** references only:
  `Asset is in use by ${visible.length} record(s); detach those first.`

**Invariant I-1.** For a visible asset, the visible-reference list is empty **only if** the
reference list is empty. FR-001 makes an asset visible either because it has no restricted
reference (all its references are unrestricted, hence visible) or because at least one reference
is visible. So:
- a refusal always names at least one record;
- the drawer's "disable delete when references are non-empty" (F-4) stays right without a UI
  change;
- a 409 never says "in use by 0 records", which would itself leak a hidden record.

*Rejected:*
- Counting hidden references in the message ("2 records, 1 hidden from you"): a leak by count
  (FR-007).

### R-9 — Move-many treats a hidden id exactly as a missing id

**Decision.** `moveMany` loads `id in (…)`, drops the ids the caller may not see (R-7's
evaluation, batched), moves the rest and answers `movedCount` of what moved. A hidden id is
skipped, as a missing id is today (F-5). Nothing hidden is ever moved.

**Rationale.** FR-012 requires the hidden answer to equal the missing answer, and the missing
answer today is "skipped". The spec's edge case, "answered as not found, never partially applied",
is read as "the hidden file is never touched". **[Spec wording to confirm]** — the alternative
reading, an all-or-nothing 404, would change the behaviour for genuinely missing ids too; it is
not adopted without the owner saying so.

### R-10 — Folders: counts follow the reader, and a deleted folder re-homes what the reader cannot see

**Decision.**
- **Permalink count** (`GET …/folders/:folderId/permalink-count`): counts the visible assets of
  the subtree (R-5's exclusion set over the subtree).
- **Folder delete**, for a restricted caller, all three strategies:
  - `cancel`: a folder whose only assets are hidden counts as empty for the refusal. The hidden
    assets are moved to the deleted folder's parent (the root when it has none), and the folder is
    deleted. The `ASSET_FOLDER_NOT_EMPTY` message counts visible assets only.
  - `moveContentsToParent`: unchanged — hidden assets already go to the parent with the rest.
  - `deleteRecursively`: references are now really checked (R-6). Visible referenced assets block
    the deletion, as the code always intended, and the 409 lists only their ids. Hidden assets are
    re-homed to the deleted root's parent and are not soft-deleted. Visible unreferenced assets are
    soft-deleted as today.
  - The folder-delete audit row (`asset_folder.delete`, `folders.service.ts:165`) gains
    `rehomedAssetIds` in `stateBefore`, in the same flush.
- The folder tree itself carries no asset data and is unchanged.
- The wildcard and the system see every asset, so for them the strategies behave as before, except
  for the R-6 repair.

**Rationale.**
- A folder whose only content is hidden must answer like an empty one (FR-012, the edge case "the
  library's own folders never reveal hidden files"). Refusing would say "something is here".
- Deleting the hidden file is impossible: it is referenced, hence protected.
- Moving it to the parent is a metadata change on a file the reader cannot see. It loses nothing,
  and the owning record does not use folders. It is the outcome `moveContentsToParent` already
  produces.
- The audit row keeps the trail honest for whoever may read audit logs; that surface is gated by
  `audit_logs:read`, which is outside this feature.

*Rejected:*
- Refusing with a neutral message ("the folder holds items you cannot see"): a leak of existence.
- Deleting the folder and orphaning the hidden asset's `folder_id`: a dangling reference.

**[Spec amendment recommended]**: say in the folders edge case that a deleted folder's hidden files
move to its parent folder.

### R-11 — The permalink conflict does not name a hidden holder

**Decision.** When `ASSET_PERMALINK_TAKEN` is raised (F-6) and the holder is not visible to the
caller, `details.assetId` is `null`. Status, code, message and `details.permalink` are unchanged.

**Rationale.** The name is in one shared namespace, so "taken" cannot be hidden without letting
two assets share a permalink. Which asset holds it can be hidden. `assetId: null` is already a
value the contract allows (`holders[0]?.id ?? null`, F-6).

### R-12 — The storage state counts stay library-wide

**Decision.** `GET /assets/storage/state`'s `pendingCleanupCount` and `softDeletedCount` are
unchanged.

**Rationale.**
- They are operational aggregates of the storage back end, in the same class as the self-check
  (FR-011, "storage checks").
- They name no asset and no record.
- A hidden asset is referenced, so it is neither soft-deleted nor pending clean-up in normal
  operation. The exception is the F-8 defect's past victims, and R-6 stops new ones.

**[Owner may object]**: if FR-012's "totals" is meant to cover these two numbers too, they become
per-reader with R-5's exclusion set, at the cost of one more evaluation per storage-page load.

### R-13 — Attaching an existing asset asks the library first (FR-006)

**Decision.**
- `AssetReadPort` gains a required method, `visibleToCaller(assetIds): Promise<ReadonlySet<string>>`,
  implemented by `AssetReadService` over `AssetVisibility` (R-3 – R-7).
- In each owner's `add()` — Tasks, Projects, CRM — the call goes **immediately after**
  `findById(…, { liveOnly: true })` and before the module's own holder check, the private-file
  check and the active-content check. An asset not in the answer gets the module's existing
  `fileUnavailable()` (422, the same sentence as a missing file).
- The module's own holder checks stay. They are stricter (any hidden holder of *this* module
  refuses), and loosening them is not this feature's to do.

**Rationale.**
- Only the library can combine every owner's answer.
- The position is forced by F-19: after the private-file refusal, a hidden public file would get a
  different sentence from a missing one.
- No new edge: all three already resolve `assetReadPort`.

*Rejected:*
- Each owner asking the registry: the registry is the deletion seam, the evaluation is the
  library's, and three copies of R-5 would drift.
- Relying on the route's `assets.read` gate: it says nothing about which assets.

### R-14 — FR-009a: "out of the deployment" means "not composed"

**Fact, not a choice** (F-22). In this repository every module the instance's composer lists is
composed, whatever its platform state. A platform-disabled or soft-uninstalled owner still
contributes its descriptor, and its presence is false. Its files are therefore **hidden (R-4) and
protected**, exactly as for an operator switch-off.

Only an owner whose package is not composed contributes nothing. That is `module:uninstall --hard`
followed by removing the package, or an instance scaffolded without it. Its former files then count
as used by nothing, and they are visible and deletable.

No design change follows from this; the spec's wording needs one.

**[Spec amendment recommended]**: FR-009a's second bullet should read: "remove the module from the
deployment's composed module set (uninstall it and remove its package); a module only disabled on
the platform axis is still composed and behaves as switched off (FR-009)."

### R-15 — CRM's rule is Organization reach plus `crm:read`

**Fact** (F-18). The CRM descriptor's restriction answers with the scoped EntityManager and
`crm:read`:
- `visibleEntityIds`: the Opportunity ids `em.find(CrmOpportunity, { id: { $in } })` returns for
  the caller, or none without `crm:read`.
- `assetIdsWithHiddenReferences`: the attachment rows' asset ids whose Opportunity is not in that
  answer — two statements, the raw `(asset_id, opportunity_id)` pairs and one scoped `find` over
  their distinct Opportunity ids.

This also closes a cross-tenant path the library had: a scoped administrator could list another
Organization's Opportunity attachments (Constitution XI).

**[Spec amendment recommended]**:
- FR-002's CRM line becomes "CRM: the Organization reach of the administrator and `crm:read`".
- US1 scenario 6 becomes "an administrator whose Organizations exclude the Opportunity's
  Organization".

The scenario stays testable, with an administrator scoped through `organizations`' admin tenant
scope.

### R-16 — Test plan, per story

The tests are listed in `quickstart.md` §1. The principles:

- **Not-found identity.** One table-driven integration test,
  `backend/test/integration/assets_library/reference-visibility.test.ts`, runs every by-id route
  of F-1, plus move-many, list, picker query, permalink count and folder delete. It runs them
  against a **hidden** asset and a **random uuid**, and asserts equal status, `code`, `message`
  and body shape (SC-001). It runs per restricted kind:
  - Task: private, draft, and in a Project context the reader cannot see;
  - Project: membership;
  - Opportunity: Organization reach.
- **Unrestricted kinds unchanged** (SC-002). The same suite, with product, category, CMS, blog and
  megamenu references and an unused upload, for a restricted reader and the wildcard. Items,
  order, `nextCursor` and `references` are compared with the wildcard reader's.
- **Multi-reference rescue.** Private Task + product; two Tasks (one visible); a Task in a
  switched-off module + a CMS page.
- **Delete** (SC-003). Every reference counted, visible ones named; the recursive folder delete
  refuses (R-6 regression); a hidden asset is re-homed.
- **Owner off** (SC-005). `withModuleOff('tasks' | 'projects' | 'crm')`:
  - hidden for B, visible for the wildcard, undeletable for both;
  - after switching on, each reader's list is equal to the one before.
- **FR-006.** The attach-existing refusal in each of Tasks', Projects' and CRM's attachment tests,
  for a file hidden by **another** module's record, with a **public** hidden file among them
  (F-19 ordering).
- **Unit.**
  - `AssetVisibility` with fake descriptors: the caller classes, the owner-off branch, the rescue,
    and the untagged-descriptor fallback.
  - The registry's attribution.
  - Each owner's restriction against the same seed, asserting `assetIdsWithHiddenReferences` is
    the exact complement of `visibleEntityIds` (including Tasks' NULL `context_id` rows).
- **Perf** (SC-004). `backend/test/perf/assets_library/reference-visibility.perf.test.ts`, on the
  `PERF_RUN` pattern of `backend/test/perf/tasks/context-visibility.perf.test.ts`. Seed:
  - 50 root-folder assets, each with three references of different kinds (a product gallery, a
    Task the reader sees or not, a Project the reader is not a member of);
  - 2 000 hidden Task attachments in the same folder.

  Measure p95 of `GET /assets` (limit 50) over 30 iterations for the restricted reader and for the
  wildcard reader, whose path is today's code path. Budgets:
  - restricted p95 < 1 000 ms;
  - restricted p95 ≤ 1.2 × wildcard p95.

  Both are env-overridable. The missing-versus-hidden by-id timing is recorded, not gated.

### R-17 — Cross-cutting concerns

| Concern | Outcome |
| --- | --- |
| Permissions | None new (Q2 = A). `assets.read` / `assets.write` gates unchanged. |
| Command palette | No new screen, no new action. |
| i18n | No new user-facing string. The 409 and 404 sentences already exist and keep their keys; only counts change. |
| Settings | None. |
| Auditing | No new write path. The re-home writes join the folder-delete flush and its existing audit row (R-10). |
| Redis / cache invalidation | Nothing is cached. Presence comes from `effectiveState`, which the lifecycle pub/sub already refreshes. |
| Tenancy (XI) | Assets stay `@GlobalEntity`. The rule rides on each owner's tenant-aware predicate, so a scoped administrator stops seeing other Organizations' attachments (R-15). |
| Off-state (XVII) | No module gains an activation control. `assets_library` stays non-deactivatable. Owner switch-off is R-4. |
| Docs | `packages/modules/assets_library/docs/assets-library/index.md`, plus its Polish copy under `docs/i18n/pl/…/modules/assets-library/`: a "Who sees which files" section for users and the `readerRestriction` contract for developers. |
| Release intent | Changesets — see `plan.md`. |
