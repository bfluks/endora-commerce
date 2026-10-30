import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPriceSurfaceProducer,
  PRICE_SURFACE_QUEUE,
  startPriceSurfaceWorker,
  type PriceSurfaceProducer,
} from '../../../../packages/modules/price_lists/src/backend/workers/price-surface-worker.js';

/**
 * Issue #416, review 2 of #424 — the price surface's queue against a real
 * Redis, with the module's own producer and consumer.
 *
 * A pass that cannot finish — a build whose products keep vanishing under it
 * after three fresh reads — fails out of `rebuildStale`, swapping nothing and
 * keeping every mark. The work is then the queue's to redo:
 *
 * - the failed job runs again, by BullMQ's own attempts and backoff;
 * - a job that failed for good does not block the next request. The job id is
 *   fixed (one coalesced job), and BullMQ refuses an id it still holds, so a
 *   failed job kept for inspection would have swallowed every later enqueue
 *   and left the marks waiting for nobody.
 */
describe('price surface queue (real BullMQ)', () => {
  let redis: Redis;
  let queue: Queue;
  let producer: PriceSurfaceProducer;
  let worker: Worker | undefined;
  const logged: Array<{ level: string; message: string }> = [];

  const start = (rebuildStale: () => Promise<number>) => {
    let attached: Worker | undefined;
    const started = startPriceSurfaceWorker({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      rebuildStale,
      log: {
        info: () => undefined,
        debug: () => undefined,
        warn: (_obj: unknown, message: string) => logged.push({ level: 'warn', message }),
        error: (_obj: unknown, message: string) => logged.push({ level: 'error', message }),
      } as never,
      attach: (built) => {
        attached = built;
      },
    });
    expect(started).toBe(true);
    worker = attached;
    return attached!;
  };

  beforeAll(async () => {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(PRICE_SURFACE_QUEUE, { connection: redis });
    await queue.obliterate({ force: true });
    producer = createPriceSurfaceProducer(redis);
  });

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    logged.length = 0;
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await producer.close();
    await queue.close();
    await redis.quit();
  });

  it('a pass that fails is run again by the queue', async () => {
    let calls = 0;
    const consumer = start(async () => {
      calls += 1;
      if (calls < 3) throw new Error('price surface: products vanished under the build of e');
      return 1;
    });
    await consumer.waitUntilReady();
    expect(await producer.enqueue()).toBe(true);
    await vi.waitFor(() => expect(calls).toBe(3), { timeout: 30_000, interval: 100 });
  }, 60_000);

  it('a job that failed for good does not swallow the next request, and its failure is logged', async () => {
    let calls = 0;
    const consumer = start(async () => {
      calls += 1;
      throw new Error('price surface: products vanished under the build of e');
    });
    await consumer.waitUntilReady();
    await producer.enqueue();
    // Every attempt the job has.
    await vi.waitFor(() => expect(calls).toBe(3), { timeout: 30_000, interval: 100 });
    await vi.waitFor(async () => expect(await queue.getJobCountByTypes('active', 'waiting', 'delayed')).toBe(0), {
      timeout: 10_000,
      interval: 100,
    });
    // The next write's request is a new job, not the failed one.
    await producer.enqueue();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(4), { timeout: 15_000, interval: 100 });
    expect(logged.some((l) => l.level === 'error' && /price surface/.test(l.message))).toBe(true);
  }, 60_000);
});
