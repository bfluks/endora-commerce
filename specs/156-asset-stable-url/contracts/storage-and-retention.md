# Contract: storage adapter SPI, the replace sequence, the cleanup ledger and the retention sweep

All in `packages/modules/assets_library/src/backend/` — module-internal TypeScript, never serialised
(`services/storage/storage-adapter.ts:7-8`), so nothing here goes to `contracts`.

## 1. SPI additions (`services/storage/storage-adapter.ts`)

```ts
export interface StoragePutInput {
  // existing: locator, mimeType, visibility, stream, sizeBytes
  /** New, optional: written as object metadata on cloud; ignored on local. */
  cacheControl?: string;
  contentDisposition?: string;
}

export interface StorageCopyInput {
  from: string;
  to: string;
  /** ACL of the destination on cloud — always sent explicitly; ignored on local. */
  visibility: AssetVisibility;
  mimeType: string;
  cacheControl?: string;
  contentDisposition?: string;
}

export interface StorageAdapter {
  // existing members unchanged
  /**
   * Server-side copy, atomic at the destination: a reader of `to` sees the old object or the
   * new one, never a partial one. Overwrites `to`. MUST throw when the copy cannot be confirmed.
   * local: copyFile to `<to>.tmp-<pid>-<n>` then rename; s3: CopyObject with
   * MetadataDirective REPLACE, ACL, ContentType, CacheControl, ContentDisposition;
   * gcs: file.copy(dest, { predefinedAcl, metadata }).
   */
  copy(input: StorageCopyInput): Promise<void>;
}
```

`delete` keeps its contract (throws when removal cannot be confirmed); the cleanup pass treats the
adapter's not-found answer as success (local `ENOENT`, GCS `404`; S3 `DeleteObject` is already
idempotent). `LegacyResolver` gains no `copy`; replace refuses `legacy` before reaching it.

Locator helpers (`services/storage/locator.ts`), pure:

```ts
/** `<dir>/<assetId>.<tag>-<32 hex>.<ext>` beside the stable key; keeps parseAssetIdFromLocator valid. */
export function siblingLocator(stableLocator: string, tag: 'stage' | 'prev', filename: string,
  random?: () => string /* default: randomBytes(16).toString('hex') */): string;
/** Lower-cased extension when it matches [a-z0-9]{1,10}; `bin` otherwise. */
export function safeKeyExtension(filename: string): string;
```

`computeLocator` (stable keys) is unchanged.

## 2. The replace / restore sequence (research R-1, R-3, R-21)

```text
service.replace(assetId, file, expectedContentVersion?, actor)
  a  = read row (no lock); refuse 404 / 410 soft-deleted / 409 legacy
  cv0 = expectedContentVersion ?? a.contentVersion
  adapter = registry.getForBackend(a.storageBackend)          // never getActive(); 503 when unconfigured
  stage = siblingLocator(a.storageLocator, 'stage', file.filename)
  prevNew = siblingLocator(a.storageLocator, 'prev', a.filename)
  ledger.record([{ stage, 'staging' }, { prevNew, 'previous' }])          // own short transaction
  try:
    { storedMime, detectedMime, sizeBytes } = pipeline.stage({ adapter, locator: stage, …,
        sizeCapBytes: a.storageBackend === 's3' ? 5 GiB : undefined })     // FR-003, R-4, R-1 ceiling
    replacementKind(a.kind, detectedMime, storedMime) → 415 ASSET_REPLACE_KIND_MISMATCH   // R-5
    commandBus.run(asset.replace):
      row = em.findOne(Asset, id, { lockMode: PESSIMISTIC_WRITE })
      row.contentVersion ≠ cv0 → 409 ASSET_REPLACE_CONFLICT
      adapter.copy(stable → prevNew, visibility: private, old MIME, cloudContentDisposition(old))
      adapter.copy(stage → stable, visibility: row.visibility, storedMime, no-cache,
                   cloudContentDisposition(storedMime, file.filename))
      oldPrev = row.previousStorageLocator
      row ← new metadata; previous_* ← demoted metadata (locator = prevNew), replaced_at = now, replaced_by = actor
      ledger.clear(prevNew) ; if oldPrev: ledger.record(oldPrev, 'superseded')     // same transaction
      return { before, after }
    on throw after the stable copy:
      adapter.copy(prevNew → stable, visibility: row.visibility, old MIME, no-cache, old disposition)
      adapter.delete(prevNew); ledger.clear(prevNew)            // a failure here leaves the entry
  finally:
    adapter.delete(stage); ledger.clear(stage)                  // best effort; entry stays on failure
  after commit: if oldPrev: adapter.delete(oldPrev); ledger.clear(oldPrev)   // entry stays on failure
```

Restore is the same with no staging step, the copy source `row.previousStorageLocator`, both
`expectedContentVersion` and `expectedPreviousContentVersion` compared under the lock, and no kind
check.

## 3. Settings (`services/storage/settings-view.ts`)

`softDeleteRetentionDays()` (master, `:43-46`) changes its clamp: a finite non-negative value `n`
answers `max(1, n)`; missing, negative or non-finite answers 30 (owner ruling P3). It stays on the
intersection type `createSettingsView` returns — it is not added to `AdapterSettingsView`, so no
adapter-settings stub changes. `plugin.ts` already builds `loadRetentionDays` from it; this feature
passes the same function to `AssetReadService`, the sweeper and `detail()`.

Readers: `softDelete` and the recursive folder delete (master), the reported purge date (`DELETE
/:id`'s `purgeAfterAt`, `AssetRecord.purgeAfterAt` — both `deletedAt + retention`, P1),
`previousVersion.restorableUntil`, and the sweep, once at the start of each tick.

## 4. The retention sweep (`workers/retention-sweep-worker.ts`, research R-13, R-21)

```ts
export const ASSET_RETENTION_SWEEP_QUEUE = 'assets_library.retention.sweep';
export const ASSET_RETENTION_SWEEP_SCHEDULER_ID = 'assets_library.retention.sweep';
export const ASSET_RETENTION_SWEEP_EVERY_MS = 60 * 60 * 1000;
export const ASSET_RETENTION_SWEEP_BATCH = 500;
export const ASSET_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

export interface AssetRetentionSweepResult {
  retentionDays: number;
  previousPurged: number;
  hardDeleted: number;
  pendingCleanup: number;
  cleanupsDone: number;
  skippedReferenced: number;
  skippedNotDue: number;
  /** Due soft-deleted assets left for later ticks (FR-035). */
  dueRemaining: number;
}

export interface AssetRetentionSweeper {
  /** One cheap boolean: is anything due? Errors count as "yes". */
  hasDue(now?: Date): Promise<boolean>;
  sweep(now?: Date): Promise<AssetRetentionSweepResult>;
}

export function startAssetRetentionSweep(input: {
  processRunsWorkers: boolean;
  moduleQueueRedis: Redis | undefined;
  sweeper: AssetRetentionSweeper;
  log: PlatformLogger;
  attach: (worker: Worker) => void;      // ctx.worker
  onClose: (close: () => Promise<void>) => void;
  queuePrefix?: string;
}): Promise<boolean>;
```

Shape copied from `packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts`,
with one deliberate difference: **no tick enters a system scope** — `Asset`, `AssetPermalinkRelease`
and `AssetObjectCleanup` are `@GlobalEntity()`, which the tenancy guard does not filter (tasks.md
T041 proves it against the real guard). Each pass carries a `command-coverage-ignore` comment: a
retention purge executes a window an audited write already committed.

`sweep(now)` reads `retentionDays` once, then runs the passes, **each** bounded by
`ASSET_RETENTION_SWEEP_BATCH` rows and counted separately (FR-035); each row is claimed in its own
transaction with `for update skip locked` and re-checked under the lock:

1. **Previous versions** — select `previous_replaced_at <= now − retention`. Under the lock: re-check
   due and that `previous_storage_locator` is the selected one, else `skippedNotDue`; record a
   `purge` cleanup entry and `clearPreviousVersion(row)`; commit. Then delete the object and clear the
   entry; a failure leaves the entry for pass 4.
2. **Soft-deleted** — `HardDeleteAssetWorker.sweep`, predicate changed from `purge_after_at <= now` to
   `deleted_at <= now − retention` and `pending_cleanup = false`, ordered by `deleted_at` ascending
   (oldest deletion first); after the pass, one count of the due rows left gives `dueRemaining`. Under the lock: re-check
   `deleted_at` set and due (`skippedNotDue`), re-check `referenceRegistry.findReferences(id)` is
   empty (`skippedReferenced`, row untouched); clear the previous version as in pass 1; delete the
   stable object; success removes the row and upserts `asset_permalink_releases` (`reason = 'purged'`)
   when it had a permalink; failure sets `pending_cleanup = true` (FR-032).
3. **Pending** — `HardDeleteAssetWorker.sweepPending`, same lock, re-checks and extension.
4. **Cleanups** — entries with `recorded_at <= now − 24 h`; skip an entry whose locator equals some
   row's `storage_locator` or `previous_storage_locator` on the same backend; delete the object
   (not-found = done) and the entry; failure → `attempts + 1`, `last_error`.

After the passes, one `log.info({ event: 'assets_library.retention.sweep', ...result })` line per
tick. An idle tick (`hasDue` false) runs no pass and still writes the line, with zero counts and the
retention it read (FR-035: "written whether or not anything was due").

`registerModule` (`backend/index.ts`) starts it inside `ctx.routes`, as `quote_requests` does
(`quote_requests/src/backend/index.ts:722-748`), with the cradle's `processRunsWorkers` and
`moduleQueueRedis`. The consumer is a separable entrypoint (a `BACKEND_ROLE=worker` process runs it).
