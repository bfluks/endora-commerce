import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { rethrowIfModuleDisabled, type PlatformLogger } from '@endora-commerce/platform/kernel';

import {
  ASSET_RETENTION_SWEEP_LOG_EVENT,
  idleSweepResult,
  type AssetRetentionSweeper,
} from '../jobs/retention-sweeper.js';

export { ASSET_RETENTION_SWEEP_BATCH, ASSET_CLEANUP_GRACE_MS } from '../jobs/retention-sweep-deps.js';

/**
 * The clock for the asset retention sweep — specs/156-asset-stable-url/
 * contracts/storage-and-retention.md §4, research R-13.
 *
 * Soft-deleted assets and replaced files were never purged: the hard-delete
 * worker existed and nothing ran it. This file is the caller, shaped after
 * `quote_requests`' expiry sweep.
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every hour and its job carries no data: what is due is read from the tables
 * on every tick, so a flushed Redis loses a tick and never a purge.
 *
 * **More than one consumer is fine.** Every row is claimed in a transaction of
 * its own, `for update skip locked`, so two worker processes split the work.
 *
 * **No tick enters a system scope** — the one deliberate difference from the
 * expiry sweep. Every table the passes touch belongs to `@GlobalEntity()`
 * classes the tenancy guard does not filter, and the reference checks read
 * with plain SQL, so a scope would buy nothing but an audit row per tick.
 *
 * **One log line per tick, idle ticks included** (FR-035): an operator can tell
 * a sweep that found nothing from a sweep that did not run.
 */

export const ASSET_RETENTION_SWEEP_QUEUE = 'assets_library.retention.sweep';
export const ASSET_RETENTION_SWEEP_SCHEDULER_ID = 'assets_library.retention.sweep';
/** Every hour. */
export const ASSET_RETENTION_SWEEP_EVERY_MS = 60 * 60 * 1000;

export type AssetRetentionSweepJobData = Record<string, never>;

export interface AssetRetentionSweepDeps {
  readonly sweeper: AssetRetentionSweeper;
  readonly log: PlatformLogger;
  /** The tick's clock; tests pin it. */
  readonly now?: () => Date;
}

/**
 * One tick: ask whether anything is due; run the passes when something is,
 * and write the idle line when nothing is.
 *
 * A question that cannot be answered counts as yes. A failed pass is logged
 * and not re-thrown — the next tick is the retry. A module switched off is
 * never absorbed (module-composition item 7).
 */
export async function runAssetRetentionSweepTick(deps: AssetRetentionSweepDeps): Promise<void> {
  const now = deps.now?.() ?? new Date();
  let hasWork = true;
  try {
    hasWork = await deps.sweeper.hasDue(now);
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  try {
    if (!hasWork) {
      const idle = idleSweepResult(await deps.sweeper.retentionDays());
      deps.log.info({ event: ASSET_RETENTION_SWEEP_LOG_EVENT, ...idle }, 'assets_library: retention sweep');
      return;
    }
    // The sweeper writes the tick's line itself.
    await deps.sweeper.sweep(now);
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      { event: ASSET_RETENTION_SWEEP_LOG_EVENT, error: error instanceof Error ? error.message : String(error) },
      'assets_library: the retention sweep failed; the next tick retries',
    );
  }
}

export function createAssetRetentionSweepQueue(
  redis: Redis,
  prefix?: string,
): Queue<AssetRetentionSweepJobData> {
  return new Queue<AssetRetentionSweepJobData>(ASSET_RETENTION_SWEEP_QUEUE, {
    connection: redis,
    ...(prefix !== undefined ? { prefix } : {}),
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

export function buildAssetRetentionSweepWorker(
  deps: AssetRetentionSweepDeps & { readonly redis: Redis; readonly prefix?: string },
): Worker<AssetRetentionSweepJobData> {
  // One tick at a time per process.
  return new Worker<AssetRetentionSweepJobData>(
    ASSET_RETENTION_SWEEP_QUEUE,
    () => runAssetRetentionSweepTick(deps),
    {
      connection: deps.redis,
      concurrency: 1,
      ...(deps.prefix !== undefined ? { prefix: deps.prefix } : {}),
    },
  );
}

/** Install the module-wide schedule. Idempotent by scheduler id. */
export async function ensureAssetRetentionSweepSchedule(
  queue: Pick<Queue<AssetRetentionSweepJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(
    ASSET_RETENTION_SWEEP_SCHEDULER_ID,
    { every: ASSET_RETENTION_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
}

/**
 * Build and start the consumer where the host says this process runs one:
 * only when it consumes queues (`processRunsWorkers`) **and** the composition
 * offers a connection (`moduleQueueRedis`). `attach` is `ctx.worker`, which
 * stops the consumer with the module. Answers whether a consumer was started.
 */
export async function startAssetRetentionSweep(
  input: AssetRetentionSweepDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<AssetRetentionSweepJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
    readonly queuePrefix?: string;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createAssetRetentionSweepQueue(moduleQueueRedis, queuePrefix);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    buildAssetRetentionSweepWorker({
      redis: moduleQueueRedis,
      sweeper: input.sweeper,
      log: input.log,
      ...(queuePrefix !== undefined ? { prefix: queuePrefix } : {}),
    }),
  );
  await ensureAssetRetentionSweepSchedule(queue);
  return true;
}
