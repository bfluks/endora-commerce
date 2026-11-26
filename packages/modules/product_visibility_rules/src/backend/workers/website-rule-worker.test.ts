import { describe, expect, it, vi } from 'vitest';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  WR_EVALUATE_DEBOUNCE_MS,
  WR_EVALUATE_JOB,
  WR_REENABLE_GAP_MS,
  runWebsiteRuleJob,
  type WebsiteRuleWork,
} from './website-rule-worker.js';

/**
 * Spec 193 T061 (R-15, FR-073) — the website-rule worker after a pause. The worker is attached
 * with `ctx.worker`, so while the module is off its jobs wait and nothing is evaluated. The
 * evaluation poll runs every 30 s while on; a run that finds the previous one more than
 * {@link WR_REENABLE_GAP_MS} ago (the module was off, or no worker ran) reconciles every governed
 * channel before evaluating marks — what happened meanwhile was never marked, because the
 * catalogue-event subscriber does not run while off.
 */
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as PlatformLogger;

function work(): WebsiteRuleWork & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    runPreview: async () => void calls.push('preview'),
    applyPreview: async () => (calls.push('apply'), { applied: 0 }),
    evaluateMarked: async () => (calls.push('evaluate'), { evaluated: 0, changed: 0 }),
    reconcileAll: async () => (calls.push('reconcile'), { changed: 0 }),
  };
}

describe('runWebsiteRuleJob — evaluate after a pause (T061)', () => {
  it('the gap exceeds a few polls, so the run reconciles first', () => {
    expect(WR_REENABLE_GAP_MS).toBeGreaterThan(2 * WR_EVALUATE_DEBOUNCE_MS);
  });

  it('a steady poll only evaluates marks', async () => {
    const w = work();
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, { sinceLastEvaluation: async () => WR_EVALUATE_DEBOUNCE_MS });
    expect(w.calls).toEqual(['evaluate']);
  });

  it('the first poll after the module comes back on reconciles every governed channel, then evaluates', async () => {
    const w = work();
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, { sinceLastEvaluation: async () => WR_REENABLE_GAP_MS + 1 });
    expect(w.calls).toEqual(['reconcile', 'evaluate']);
  });

  it('a process with no record of an earlier poll reconciles too', async () => {
    const w = work();
    await runWebsiteRuleJob(WR_EVALUATE_JOB, {}, w, log, { sinceLastEvaluation: async () => null });
    expect(w.calls).toEqual(['reconcile', 'evaluate']);
  });
});
