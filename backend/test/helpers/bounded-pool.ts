import { availableParallelism } from 'node:os';

import { isCi } from '../test-workers.js';

/**
 * Overrides how many child processes a test file may run side by side.
 *
 * Read by {@link spawnConcurrency}; a positive integer, CI or not.
 */
export const SPAWN_CONCURRENCY_ENV = 'BACKEND_TEST_SPAWN_CONCURRENCY';

/**
 * How many independent child processes one test file may run at once.
 *
 * Half the machine locally: the complete suite runs several workers beside the
 * file (`test/test-workers.ts`), and a pool sized to every thread would make
 * each spawn measure the others. **One under CI**, for the reason the worker
 * count is one there: the runner's memory budget is measured for one process
 * at a time (`.gitlab-ci.yml`, the Memory block above `test:backend`), and a
 * second compiled check beside it is a decision for that host rather than a
 * default inherited from a laptop. `BACKEND_TEST_SPAWN_CONCURRENCY` overrides
 * both, and a value that is not a positive integer is refused rather than
 * guessed at.
 */
export function spawnConcurrency(
  env: NodeJS.ProcessEnv = process.env,
  parallelism: number = availableParallelism(),
): number {
  const raw = env[SPAWN_CONCURRENCY_ENV]?.trim();
  if (raw !== undefined && raw !== '') {
    if (!/^[1-9]\d*$/.test(raw)) {
      throw new Error(`${SPAWN_CONCURRENCY_ENV}="${raw}" is not a positive integer.`);
    }
    return Number.parseInt(raw, 10);
  }
  if (isCi(env)) return 1;
  return Math.max(1, Math.floor(parallelism / 2));
}

/**
 * `items.map(fn)` with at most `limit` calls in flight, results in input order.
 *
 * The first rejection rejects the whole call and no further item is started;
 * calls already in flight are left to finish on their own, because a child
 * process cannot be un-started and its result is simply discarded.
 */
export function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapBounded needs a limit of at least 1, got ${limit}.`);
  }
  return new Promise<R[]>((resolve, reject) => {
    const results = new Array<R>(items.length);
    let next = 0;
    let done = 0;
    let failed = false;
    if (items.length === 0) {
      resolve(results);
      return;
    }
    const startNext = (): void => {
      if (failed || next >= items.length) return;
      const index = next;
      next += 1;
      Promise.resolve()
        .then(() => fn(items[index]!, index))
        .then(
          (value) => {
            results[index] = value;
            done += 1;
            if (done === items.length) resolve(results);
            else startNext();
          },
          (error: unknown) => {
            failed = true;
            reject(error);
          },
        );
    };
    for (let i = 0; i < Math.min(limit, items.length); i += 1) startNext();
  });
}
