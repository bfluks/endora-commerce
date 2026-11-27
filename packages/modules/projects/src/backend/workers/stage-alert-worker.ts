import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';
import type { StageAlertService } from '../services/stage-alert-service.js';

/**
 * The clock for Stage deadline alerts (`specs/163-projects-and-tasks/research.md`
 * R-12; Constitution X). CRM's reminder worker is the model
 * (`crm/src/backend/workers/event-reminder-worker.ts`).
 *
 * **BullMQ is the clock and nothing more.** One module-wide Job Scheduler fires
 * every fifteen minutes and its job carries no data: what is due is read from
 * the Stages on every tick, so a flushed Redis loses a tick and never an alert,
 * and a moved deadline, a Stage left or a Project closed has no queue to keep
 * in step. An alert goes out within fifteen minutes of 08:00 local time.
 *
 * **More than one consumer is fine.** An alert is claimed by inserting its
 * delivery row under a unique key before it is delivered, so two worker
 * processes ticking at once claim each alert once.
 *
 * The interval is a constant, not a setting: alerts are daily, and a tick with
 * nothing due is no statement at all before 08:00 and one statement after it.
 */

export const STAGE_ALERT_QUEUE = 'projects-stage-alerts';
export const STAGE_ALERT_SCHEDULER_ID = 'projects-stage-alerts';
/** Every fifteen minutes. */
export const STAGE_ALERT_EVERY_MS = 15 * 60_000;

export type StageAlertJobData = Record<string, never>;

export const STAGE_ALERT_SCOPE_REASON = 'projects: deliver due stage deadline alerts';

export interface StageAlertTickDeps {
  readonly alerts: Pick<StageAlertService, 'sweep'>;
  /** Whether this module is present — the platform's one answer, on both axes. */
  readonly isPresent: () => boolean;
  readonly log: PlatformLogger;
}

/**
 * The body of one tick: one pass of the sweep.
 *
 * **Presence is decided first, outside the `try`** (Constitution XVII): the
 * consumer stops with the module because it is attached through the platform's
 * worker seam, and this is the same question asked once more by the work
 * itself, for the tick already in hand when the module was switched off. A
 * module that is off alerts nobody and claims nothing.
 *
 * A failed pass is logged and **not** re-thrown: the next tick is the retry.
 * A module switched off underneath a delivery is the exception.
 */
export function stageAlertTick(deps: StageAlertTickDeps): () => Promise<void> {
  return async () => {
    if (!deps.isPresent()) return;
    try {
      await deps.alerts.sweep();
    } catch (error) {
      rethrowIfModuleDisabled(error);
      deps.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'projects: a pass over the due stage deadline alerts failed; the next tick retries',
      );
    }
  };
}

export interface StageAlertJobDeps {
  /** One pass, run inside the system scope — {@link stageAlertTick}. */
  readonly tick: () => Promise<void>;
  /** Whether this module is present — asked before anything is read. */
  readonly isPresent: () => boolean;
  /** Whether a pass would do anything: yes or no, and nothing else. */
  readonly hasWork: () => Promise<boolean>;
}

/**
 * What BullMQ invokes for one job: ask whether a pass has anything to do, and
 * open the system scope only when it has (issue #120) — entering the scope is
 * what writes the `tenant.escape_hatch` audit record, and ninety-six ticks a
 * day with nothing due must write none.
 *
 * **Presence first.** A module that is off asks its tables nothing. **A
 * question that cannot be answered counts as yes**: a failing probe may cost an
 * audit row, and can never cost an alert.
 */
export async function runStageAlertJob(deps: StageAlertJobDeps): Promise<void> {
  if (!deps.isPresent()) return;
  let hasWork = true;
  try {
    hasWork = await deps.hasWork();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    hasWork = true;
  }
  if (!hasWork) return;
  // There is no request behind a tick, and the pass is platform-wide by design.
  await enterSystemScope(STAGE_ALERT_SCOPE_REASON, deps.tick);
}

export function createStageAlertQueue(redis: Redis): Queue<StageAlertJobData> {
  return new Queue<StageAlertJobData>(STAGE_ALERT_QUEUE, {
    connection: redis,
    // A tick is worth nothing once it has run: a short tail, and no history beyond it.
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
}

/** Install the module-wide schedule. Idempotent by scheduler id, so safe on every boot of every worker process. */
export async function ensureStageAlertSchedule(
  queue: Pick<Queue<StageAlertJobData>, 'upsertJobScheduler'>,
): Promise<void> {
  await queue.upsertJobScheduler(STAGE_ALERT_SCHEDULER_ID, { every: STAGE_ALERT_EVERY_MS }, { name: 'sweep', data: {} });
}

/**
 * Build and start the consumer — where the host says this process runs one
 * (`processRunsWorkers`) **and** offers a connection to build it on
 * (`moduleQueueRedis`). The shared test server says neither, builds nothing,
 * and its tests drive the sweep and the tick directly.
 *
 * `attach` is the platform's worker seam — `ctx.worker` — which puts the
 * consumer in the registry the platform reconciles and stops with the module;
 * `onClose` registers the queue's own shutdown. Answers whether a consumer was
 * started.
 */
export async function startStageAlerts(
  input: StageAlertJobDeps & {
    readonly processRunsWorkers: boolean;
    readonly moduleQueueRedis: Redis | undefined;
    readonly attach: (worker: Worker<StageAlertJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
  },
): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const queue = createStageAlertQueue(moduleQueueRedis);
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    // One tick at a time per process: a second concurrent pass would only find the first's claims.
    new Worker<StageAlertJobData>(STAGE_ALERT_QUEUE, () => runStageAlertJob(input), {
      connection: moduleQueueRedis,
      concurrency: 1,
    }),
  );
  await ensureStageAlertSchedule(queue);
  return true;
}
