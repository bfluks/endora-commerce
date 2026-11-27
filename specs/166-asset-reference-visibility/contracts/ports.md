# Contract: the reference descriptor, the registry, `assetReadPort` and the dependency edges

All shapes live in `packages/contracts/src/assets-library.ts`. Every change is **additive**: an
existing descriptor compiles and behaves as before, and no existing method changes its meaning.
Decisions: research R-2, R-3, R-4, R-6 and R-13.

## 1. `AssetReferenceDescriptor` (contributed into `assetReferenceRegistry`)

```ts
/**
 * One reference as a descriptor reports it. `assetId` is the asset the reference
 * points at — what lets the library answer for many assets in one call.
 *
 * Required of a descriptor that declares `readerRestriction`, and set by every
 * descriptor in this repository. A descriptor that omits it is still answered
 * correctly: the registry asks it one asset at a time (research R-6).
 * Never sent to a client: `AssetDetail.references` carries `AssetReference`.
 */
export type AssetReferenceHit = AssetReference & { readonly assetId?: string };

/**
 * The reader-restriction half of a descriptor (feature 166, FR-002/FR-003).
 *
 * **Every method answers for the ambient caller** — the administrator the
 * request's TenantContext names, with their Organization reach — exactly as the
 * owner's own screens do, **including the owner's read permission** (a caller
 * without `tasks:read` sees no Task). It is the `TaskContextDescriptor`
 * precedent: the caller is never a parameter.
 *
 * The library asks only while the owner is **effectively present**, and never
 * for the system actor or a wildcard holder, whom it answers itself. Each method
 * is a bounded number of statements, independent of the size of its input
 * (FR-014). Never catch `ModuleDisabledError` inside one (`check:port-catches`).
 */
export interface AssetReferenceReaderRestriction {
  /** Of these record ids of this descriptor's kind, the ones the caller may see. Unknown ids are simply absent. */
  visibleEntityIds(entityIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Every asset id that at least one record of this kind the caller may **not**
   * see points at. The exact complement of `visibleEntityIds` over this
   * descriptor's references — written NULL-safe (`(<visible>) is not true`), so
   * a row the predicate cannot decide is hidden, never shown.
   */
  assetIdsWithHiddenReferences(): Promise<readonly string[]>;
  /**
   * Every asset id any record of this kind points at, whoever asks. Asked while
   * the owner is **switched off**, when no record is visible (Q1 = A). Plain SQL
   * over the owner's own tables, like `findReferences`, because it runs while the
   * owner is off: it resolves no port.
   */
  allReferencedAssetIds(): Promise<readonly string[]>;
}

export interface AssetReferenceDescriptor {
  ownerModuleId: string;
  /** Unchanged contract (one batched statement), now returning hits. */
  findReferences(assetIds: string[]): Promise<AssetReferenceHit[]>;
  /**
   * Present ⇔ these references are **reader-restricted**: a reader who may see
   * none of the records referencing an asset does not see the asset (FR-001).
   * Absent ⇔ the references never hide an asset (catalog, cms, blog, megamenu).
   * An optional **data property**, not an optional method (`check:port-shape`).
   */
  readonly readerRestriction?: AssetReferenceReaderRestriction;
}
```

**Compatibility.** `Promise<AssetReference[]>` is assignable to `Promise<AssetReferenceHit[]>`,
so an overlay's or a package's existing descriptor needs no change. It stays unrestricted and is
asked one asset at a time where a batch is needed.

### 1.1 Implementations

| Owner | `assetId` on hits | `readerRestriction` |
| --- | --- | --- |
| `catalog` ×5 | yes; category content becomes one jsonpath statement over the batch | — |
| `cms` | yes; one jsonpath statement over the batch | — |
| `blog` ×2 | yes; content becomes one jsonpath statement over the batch | — |
| `megamenu` | yes | — |
| `tasks` | yes | **yes** — see below |
| `projects` | yes | **yes** — see below |
| `crm` | yes | **yes** — see below |

**Tasks.**
- `visibleEntityIds`: if the caller does not hold `tasks:read` (or the wildcard), none. Otherwise
  `TaskAccess.visibleIds(ids)`, which applies the context, draft and private predicate.
- `assetIdsWithHiddenReferences`: without `tasks:read`, all of them. Otherwise
  `select distinct a.asset_id from task_attachments a join tasks t on t.id = a.task_id where (<TaskVisibility.condition('t')>) is not true`,
  or none when the condition is `null`.
- `allReferencedAssetIds`: `select distinct asset_id from task_attachments`.
- The `tasks:read` check is the module's `owner-read-permissions.ts` shape (`listPermissions`
  plus the wildcard). Copy it for `TASKS_READ`.

**Projects.**
- `visibleEntityIds`: `ProjectAccess.visibleIds(ids)` (it already returns none without
  `projects:read`).
- `assetIdsWithHiddenReferences`: without `canRead`, all of them. Otherwise the same join over
  `project_attachments` / `projects p` with `(<visibleProjectSql>) is not true`.
- `allReferencedAssetIds`: `select distinct asset_id from project_attachments`.

**CRM.**
- `visibleEntityIds`: without `crm:read`, none. Otherwise the ids that
  `em.find(CrmOpportunity, { id: { $in } }, { fields: ['id'] })` returns through the scoped
  EntityManager (Organization reach).
- `assetIdsWithHiddenReferences`: the `(asset_id, opportunity_id)` pairs of
  `crm_opportunity_attachments` whose Opportunity is not in that scoped answer. Two statements.
- `allReferencedAssetIds`: `select distinct asset_id from crm_opportunity_attachments`.

Each owner builds the restriction in its existing **contribution-only** boot hook. Its own
services are reached per call through `ctx.cradle()` and never captured at boot. There is still
no presence probe in the hook (`module-activation.md` item 3, the contribution case); the library
decides presence (§2).

## 2. `AssetReferenceRegistryPort` (container `assetReferenceRegistry`, owner `assets_library`)

- **The method set is unchanged.**
- **Enumeration policy is unchanged: honoured while the contributor is absent.** `findReferences`
  and `findReferencesMany` ask every descriptor, whatever its owner's state. They are the deletion
  guard's and the sweeper's questions (FR-008, FR-011).
- **`findReferencesMany` is repaired.** It attributes by `hit.assetId`. Where a descriptor returns
  an untagged hit for a batch of more than one asset, it asks that descriptor once per asset
  (research F-8, R-6).
- The contract doc block gains one paragraph. The *visibility* evaluation is the library's own
  (`AssetVisibility`, `data-model.md` §2). It reads the descriptors through the registry class,
  not through this port, and it decides an absent owner's references as **hidden** (Q1 = A). The
  two policies answer different questions.

## 3. `AssetReadPort` (container `assetReadPort`, owner `assets_library`, gated)

One new **required** method. `check:port-shape` refuses optional methods, and the only provider
is `AssetReadService`:

```ts
/**
 * Which of these assets the **ambient caller** may see in the asset library
 * (feature 166): an asset no reader-restricted record uses, or one at least one
 * of whose records the caller may see. The system actor and a holder of the
 * platform wildcard `*` see every id that exists. An id that does not exist,
 * or is not a uuid, is absent — the same as a hidden one.
 *
 * Ask it before any other refusal that would describe the asset (its
 * visibility, its type), so a hidden asset and a missing one get one answer.
 */
visibleToCaller(assetIds: readonly string[]): Promise<ReadonlySet<string>>;
```

Callers are Tasks, Projects and CRM's `add()` (FR-006). Nothing else changes on the port:
`findById`, `findByIds`, `resolvePublicUrls` and `openAssetBytes` stay unfiltered (research R-1).
Test doubles cast or `Pick` the port (`catalog`'s `gallery-batch-read.test.ts`, `invoices`'
`cross-module-context.test.ts`), so none needs the new method.

## 4. `AssetsLibraryPort`, `ObjectStoragePort`

Unchanged and unfiltered (research R-1, F-11).

## 5. Dependency edges and manifests

| Module | Change | Classification |
| --- | --- | --- |
| `assets_library` | `dependencies` gains `admin_roles`: `permissionService.listPermissions` decides the wildcard (R-3). | `admin_roles` is non-deactivatable, so no `whenAbsent` is owed. |
| `assets_library` | Reads `effectiveState` from `@endora-commerce/platform/kernel`, a published barrel. | Not a port; no edge. |
| `tasks`, `projects`, `crm` | None. `assetReadPort` and `assetReferenceRegistry` are already declared through `dependencies: [... 'assets_library' ...]`, and `permissionService` is already resolved by each. | — |
| `catalog`, `cms`, `blog`, `megamenu` | None. | — |

No module gains or loses an activation control, a permission, a setting, a palette action or an
error code. `check:port-dependencies`, `check:port-catches`, `check:port-shape`,
`check:entry-presence` and `check:module-boundary` are expected clean with no ledger entry.

## 6. Events

None published or consumed. Visibility is evaluated per request, with nothing cached, so there is
nothing to invalidate (research R-5, R-17).
