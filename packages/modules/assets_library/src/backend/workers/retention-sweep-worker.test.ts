import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';

import {
  ASSET_RETENTION_SWEEP_BATCH,
  ASSET_RETENTION_SWEEP_EVERY_MS,
  ASSET_RETENTION_SWEEP_QUEUE,
  ASSET_RETENTION_SWEEP_SCHEDULER_ID,
  ensureAssetRetentionSweepSchedule,
  runAssetRetentionSweepTick,
  startAssetRetentionSweep,
} from './retention-sweep-worker.js';
import type { AssetRetentionSweepResult } from '../jobs/retention-sweeper.js';

// specs/156-asset-stable-url/ T043 — the clock of the retention sweep, in the
// shape of quote_requests' expiry sweep worker test.

const kernel = vi.hoisted(() => ({ enterSystemScope: vi.fn() }));
vi.mock('@endora-commerce/platform/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@endora-commerce/platform/kernel')>();
  kernel.enterSystemScope.mockImplementation(actual.enterSystemScope);
  return { ...actual, enterSystemScope: kernel.enterSystemScope };
});

const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown>; options: Record<string, unknown> }>,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly close = vi.fn(async () => undefined);
    constructor(readonly name: string) {
      bull.queues.push(this);
    }
  },
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: () => Promise<unknown>,
      readonly options: Record<string, unknown>,
    ) {
      bull.workers.push(this);
    }
  },
}));

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as never as {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

const busy: AssetRetentionSweepResult = {
  retentionDays: 7,
  previousPurged: 1,
  hardDeleted: 2,
  pendingCleanup: 0,
  cleanupsDone: 3,
  skippedReferenced: 0,
  skippedNotDue: 0,
  dueRemaining: 0,
};

function sweeper(overrides: Partial<{ hasDue: () => Promise<boolean>; sweep: () => Promise<AssetRetentionSweepResult> }> = {}) {
  return {
    hasDue: vi.fn(overrides.hasDue ?? (async () => false)),
    retentionDays: vi.fn(async () => 7),
    sweep: vi.fn(overrides.sweep ?? (async () => busy)),
  };
}

describe('assets_library retention sweep worker', () => {
  it('names a queue BullMQ accepts, fires hourly and sweeps at most 500 rows per pass', () => {
    expect(ASSET_RETENTION_SWEEP_QUEUE).toBe('assets_library.retention.sweep');
    expect(ASSET_RETENTION_SWEEP_QUEUE).not.toContain(':');
    expect(ASSET_RETENTION_SWEEP_EVERY_MS).toBe(3_600_000);
    expect(ASSET_RETENTION_SWEEP_BATCH).toBe(500);
  });

  it('installs one module-wide scheduler whose job carries no data', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureAssetRetentionSweepSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler.mock.calls).toEqual([
      [ASSET_RETENTION_SWEEP_SCHEDULER_ID, { every: 3_600_000 }, { name: 'sweep', data: {} }],
    ]);
    expect(ASSET_RETENTION_SWEEP_SCHEDULER_ID).toBe('assets_library.retention.sweep');
  });

  it('starts one consumer through the seam, one tick at a time, only where the process consumes queues', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const none = await startAssetRetentionSweep({
      sweeper: sweeper(),
      log: logger() as never,
      processRunsWorkers: false,
      moduleQueueRedis: {} as never,
      attach,
      onClose: vi.fn(),
    });
    expect(none).toBe(false);
    expect(attach).not.toHaveBeenCalled();

    const started = await startAssetRetentionSweep({
      sweeper: sweeper(),
      log: logger() as never,
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: vi.fn(),
    });
    expect(started).toBe(true);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledTimes(1);
  });

  describe('one tick', () => {
    it('idle: runs no pass and still writes one line with zero counts and the retention read', async () => {
      const log = logger();
      const s = sweeper();
      await runAssetRetentionSweepTick({ sweeper: s, log: log as never });
      expect(s.sweep).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalledTimes(1);
      expect(log.info.mock.calls[0]?.[0]).toEqual({
        event: 'assets_library.retention.sweep',
        retentionDays: 7,
        previousPurged: 0,
        hardDeleted: 0,
        pendingCleanup: 0,
        cleanupsDone: 0,
        skippedReferenced: 0,
        skippedNotDue: 0,
        dueRemaining: 0,
      });
    });

    it('busy: runs the sweep without entering a system scope', async () => {
      kernel.enterSystemScope.mockClear();
      const s = sweeper({ hasDue: async () => true });
      await runAssetRetentionSweepTick({ sweeper: s, log: logger() as never });
      expect(s.sweep).toHaveBeenCalledTimes(1);
      expect(kernel.enterSystemScope).not.toHaveBeenCalled();
    });

    it('a question that cannot be answered counts as due', async () => {
      const s = sweeper({
        hasDue: async () => {
          throw new Error('could not read');
        },
      });
      await runAssetRetentionSweepTick({ sweeper: s, log: logger() as never });
      expect(s.sweep).toHaveBeenCalledTimes(1);
    });

    it('a failed pass is logged and swallowed — the next tick is the retry', async () => {
      const log = logger();
      const s = sweeper({
        hasDue: async () => true,
        sweep: async () => {
          throw new Error('database went away');
        },
      });
      await expect(runAssetRetentionSweepTick({ sweeper: s, log: log as never })).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('a module switched off underneath the pass is re-thrown', async () => {
      const s = sweeper({
        hasDue: async () => true,
        sweep: async () => {
          throw new ModuleDisabledError('assets_library');
        },
      });
      await expect(runAssetRetentionSweepTick({ sweeper: s, log: logger() as never })).rejects.toBeInstanceOf(
        ModuleDisabledError,
      );
    });
  });
});
