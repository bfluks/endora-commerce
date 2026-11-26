import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';
import type { WebsiteRuleJobs } from '../services/website-rule.service.js';

/**
 * The website-rule queue (research R-11; Principle X).
 *
 * - `preview` / `apply` — one job per preview id (deduplicated by id): evaluate a preview, write
 *   a confirmed snapshot. The apply job deletes each batch's rows with its batch, so a retry
 *   continues where it stopped.
 * - `evaluate` — the steady state: marked products on every governed channel. Debounced by a
 *   fixed job id and a 30 s delay, and also polled every 30 s, so a lost request costs at most one
 *   period (R-11).
 * - `reconcile` — every governed channel against every product, hourly and at each window
 *   boundary of a designated book; it also finishes unapplied snapshots and sweeps expired
 *   previews.
 *
 * Attached with `ctx.worker`, so it stops with the module (Principle XVII): while off, jobs wait
 * and memberships stay as last computed (FR-073). Built only where the host consumes queues.
 */

export const WEBSITE_RULE_QUEUE = 'product_visibility_rules.website_rule';
export const WR_PREVIEW_JOB = 'preview';
export const WR_APPLY_JOB = 'apply';
export const WR_EVALUATE_JOB = 'evaluate';
export const WR_RECONCILE_JOB = 'reconcile';
export const WR_EVALUATE_DEBOUNCE_MS = 30_000;
export const WR_RECONCILE_PATTERN = '41 * * * *';
/** Bumped by every process that sees the module's presence change (see {@link recordPresenceTransitions}). */
const PRESENCE_EPOCH_KEY = 'product_visibility_rules.website_rule:presence-epoch';
/** The presence epoch the last reconcile-after-a-change ran at. */
const RECONCILED_EPOCH_KEY = 'product_visibility_rules.website_rule:reconciled-epoch';

const SCOPE_REASON = 'product_visibility_rules: website rule';

export interface WebsiteRuleWork {
  runPreview(previewId: string): Promise<void>;
  applyPreview(previewId: string): Promise<{ applied: number }>;
  evaluateMarked(): Promise<{ evaluated: number; changed: number }>;
  reconcileAll(): Promise<{ changed: number }>;
}

/**
 * Whether the module's presence changed since the last reconcile, across processes (R-15). While
 * off, the catalogue-event subscriber is silent in every process that sees it off, so changes made
 * meanwhile were never marked; each such process bumps the epoch, and the next evaluation poll
 * reconciles. A worker that merely stalled sees no new epoch.
 */
export interface PresenceEpochs {
  /** The current epoch; `'0'` before any process recorded a change. */
  presenceEpoch(): Promise<string>;
  /** The epoch the last reconcile after a change ran at; `null` = never (or no store). */
  reconciledEpoch(): Promise<string | null>;
  markReconciled(epoch: string): Promise<void>;
  bumpPresenceEpoch(): Promise<void>;
}

/** Presence epochs in Redis; without a connection there is no record, so every poll reconciles. */
export function createPresenceEpochs(redis: Redis | undefined): PresenceEpochs {
  return {
    async presenceEpoch() {
      return (await redis?.get(PRESENCE_EPOCH_KEY)) ?? '0';
    },
    async reconciledEpoch() {
      return (await redis?.get(RECONCILED_EPOCH_KEY)) ?? null;
    },
    async markReconciled(epoch) {
      await redis?.set(RECONCILED_EPOCH_KEY, epoch);
    },
    async bumpPresenceEpoch() {
      await redis?.incr(PRESENCE_EPOCH_KEY);
    },
  };
}

export interface WebsiteRuleProducer extends WebsiteRuleJobs {
  close(): Promise<void>;
}

/**
 * Record, in this process, every change of the module's presence by bumping the shared epoch. A
 * gated subscriber drops work only in a process whose installed presence says absent, and this
 * listener sees every install into that same state, so a process that never installed "absent"
 * dropped nothing. Both directions bump: a process that comes back on after the worker already
 * reconciled may have dropped marks until then. A process that starts while the module is off
 * bumps at once. A failed bump stays owed and is retried on the next install (installs are
 * level-triggered). Answers the unsubscribe.
 */
export function recordPresenceTransitions(input: {
  readonly isPresent: () => boolean;
  readonly onPresenceInstalled: (listener: () => void) => () => void;
  readonly bump: () => Promise<void>;
  readonly log: PlatformLogger;
}): () => void {
  let last = input.isPresent();
  let owed = last ? 0 : 1;
  let writing = false;
  const flush = (): void => {
    if (owed === 0 || writing) return;
    const paying = owed;
    writing = true;
    input.bump().then(
      () => {
        owed -= paying;
        writing = false;
        flush();
      },
      (err: unknown) => {
        writing = false;
        input.log.warn({ err }, 'product_visibility_rules: could not record a presence change; retried on the next presence install');
      },
    );
  };
  const unsubscribe = input.onPresenceInstalled(() => {
    const present = input.isPresent();
    if (present !== last) owed += 1;
    last = present;
    flush();
  });
  flush();
  return unsubscribe;
}

function queueOf(redis: Redis): Queue {
  return new Queue(WEBSITE_RULE_QUEUE, {
    connection: redis,
    // Fixed job ids (`evaluate`, one per preview) must be free again once a job is done or failed,
    // or a failed one would swallow every later request under the same id.
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
  });
}

/** Without a queue connection (a bare harness) nothing is enqueued; the hourly reconcile catches up. */
export function createWebsiteRuleProducer(redis: Redis | undefined): WebsiteRuleProducer {
  let queue: Queue | undefined;
  const q = (): Queue | undefined => (redis === undefined ? undefined : (queue ??= queueOf(redis)));
  return {
    async enqueuePreview(previewId) {
      await q()?.add(WR_PREVIEW_JOB, { previewId }, { jobId: `${WR_PREVIEW_JOB}-${previewId}` });
    },
    async enqueueApply(previewId) {
      await q()?.add(WR_APPLY_JOB, { previewId }, { jobId: `${WR_APPLY_JOB}-${previewId}` });
    },
    async enqueueEvaluate() {
      await q()?.add(WR_EVALUATE_JOB, {}, { jobId: WR_EVALUATE_JOB, delay: WR_EVALUATE_DEBOUNCE_MS });
    },
    async enqueueReconcileAt(at, key) {
      const delay = Math.max(0, at.getTime() - Date.now());
      await q()?.add(WR_RECONCILE_JOB, {}, { jobId: `window-${key.replace(/[^A-Za-z0-9_.-]/g, '_')}`, delay });
    },
    async close() {
      await queue?.close();
      queue = undefined;
    },
  };
}

/** What one job does, by its name — exported for the tests, which run it without a queue. */
export async function runWebsiteRuleJob(
  name: string,
  data: { previewId?: string },
  work: WebsiteRuleWork,
  log: PlatformLogger,
  epochs: PresenceEpochs,
): Promise<void> {
  await enterSystemScope(SCOPE_REASON, async () => {
    if (name === WR_PREVIEW_JOB && data.previewId) return work.runPreview(data.previewId);
    if (name === WR_APPLY_JOB && data.previewId) {
      const { applied } = await work.applyPreview(data.previewId);
      log.info({ previewId: data.previewId, applied }, 'product_visibility_rules: website rule snapshot applied');
      return;
    }
    if (name === WR_EVALUATE_JOB) {
      // Read before the reconcile and stored after it: a change recorded meanwhile moves the
      // epoch past the stored one, and a failed reconcile stores nothing, so the next poll retries.
      const epoch = await epochs.presenceEpoch();
      if ((await epochs.reconciledEpoch()) !== epoch) {
        const reconciled = await work.reconcileAll();
        await epochs.markReconciled(epoch);
        log.info({ presenceEpoch: epoch, ...reconciled }, 'product_visibility_rules: website rule reconciled after the module was switched off or on');
      }
      const result = await work.evaluateMarked();
      if (result.changed > 0) log.info(result, 'product_visibility_rules: website rule re-evaluated marked products');
      return;
    }
    if (name === WR_RECONCILE_JOB) {
      const result = await work.reconcileAll();
      if (result.changed > 0) log.info(result, 'product_visibility_rules: website rule reconcile changed memberships');
    }
  });
}

export async function startWebsiteRuleWorker(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly work: WebsiteRuleWork;
  readonly epochs: PresenceEpochs;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  if (!input.processRunsWorkers || input.moduleQueueRedis === undefined) return false;
  const worker = new Worker(
    WEBSITE_RULE_QUEUE,
    (job: Job<{ previewId?: string }>) => runWebsiteRuleJob(job.name, job.data ?? {}, input.work, input.log, input.epochs),
    { connection: input.moduleQueueRedis, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    input.log.error(
      { err, job: job?.name, jobId: job?.id, attemptsMade: job?.attemptsMade },
      'product_visibility_rules: website rule job failed; the hourly reconcile catches up',
    );
  });
  input.attach(worker);
  const schedules = queueOf(input.moduleQueueRedis);
  input.onClose(() => schedules.close());
  await schedules.upsertJobScheduler('evaluate-poll', { every: WR_EVALUATE_DEBOUNCE_MS }, { name: WR_EVALUATE_JOB, data: {} });
  await schedules.upsertJobScheduler('hourly-reconcile', { pattern: WR_RECONCILE_PATTERN }, { name: WR_RECONCILE_JOB, data: {} });
  return true;
}
