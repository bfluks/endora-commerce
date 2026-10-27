import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  enterSystemScope,
  rethrowIfModuleDisabled,
  type PlatformLogger,
} from '@endora-commerce/platform/kernel';

/**
 * Feature 163 (`specs/163-product-data-scopes/research.md` R9, FR-024, SC-005) —
 * publication-window transitions reaching what does not read at request time.
 *
 * Storefront reads and the search filter evaluate the window when they run, so
 * they are exact. Webhook subscribers, feed caches and search-document
 * freshness learn of a window bound being crossed the way they learn of a
 * status change: one `product.updated.v1` with `changedFields:
 * ['publicationWindow']` per product. **No stored status is written** (A-4).
 *
 * A bound is "crossed" when it lies in `(lastSweep, now]`; the global window on
 * `products` and every **overridden** channel window count. `lastSweep` is a
 * Redis key this module owns — a watermark, not a cache — and a missing key
 * reads as `now − 2 × interval`. The sweep is idempotent: a crash between the
 * emits and the watermark re-emits on the next tick, and the subscribers'
 * upserts are harmless repeats.
 */

export const PUBLICATION_WINDOW_SWEEP_QUEUE = 'catalog.publication-window.sweep';
export const PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID = 'catalog.publication-window.sweep';
/** Every five minutes. */
export const PUBLICATION_WINDOW_SWEEP_EVERY_MS = 5 * 60 * 1000;
/** The watermark: epoch milliseconds of the last completed sweep. */
export const PUBLICATION_WINDOW_WATERMARK_KEY = 'catalog:publication-window:last-sweep';

export interface PublicationWindowSweepResult {
  /** The half-open interval swept: `(from, until]`. */
  from: Date;
  until: Date;
  productIds: string[];
}

/** `product.updated.v1`, as this sweep emits it. */
export interface PublicationWindowEvent {
  eventId: string;
  occurredAt: string;
  productId: string;
  changedFields: ['publicationWindow'];
}

export class PublicationWindowSweep {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly watermark: Pick<Redis, 'get' | 'set'>,
    private readonly emit: (event: PublicationWindowEvent) => void | Promise<void>,
    private readonly everyMs: number = PUBLICATION_WINDOW_SWEEP_EVERY_MS,
  ) {}

  async sweep(now: Date = new Date()): Promise<PublicationWindowSweepResult> {
    const stored = await this.watermark.get(PUBLICATION_WINDOW_WATERMARK_KEY);
    const storedMs = stored === null ? Number.NaN : Number(stored);
    const from = new Date(Number.isFinite(storedMs) ? storedMs : now.getTime() - 2 * this.everyMs);
    const until = now;
    if (from.getTime() >= until.getTime()) return { from, until, productIds: [] };

    const crossed = (column: string): string => `(${column} > ? and ${column} <= ?)`;
    const rows = await this.emFactory().execute<Array<{ id: string }>>(
      `select p.id::text as id from products p
        where p.deleted_at is null
          and (${crossed('p.publish_from')} or ${crossed('p.publish_until')})
       union
       select c.product_id::text as id from product_channel_scopes c
         join products p on p.id = c.product_id and p.deleted_at is null
        where c.window_overridden
          and (${crossed('c.publish_from')} or ${crossed('c.publish_until')})
       order by id`,
      [from, until, from, until, from, until, from, until],
    );
    const productIds = rows.map((row) => row.id);
    for (const productId of productIds) {
      await this.emit({
        eventId: randomUUID(),
        occurredAt: until.toISOString(),
        productId,
        changedFields: ['publicationWindow'],
      });
    }
    await this.watermark.set(PUBLICATION_WINDOW_WATERMARK_KEY, String(until.getTime()));
    return { from, until, productIds };
  }
}

/** The audit reason the sweep's system scope records. */
export const PUBLICATION_WINDOW_SWEEP_SCOPE_REASON = 'catalog: publication-window sweep tick';

export type PublicationWindowSweepJobData = Record<string, never>;

/**
 * One tick. A failed sweep is logged and not re-thrown — the next tick retries
 * from the same watermark. A module switched off is never absorbed.
 */
export async function runPublicationWindowSweepTick(deps: {
  sweep: Pick<PublicationWindowSweep, 'sweep'>;
  log: PlatformLogger;
}): Promise<void> {
  try {
    const result = await deps.sweep.sweep();
    if (result.productIds.length > 0) {
      deps.log.info(
        { event: 'catalog.publication_window.sweep', crossed: result.productIds.length },
        'catalog: publication-window bounds crossed',
      );
    }
  } catch (error) {
    rethrowIfModuleDisabled(error);
    deps.log.warn(
      {
        event: 'catalog.publication_window.sweep',
        error: error instanceof Error ? error.message : String(error),
      },
      'catalog: the publication-window sweep failed; the next tick retries',
    );
  }
}

/**
 * The Job Scheduler and its consumer, where the host says this process consumes
 * queues and offers a connection — the `assets_library` retention sweep's
 * shape. `attach` is `ctx.worker`, which stops the consumer with the module.
 * `queuePrefix` is BullMQ's key prefix and is left alone in production: a test
 * that shares a Redis with other runs sets one of its own (the quote-request
 * expiry sweep's shape).
 */
export async function startPublicationWindowSweep(input: {
  readonly processRunsWorkers: boolean;
  readonly moduleQueueRedis: Redis | undefined;
  readonly sweep: Pick<PublicationWindowSweep, 'sweep'>;
  readonly log: PlatformLogger;
  readonly attach: (worker: Worker<PublicationWindowSweepJobData>) => void;
  readonly onClose: (close: () => Promise<void>) => void;
  readonly queuePrefix?: string;
}): Promise<boolean> {
  const { processRunsWorkers, moduleQueueRedis, queuePrefix } = input;
  if (!processRunsWorkers || moduleQueueRedis === undefined) return false;
  const prefix = queuePrefix !== undefined ? { prefix: queuePrefix } : {};
  const queue = new Queue<PublicationWindowSweepJobData>(PUBLICATION_WINDOW_SWEEP_QUEUE, {
    connection: moduleQueueRedis,
    ...prefix,
    defaultJobOptions: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
  });
  input.onClose(async () => {
    await queue.close();
  });
  input.attach(
    new Worker<PublicationWindowSweepJobData>(
      PUBLICATION_WINDOW_SWEEP_QUEUE,
      // A tick has no caller: it opens its own system scope, so the event
      // subscribers it reaches (search, webhooks) run in a scope.
      () =>
        enterSystemScope(PUBLICATION_WINDOW_SWEEP_SCOPE_REASON, () =>
          runPublicationWindowSweepTick({ sweep: input.sweep, log: input.log }),
        ),
      { connection: moduleQueueRedis, concurrency: 1, ...prefix },
    ),
  );
  await queue.upsertJobScheduler(
    PUBLICATION_WINDOW_SWEEP_SCHEDULER_ID,
    { every: PUBLICATION_WINDOW_SWEEP_EVERY_MS },
    { name: 'sweep', data: {} },
  );
  return true;
}
