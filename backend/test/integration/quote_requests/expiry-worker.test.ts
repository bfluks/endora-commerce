import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { ageQuoteRequest } from '../../helpers/quote-request-age.js';
import type { RfqExpiryWorker } from '../../../../packages/modules/quote_requests/src/backend/services/rfq-expiry-worker.js';
import { EventBus } from '@endora-commerce/platform/events';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T074 — Expiry worker honours `quote_requests.expiryDays`.
 *
 * `expiryDays = 0` → no-op.
 * `expiryDays = N` → flips Pending / Created from admin past
 *   `now() - INTERVAL N days` to Expired with a `expired` event row.
 */
describe('RfqExpiryWorker (US7 / T074)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * `expiryDays` for every channel and for a request with none — what this file
   * has always meant by one number. Per-channel values are `expiry-rules.test.ts`'s
   * subject (issue #239).
   */
  function buildWorker(resolveExpiryDays: () => Promise<number>): RfqExpiryWorker {
    const resolveExpiryRule = async () => {
      const days = await resolveExpiryDays();
      const channels = await h.em().find(SalesChannel, {});
      return { byChannel: new Map(channels.map((channel) => [channel.id, days])), withoutChannel: days };
    };
    // The module's own worker class and dependencies, as composed — not this
    // module's source files imported a second time beside the composed
    // package. Loading `src/` would register a second `QuoteRequest` entity
    // class, and since feature 159 an entity is transitively scoped through
    // that class name (`QuoteRequestItemGroup`), which the ORM refuses as
    // ambiguous. A fresh event bus keeps this file's announcements its own.
    const composed = (
      h.container.cradle as unknown as {
        // `deps` is the worker's private constructor parameter, read at runtime.
        quoteRequests: { handle(): { expiryWorker: { deps: Record<string, unknown>; constructor: unknown } } };
      }
    ).quoteRequests.handle().expiryWorker;
    const Worker = composed.constructor as new (deps: unknown) => RfqExpiryWorker;
    return new Worker({ ...composed.deps, events: new EventBus(), resolveExpiryRule });
  }

  it('expiryDays=0 is a no-op', async () => {
    const worker = buildWorker(async () => 0);
    const result = await worker.sweep();
    expect(result.expiredCount).toBe(0);
  });

  it('flips Pending RFQs older than expiryDays to Expired', async () => {
    // Create a Pending RFQ
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
      },
    });
    const id = (created.json() as { data: { id: string } }).data.id;

    // Backdate updatedAt by 30 days so it's past the threshold
    await ageQuoteRequest(h.em(), id, new Date(Date.now() - 30 * 86_400_000));

    const worker = buildWorker(async () => 14);
    const result = await worker.sweep();
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify status flipped
    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (after.json() as { data: { status: string; events: Array<{ eventType: string }> } }).data;
    expect(detail.status).toBe('Expired');
    expect(detail.events.map((e) => e.eventType)).toContain('expired');
  });
});
