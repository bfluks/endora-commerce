// What every pass of the retention sweep needs — specs/156-asset-stable-url/
// contracts/storage-and-retention.md §4.

import type { EntityManager } from '@mikro-orm/postgresql';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';

import type { LegacyAssetResolver } from '../services/storage/legacy-resolver.js';
import type { StorageAdapter, StorageBackendCode } from '../services/storage/storage-adapter.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** At most this many rows per pass per tick (owner ruling P3). */
export const ASSET_RETENTION_SWEEP_BATCH = 500;

/** A cleanup entry is only touched once it is this old, so an in-flight replace is never raced. */
export const ASSET_CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

export interface RetentionSweepDeps {
  emFactory: () => EntityManager;
  adapters: {
    getForBackend(backend: StorageBackendCode): Promise<StorageAdapter | LegacyAssetResolver>;
  };
  referenceRegistry: { findReferences(assetId: string): Promise<readonly unknown[]> };
  /** `assets.soft_delete_retention_days`, at least one day; read once per sweep. */
  loadRetentionDays: () => Promise<number>;
  /** Rows per pass; `ASSET_RETENTION_SWEEP_BATCH` unless a test narrows it. */
  batchSize?: number;
  /** Where the one line per tick goes. */
  log?: Pick<PlatformLogger, 'info'>;
  /**
   * Test seam: runs between selecting a row and claiming it, so a test can
   * commit a competing write in exactly that window. Never set in production.
   */
  beforeClaim?: (assetId: string) => Promise<void>;
}

export function cutoffFor(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/** The adapter's `delete`, or `null` for a backend that stores nothing of ours (legacy). */
export function deleterOf(
  adapter: StorageAdapter | LegacyAssetResolver,
): ((input: { locator: string }) => Promise<void>) | null {
  if ('delete' in adapter && typeof adapter.delete === 'function') {
    return (input) => adapter.delete(input);
  }
  return null;
}
