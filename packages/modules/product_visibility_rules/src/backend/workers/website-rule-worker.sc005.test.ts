import { describe, expect, it } from 'vitest';
import { WR_EVALUATE_DEBOUNCE_MS } from './website-rule-worker.js';

/**
 * SC-005 / FR-059 — "a governed channel follows a change within 5 minutes". The integration suites
 * drive `evaluateMarked()` directly, so nothing else bounds the real latency: the debounce delay
 * (and the poll that backs it up, which also reconciles after a re-enable) must stay far inside
 * the 5 minute ceiling, with room for one failed attempt's backoff.
 */
describe('website rule evaluation latency budget (SC-005)', () => {
  const FIVE_MINUTES = 5 * 60_000;
  it('the debounce is at most half the SC-005 ceiling', () => {
    expect(WR_EVALUATE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(WR_EVALUATE_DEBOUNCE_MS).toBeLessThanOrEqual(FIVE_MINUTES / 2);
  });
});
