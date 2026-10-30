import { describe, expect, it, vi } from 'vitest';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { registerModule } from './index.js';
import {
  ASSET_RETENTION_SWEEP_EVERY_MS,
  ASSET_RETENTION_SWEEP_QUEUE,
  ASSET_RETENTION_SWEEP_SCHEDULER_ID,
} from './workers/retention-sweep-worker.js';

/**
 * The retention sweep has a caller — specs/156-asset-stable-url/ T044, after
 * `quote_requests/src/backend/expiry-sweep-is-scheduled.test.ts`.
 *
 * The hard-delete worker existed and nothing ran it. This composes the module
 * **as `registerModule` composes it**, against a recording context, and holds
 * the two facts that make a schedule: a consumer of the sweep's queue handed to
 * `ctx.worker`, and the Job Scheduler installed on that queue.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{ name: string; upsertJobScheduler: ReturnType<typeof vi.fn> }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown> }>,
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
    ) {
      bull.workers.push(this);
    }
  },
}));

function registration(): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const option of ['singleton', 'scoped', 'transient', 'disposer']) self[option] = () => self;
  return self;
}

async function composeAndMountRoutes(host: { processRunsWorkers: boolean; moduleQueueRedis: unknown }) {
  bull.queues.length = 0;
  bull.workers.length = 0;
  const routes: Array<(app: unknown) => Promise<void>> = [];
  const attached: unknown[] = [];
  const hasDue = vi.fn(async () => false);
  const cradle = {
    ...host,
    assetsLibrary: {
      plugin: async () => undefined,
      handle: { sweeper: { hasDue, retentionDays: async () => 30, sweep: vi.fn() } },
    },
  };
  const noop = (): void => undefined;
  const ctx = {
    asFunction: registration,
    asValue: registration,
    di: { providePort: noop, register: noop },
    subscribe: noop,
    onBoot: noop,
    routes: (mount: (app: unknown) => Promise<void>) => {
      routes.push(mount);
    },
    worker: (worker: unknown) => {
      attached.push(worker);
    },
    cradle: () => cradle,
    log: { info: noop, warn: noop, error: noop, debug: noop },
  } as unknown as ModuleContext;

  registerModule(ctx);
  const app = { log: {}, addHook: noop };
  for (const mount of routes) await mount(app);
  return { attached, hasDue };
}

describe('assets_library — the retention sweep is scheduled by the module’s own composition', () => {
  it('in a process that consumes queues: a consumer reaches ctx.worker and the scheduler is installed', async () => {
    const { attached, hasDue } = await composeAndMountRoutes({ processRunsWorkers: true, moduleQueueRedis: {} });
    expect(bull.workers.map((worker) => worker.name)).toEqual([ASSET_RETENTION_SWEEP_QUEUE]);
    expect(attached).toEqual([bull.workers[0]]);
    expect(bull.queues.map((queue) => queue.name)).toEqual([ASSET_RETENTION_SWEEP_QUEUE]);
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledWith(
      ASSET_RETENTION_SWEEP_SCHEDULER_ID,
      { every: ASSET_RETENTION_SWEEP_EVERY_MS },
      { name: 'sweep', data: {} },
    );
    // What the consumer runs is the composed module's own sweeper.
    await bull.workers[0]?.processor();
    expect(hasDue).toHaveBeenCalledTimes(1);
  });

  it('in a process that consumes none: no consumer and no scheduler', async () => {
    const { attached } = await composeAndMountRoutes({ processRunsWorkers: false, moduleQueueRedis: undefined });
    expect(attached).toEqual([]);
    expect(bull.workers).toEqual([]);
    expect(bull.queues).toEqual([]);
  });
});
