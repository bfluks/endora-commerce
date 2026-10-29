// perf-weight: fast — 6 s locally (one composition, 2 × 2000 in-process decisions); not yet timed on the CI runner.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 154 — what the sales-channel access step costs a request (FR-035,
 * SC-004).
 *
 *  - An **anonymous** decision reads nothing: the flag rides on the cached
 *    channel. Asserted as zero reads of the permitted-channel source, not as a
 *    latency, because "no read" is the requirement.
 *  - A **customer** decision on a warm process is one in-process LRU lookup.
 *    Asserted as one load for the whole loop, and timed.
 *
 * The decisions go through the composed policy and cache — the objects the
 * resolver middleware calls — so the numbers are the step's, without HTTP.
 *
 * Tuning knobs (env):
 *   PERF_RUN                      — set to 'true' to run; otherwise skipped.
 *   PERF_ITERATIONS               — decisions per scenario (default 2000)
 *   PERF_ACCESS_STEP_P99_MS       — customer warm-path p99 budget (default 1)
 */

const shouldRun = process.env['PERF_RUN'] === 'true';
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '2000');
const p99Budget = Number(process.env['PERF_ACCESS_STEP_P99_MS'] ?? '1');

describe.skipIf(!shouldRun)('sales-channel access step — cost per request', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('anonymous decisions read no assignment', async () => {
    const channel = await h.salesChannels.resolver.getSystemDefault();
    const reads = vi.spyOn(h.salesChannels.accessCache, 'permittedChannelIds');
    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const decision = await h.salesChannels.accessPolicy.decide({ kind: 'anonymous' }, channel);
      samples.push(performance.now() - t0);
      expect(decision.ok).toBe(true);
    }
    process.stdout.write(
      `[perf access-step anonymous] iterations=${iterations} reads=${reads.mock.calls.length} ` +
        `p50=${quantile(samples, 0.5).toFixed(4)}ms p99=${quantile(samples, 0.99).toFixed(4)}ms\n`,
    );
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  }, 60_000);

  it('a warm customer decision is an in-process lookup', async () => {
    const channel = await h.salesChannels.resolver.getSystemDefault();
    const actor = { kind: 'customer', organizationId: TEST_ORGANIZATION_ID } as const;
    // Warm once; every decision below must be answered without the bridge read.
    await h.salesChannels.accessCache.invalidate(TEST_ORGANIZATION_ID);
    const loads = vi.spyOn(h.salesChannels.membershipService, 'listChannelIdsForEntity');
    expect((await h.salesChannels.accessPolicy.decide(actor, channel)).ok).toBe(true);

    const samples: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const decision = await h.salesChannels.accessPolicy.decide(actor, channel);
      samples.push(performance.now() - t0);
      expect(decision.ok).toBe(true);
    }
    const p50 = quantile(samples, 0.5);
    const p99 = quantile(samples, 0.99);
    process.stdout.write(
      `[perf access-step customer warm] iterations=${iterations} loads=${loads.mock.calls.length} ` +
        `p50=${p50.toFixed(4)}ms p99=${p99.toFixed(4)}ms (budget ${p99Budget}ms)\n`,
    );
    expect(loads).toHaveBeenCalledTimes(1);
    expect(p99).toBeLessThan(p99Budget);
    loads.mockRestore();
  }, 60_000);
});

function quantile(samples: number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx]!;
}
