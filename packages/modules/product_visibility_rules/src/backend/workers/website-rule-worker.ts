import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';
import type { WebsiteRuleJobs } from '../services/website-rule.service.js';

/**
 * The website-rule queue — spec 193 T058, T059 (research R-11; Principle X).
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
/**
 * An evaluation poll that finds the previous one longer ago than this reconciles first (R-15):
 * the module was off (its worker paused, its event subscriber silent) or no worker ran, so
 * changes made meanwhile were never marked.
 */
export const WR_REENABLE_GAP_MS = 4 * WR_EVALUATE_DEBOUNCE_MS;
const LAST_EVALUATION_KEY = 'product_visibility_rules.website_rule:last-evaluation';

const SCOPE_REASON = 'product_visibility_rules: website rule';

export interface WebsiteRuleWork {
  runPreview(previewId: string): Promise<void>;
  applyPreview(previewId: string): Promise<{ applied: number }>;
  evaluateMarked(): Promise<{ evaluated: number; changed: number }>;
  reconcileAll(): Promise<{ changed: number }>;
}

/** When the evaluation poll last ran, across processes. */
export interface EvaluationClock {
  /** Milliseconds since the previous evaluation poll, recording this one; `null` = none recorded. */
  sinceLastEvaluation(): Promise<number | null>;
}

export interface WebsiteRuleProducer extends WebsiteRuleJobs, EvaluationClock {
  close(): Promise<void>;
}

function queueOf(redis: Redis): Queue {
  return new Queue(WEBSITE_RULE_QUEUE, {
    connection: redis,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: 100, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
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
    async sinceLastEvaluation() {
      if (redis === undefined) return null;
      const now = Date.now();
      const previous = await redis.getset(LAST_EVALUATION_KEY, String(now));
      return previous === null ? null : now - Number(previous);
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
  clock: EvaluationClock,
): Promise<void> {
  await enterSystemScope(SCOPE_REASON, async () => {
    if (name === WR_PREVIEW_JOB && data.previewId) return work.runPreview(data.previewId);
    if (name === WR_APPLY_JOB && data.previewId) {
      const { applied } = await work.applyPreview(data.previewId);
      log.info({ previewId: data.previewId, applied }, 'product_visibility_rules: website rule snapshot applied');
      return;
    }
    if (name === WR_EVALUATE_JOB) {
      const gap = await clock.sinceLastEvaluation();
      if (gap === null || gap > WR_REENABLE_GAP_MS) {
        const reconciled = await work.reconcileAll();
        log.info({ gapMs: gap, ...reconciled }, 'product_visibility_rules: website rule reconciled after a pause');
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
  readonly clock: EvaluationClock;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  if (!input.processRunsWorkers || input.moduleQueueRedis === undefined) return false;
  const worker = new Worker(
    WEBSITE_RULE_QUEUE,
    (job: Job<{ previewId?: string }>) => runWebsiteRuleJob(job.name, job.data ?? {}, input.work, input.log, input.clock),
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
