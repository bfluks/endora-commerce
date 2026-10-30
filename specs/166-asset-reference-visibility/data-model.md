# Data model: Asset visibility follows the records that reference it

## 1. Persistent schema: no change

**No table, column, index, constraint or migration is added, altered or removed in any module.**

- The rule is computed per request from data the owners already hold:
  - `task_attachments` → `tasks`;
  - `project_attachments` → `projects` (with `project_members`, `project_viewers` and
    `project_organizations`);
  - `crm_opportunity_attachments` → `crm_opportunities`.
- Every lookup the library asks for is keyed on an index that exists: `*_attachments_asset_id_index`
  on each attachment table, and each parent's primary key (research F-15).
- `assets` stays `@GlobalEntity`; whether an asset is visible is not a property of the row
  (research R-5 rejects a stored index).
- The one new **write** is a re-home: on folder delete, a hidden asset's `folder_id` becomes the
  deleted folder's parent (research R-10). It writes an existing column.

No migration is scaffolded, so `composer:generate` has nothing new to register.

## 2. In-memory model (`assets_library`, `src/backend/services/asset-visibility.ts`)

### 2.1 Caller

```ts
type AssetCaller =
  | { kind: 'unrestricted'; why: 'system' | 'wildcard' }   // FR-011, FR-010
  | { kind: 'admin'; adminUserId: string }                  // asks present owners
  | { kind: 'nobody' };                                     // no admin, not the system: no restricted record visible
```

It is derived from the ambient TenantContext and, for an admin, from
`permissionService.listPermissions(adminUserId)` (contains `'*'` → unrestricted). It is computed
at most once per request and stored on the request by the guard (research R-3).

### 2.2 Visibility rule (FR-001), for one asset `a` and a caller `c`

Let `R(a)` be every reference to `a` reported by the registry's descriptors, each with the
`ownerModuleId` and `restricted` flag of its descriptor.

| Condition | Visible? |
| --- | --- |
| `c` is unrestricted | yes |
| no `r ∈ R(a)` is restricted | yes (FR-001 a — includes "used by nothing") |
| some unrestricted `r ∈ R(a)` exists | yes (FR-001 b — e.g. a product) |
| some restricted `r ∈ R(a)` has a **present** owner, `c` is an admin, and `r.entityId ∈ owner.visibleEntityIds` | yes (FR-001 b) |
| otherwise | **hidden** |

A restricted reference whose owner is not effectively present is never visible to a restricted
caller (FR-009, research R-4). For `nobody`, no restricted reference is visible.

**Visible references** of a visible asset, the detail list and the delete refusal's names (FR-007,
FR-008) are:
- every unrestricted reference;
- every restricted reference passing the fourth row;
- all of them, for an unrestricted caller.

**Invariant I-1.** A visible asset with `R(a) ≠ ∅` has at least one visible reference (research
R-8).

### 2.3 Batched evaluation, `hiddenAmong(ids)`

1. The restricted descriptors' `findReferences(ids)` give the hits, attributed by `assetId`.
2. The present owners' `visibleEntityIds(entity ids of their hits)` — one call per owner.
3. `pending` = ids with at least one restricted hit and no visible one.
4. The unrestricted descriptors' `findReferences(pending)`; an id with any hit leaves `pending`.
5. Return `pending`.

The cost is constant in the size of `ids` once every descriptor batches (research R-6).

### 2.4 List exclusion, `exclusionFor(where)`

`C` = ⋃ over restricted descriptors of:
- `assetIdsWithHiddenReferences()` (owner present, caller is an admin);
- `allReferencedAssetIds()` otherwise.

`C_s` = `select id from assets where <where> and id = any(C)`.

The list then runs with `id <> all(hiddenAmong(C_s))` (research R-5).

## 3. Contract shapes

See `contracts/ports.md`:
- `AssetReferenceHit`, `AssetReferenceReaderRestriction` and
  `AssetReferenceDescriptor.readerRestriction` (§1);
- `AssetReadPort.visibleToCaller` (§3).

No HTTP schema changes (`contracts/admin-api.md`).

## 4. Audit

| Write | Audit |
| --- | --- |
| Re-home of hidden assets on folder delete | The existing `asset_folder.delete` row, `stateBefore.rehomedAssetIds`, in the same flush (research R-10) |
| Everything else | Unchanged: no new write path, no new Command |

## 5. State transitions

None new. An asset moves between *visible* and *hidden* for a given reader only as a consequence
of other modules' existing writes and settings:
- attach or detach;
- publish a draft, or make a Task private or public;
- change a membership or a viewer;
- change an Organization reach or a permission;
- switch the owner off or on.

The library records nothing about the transition, so switching a module off and on again leaves
every reader's view exactly as it was (SC-005).
