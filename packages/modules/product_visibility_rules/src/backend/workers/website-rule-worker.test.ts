import { describe, expect, it, vi } from 'vitest';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  WR_EVALUATE_JOB,
  recordPresenceTransitions,
  runWebsiteRuleJob,
  type PresenceEpochs,
  type WebsiteRuleWork,
} from './website-rule-worker.js';

/**
 * Reconcile after the module was off (R-15, FR-073). While off, the catalogue-event subscriber is
 * silent, so changes made meanwhile were never marked. Every process records a transition of the
 * module's presence it observes by bumping a shared epoch; the evaluation poll reconciles every
 * governed channel when the epoch moved since the last such reconcile. A worker that merely
 * stalled sees no new epoch and only evaluates marks.
 */
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as PlatformLogger;

function work(fail = false): WebsiteRuleWork & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runPreview: async () => void calls.push('preview'),
    applyPreview: async () => (calls.push('apply'), { applied: 0 }),
    evaluateMarked: async () => (calls.push('evaluate'), { evaluated: 0, changed: 0 }),
    reconcileAll: async () => {
      calls.push('reconcile');
      if (fail) throw new Error('reconcile failed');
      return { changed: 0 };
    },
  };
}

function epochs(current: string, reconciled: string | null): PresenceEpochs & { stored: string[] } {
  const stored: string[] = [];
  return {
    stored,
    presenceEpoch: async () => current,
    reconciledEpoch: async () => reconciled,
    markReconciled: async (epoch) => void stored.push(epoch),
    bumpPresenceEpoch: async () => undefined,
  };
}

describe('runWebsiteRuleJob — evaluate after the module was off', () => {
  it('an unmoved epoch only evaluates marks — a stalled worker does not reconcile', async () => {
    const w = work();
    const e = epochs('4', '4');
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, e);
    expect(w.calls).toEqual(['evaluate']);
    expect(e.stored).toEqual([]);
  });

  it('a moved epoch reconciles every governed channel, stores the epoch it read, then evaluates', async () => {
    const w = work();
    const e = epochs('5', '4');
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, e);
    expect(w.calls).toEqual(['reconcile', 'evaluate']);
    expect(e.stored).toEqual(['5']);
  });

  it('a never-reconciled state reconciles once', async () => {
    const w = work();
    const e = epochs('0', null);
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, e);
    expect(w.calls).toEqual(['reconcile', 'evaluate']);
    expect(e.stored).toEqual(['0']);
  });

  it('a failed reconcile stores nothing, so the next poll reconciles again', async () => {
    const e = epochs('5', '4');
    await expect(runWebsiteRuleJob(WR_EVALUATE_JOB, {}, work(true), log, e)).rejects.toThrow('reconcile failed');
    expect(e.stored).toEqual([]);
  });
});

describe('recordPresenceTransitions', () => {
  function recorder(initial: boolean, failFirst = 0) {
    let present = initial;
    let listener: (() => void) | undefined;
    let bumps = 0;
    let failures = failFirst;
    const unsubscribe = vi.fn();
    const stop = recordPresenceTransitions({
      isPresent: () => present,
      onPresenceInstalled: (l) => ((listener = l), unsubscribe),
      bump: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('redis down');
        }
        bumps += 1;
      },
      log,
    });
    const install = async (next: boolean): Promise<void> => {
      present = next;
      listener!();
      await new Promise((resolve) => setImmediate(resolve));
    };
    return { install, bumps: () => bumps, stop, unsubscribe, settle: () => new Promise((resolve) => setImmediate(resolve)) };
  }

  it('bumps on every transition, both ways, and not on a level install', async () => {
    const r = recorder(true);
    await r.settle();
    expect(r.bumps()).toBe(0);
    await r.install(true);
    expect(r.bumps()).toBe(0);
    await r.install(false);
    await r.install(false);
    expect(r.bumps()).toBe(1);
    await r.install(true);
    expect(r.bumps()).toBe(2);
  });

  it('a process that starts while the module is off bumps at once', async () => {
    const r = recorder(false);
    await r.settle();
    expect(r.bumps()).toBe(1);
  });

  it('a failed bump is owed and retried on the next install', async () => {
    const r = recorder(true, 1);
    await r.install(false);
    expect(r.bumps()).toBe(0);
    await r.install(false);
    expect(r.bumps()).toBe(1);
  });

  it('stops listening when stopped', () => {
    const r = recorder(true);
    r.stop();
    expect(r.unsubscribe).toHaveBeenCalledOnce();
  });
});
