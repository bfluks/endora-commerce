import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { enterSystemScope, type PlatformLogger } from '@endora-commerce/platform/kernel';

/**
 * The catalogue-price flags queue (research R-5, R-6; threat model TM-12,
 * TM-7 (5); Principle X).
 *
 * Three kinds of job, one consumer at a time:
 *
 * - `pass` — rebuild every currency that asks for it, then refresh every mark. One **fixed job
 *   id**, so a burst of requests costs one waiting job (TM-12: one running plus one queued); the
 *   requests themselves are durable rows, and a pass that completes asks for a follow-up while
 *   work is pending, so nothing asked during a running pass is lost.
 * - `drift-poll` — every two minutes: give every active currency its generation row (the
 * first-enable bootstrap) and compare `price_lists`' change watermark (TM-7 (5)).
 * - `nightly-reconcile` — the last resort: a whole rebuild of every tracked currency.
 *
 * Attached with `ctx.worker`, so it stops with the module (Principle XVII) and a job taken while
 * the module is off waits; built only where the host says this process consumes queues.
 */

export const FLAGS_QUEUE = 'product_visibility_rules.flags';
export const FLAGS_PASS_JOB = 'pass';
export const FLAGS_DRIFT_POLL_JOB = 'drift-poll';
export const FLAGS_NIGHTLY_JOB = 'nightly-reconcile';
export const FLAGS_DRIFT_POLL_EVERY_MS = 2 * 60_000;
export const FLAGS_NIGHTLY_PATTERN = '17 3 * * *';

const SCOPE_REASON = 'product_visibility_rules: catalogue-price flags';

export interface FlagsWork {
  runPass(): Promise<{ rebuilt: string[]; refreshed: number }>;
  hasPendingWork(): Promise<boolean>;
  ensureActiveCurrencies(): Promise<string[]>;
  driftPoll(): Promise<boolean>;
  trackedCurrencies(): Promise<string[]>;
  requestRebuild(currencyCodes: readonly string[]): Promise<void>;
}

export interface FlagsProducer {
  /** Ask for one pass; coalesced while one is waiting. Answers whether a job was enqueued. */
  enqueuePass(): Promise<boolean>;
  close(): Promise<void>;
}

function queueOf(redis: Redis): Queue {
  return new Queue(FLAGS_QUEUE, {
    connection: redis,
    // The fixed id must be free again once a job is done, or it would swallow every later request.
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 3, backoff: { type: 'exponential', delay: 2_000 } },
  });
}

export function createFlagsProducer(redis: Redis | undefined): FlagsProducer {
  let queue: Queue | undefined;
  return {
    async enqueuePass() {
      if (redis === undefined) return false;
      queue ??= queueOf(redis);
      await queue.add(FLAGS_PASS_JOB, {}, { jobId: FLAGS_PASS_JOB });
      return true;
    },
    async close() {
      await queue?.close();
      queue = undefined;
    },
  };
}

/** What one job does, by its name — exported for the tests, which run it without a queue. */
export async function runFlagsJob(name: string, work: FlagsWork, log: PlatformLogger): Promise<void> {
  await enterSystemScope(SCOPE_REASON, async () => {
    if (name === FLAGS_DRIFT_POLL_JOB) {
      const added = await work.ensureActiveCurrencies();
      const drifted = await work.driftPoll();
      if (added.length > 0 || drifted) log.info({ added, drifted }, 'product_visibility_rules: flag rebuild asked by the drift poll');
      return;
    }
    if (name === FLAGS_NIGHTLY_JOB) {
      await work.requestRebuild(await work.trackedCurrencies());
      return;
    }
    const { rebuilt, refreshed } = await work.runPass();
    if (rebuilt.length > 0 || refreshed > 0) log.info({ rebuilt, refreshed }, 'product_visibility_rules: catalogue-price flags refreshed');
  });
}

export async function startFlagsWorker(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly work: FlagsWork;
  readonly producer: FlagsProducer;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker) => void;
  readonly onClose: (close: () => Promise<void>) => void;
}): Promise<boolean> {
  if (!input.processRunsWorkers || input.moduleQueueRedis === undefined) return false;
  const worker = new Worker(FLAGS_QUEUE, (job: Job) => runFlagsJob(job.name, input.work, input.log), {
    connection: input.moduleQueueRedis,
    concurrency: 1,
  });
  worker.on('completed', (job) => {
    if (worker.closing !== undefined) return;
    // Any job may leave work behind: a request made while it ran, or what the poll asked for.
    enterSystemScope(SCOPE_REASON, async () => {
      if (await input.work.hasPendingWork()) await input.producer.enqueuePass();
    }).catch((err: unknown) => {
      input.log.error({ err, job: job.name }, 'product_visibility_rules: flags follow-up check failed; the drift poll asks again');
    });
  });
  worker.on('failed', (job, err) => {
    input.log.error(
      { err, job: job?.name, attemptsMade: job?.attemptsMade },
      'product_visibility_rules: catalogue-price flags job failed; its requests are kept for the next pass',
    );
  });
  input.attach(worker);
  const schedules = queueOf(input.moduleQueueRedis);
  input.onClose(() => schedules.close());
  // Idempotent by scheduler id: every worker process installs the same two.
  await schedules.upsertJobScheduler(FLAGS_DRIFT_POLL_JOB, { every: FLAGS_DRIFT_POLL_EVERY_MS }, { name: FLAGS_DRIFT_POLL_JOB, data: {} });
  await schedules.upsertJobScheduler(FLAGS_NIGHTLY_JOB, { pattern: FLAGS_NIGHTLY_PATTERN }, { name: FLAGS_NIGHTLY_JOB, data: {} });
  return true;
}
