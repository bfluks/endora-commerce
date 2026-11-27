/**
 * The bounded pool a test uses to run independent child processes side by side,
 * and how many it may run at once.
 *
 * Pure: the pool is driven with deferred promises the test resolves by hand, and
 * the concurrency rule reads an environment object and a parallelism the test
 * passes in, so it runs in the fast unit job.
 */
import { describe, expect, it } from 'vitest';

import {
  mapBounded,
  SPAWN_CONCURRENCY_ENV,
  spawnConcurrency,
} from '../../helpers/bounded-pool.js';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every already-settled promise run its continuations. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('mapBounded', () => {
  it('never has more than the limit in flight, and starts the next as one finishes', async () => {
    const gates = Array.from({ length: 5 }, () => deferred());
    const started: number[] = [];
    let inFlight = 0;
    let peak = 0;
    const all = mapBounded([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gates[item]!.promise;
      inFlight -= 1;
      return item * 10;
    });

    await settle();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await settle();
    expect(started).toEqual([0, 1, 2]);
    for (const gate of gates) gate.resolve();
    expect(await all).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('returns results in input order, not in completion order', async () => {
    const gates = Array.from({ length: 3 }, () => deferred());
    const all = mapBounded(['a', 'b', 'c'], 3, async (item, index) => {
      await gates[index]!.promise;
      return item.toUpperCase();
    });
    gates[2]!.resolve();
    gates[0]!.resolve();
    gates[1]!.resolve();
    expect(await all).toEqual(['A', 'B', 'C']);
  });

  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = [];
    const all = mapBounded([0, 1, 2, 3], 1, async (item) => {
      started.push(item);
      if (item === 1) throw new Error('boom at 1');
      return item;
    });
    await expect(all).rejects.toThrow('boom at 1');
    await settle();
    expect(started).toEqual([0, 1]);
  });

  it('answers an empty input with an empty result', async () => {
    expect(await mapBounded([], 4, async () => 1)).toEqual([]);
  });

  it('refuses a limit that would run nothing', () => {
    expect(() => mapBounded([1], 0, async () => 1)).toThrow(/at least 1/);
  });
});

describe('spawnConcurrency', () => {
  it('is half the machine locally, never below one', () => {
    expect(spawnConcurrency({}, 16)).toBe(8);
    expect(spawnConcurrency({}, 3)).toBe(1);
    expect(spawnConcurrency({}, 1)).toBe(1);
  });

  it('is one under CI, whose memory budget is measured for one process at a time', () => {
    expect(spawnConcurrency({ CI: 'true' }, 16)).toBe(1);
    expect(spawnConcurrency({ CI: '1' }, 16)).toBe(1);
    expect(spawnConcurrency({ CI: 'false' }, 16)).toBe(8);
  });

  it('is what the developer asked for, CI or not', () => {
    expect(spawnConcurrency({ [SPAWN_CONCURRENCY_ENV]: '3' }, 16)).toBe(3);
    expect(spawnConcurrency({ [SPAWN_CONCURRENCY_ENV]: '2', CI: 'true' }, 16)).toBe(2);
  });

  it('refuses a value that is not a positive integer rather than guessing', () => {
    for (const value of ['0', '-1', '1.5', 'many']) {
      expect(() => spawnConcurrency({ [SPAWN_CONCURRENCY_ENV]: value }, 16)).toThrow(
        SPAWN_CONCURRENCY_ENV,
      );
    }
  });
});
