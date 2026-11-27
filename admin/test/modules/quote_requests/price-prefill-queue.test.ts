import { describe, expect, it, vi } from 'vitest';
import {
  createPricePrefillQueue,
  PRICE_PREFILL_MAX_IN_FLIGHT,
  type PricePrefillRequest,
} from '../../../../packages/modules/quote_requests/src/admin/lib/price-prefill-queue';

/**
 * Feature 145, research R-11: the agreed-price prefill on **Create quote request**
 * goes through a small queue — at most four resolutions in flight, and a response
 * applied only while it still answers the line's current question. A response for
 * a quantity or customer the line no longer has, or for a line that is gone, is
 * discarded; the order responses arrive in does not matter.
 */

interface Deferred {
  request: PricePrefillRequest;
  resolve: (amount: string | null) => void;
  reject: (err: unknown) => void;
}

function rig(): {
  calls: Deferred[];
  results: Array<[string, string | null]>;
  queue: ReturnType<typeof createPricePrefillQueue>;
} {
  const calls: Deferred[] = [];
  const results: Array<[string, string | null]> = [];
  const queue = createPricePrefillQueue({
    fetch: (request) =>
      new Promise<string | null>((resolve, reject) => {
        calls.push({ request, resolve, reject });
      }),
    onResult: (key, amount) => {
      results.push([key, amount]);
    },
  });
  return { calls, results, queue };
}

/** A line's question; the line is keyed by its product unless `key` says otherwise. */
const req = (productId: string, quantity = 1, customerId = 'cust-1', key = productId): PricePrefillRequest => ({
  key,
  productId,
  quantity,
  customerId,
  organizationId: 'org-1',
});

/** Let every settled promise's continuations run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('price prefill queue', () => {
  it('keeps at most four requests in flight and starts the next as one settles', async () => {
    expect(PRICE_PREFILL_MAX_IN_FLIGHT).toBe(4);
    const { calls, results, queue } = rig();
    for (let i = 1; i <= 6; i += 1) queue.request(req(`p${i}`));

    expect(calls.map((c) => c.request.productId)).toEqual(['p1', 'p2', 'p3', 'p4']);

    calls[1]!.resolve('20.00');
    await flush();
    expect(calls.map((c) => c.request.productId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(results).toEqual([['p2', '20.00']]);

    calls[0]!.reject(new Error('down'));
    await flush();
    expect(calls).toHaveLength(6);
    // A failed resolution reports "no price", so the line is left for manual entry.
    expect(results).toEqual([
      ['p2', '20.00'],
      ['p1', null],
    ]);
  });

  it('applies responses in whatever order they complete', async () => {
    const { calls, results, queue } = rig();
    queue.request(req('p1'));
    queue.request(req('p2'));
    queue.request(req('p3'));

    calls[2]!.resolve('30.00');
    await flush();
    calls[0]!.resolve('10.00');
    await flush();
    calls[1]!.resolve(null);
    await flush();

    expect(results).toEqual([
      ['p3', '30.00'],
      ['p1', '10.00'],
      ['p2', null],
    ]);
  });

  it('discards a response whose quantity or customer the line no longer has', async () => {
    const { calls, results, queue } = rig();
    queue.request(req('p1', 1));
    queue.request(req('p1', 5));
    queue.request(req('p2', 1, 'cust-1'));
    queue.request(req('p2', 1, 'cust-2'));
    expect(calls).toHaveLength(4);

    // The newer questions answer first; the older answers arrive afterwards and are dropped.
    calls[1]!.resolve('9.00');
    calls[3]!.resolve('7.00');
    await flush();
    calls[0]!.resolve('10.00');
    calls[2]!.resolve('8.00');
    await flush();

    expect(results).toEqual([
      ['p1', '9.00'],
      ['p2', '7.00'],
    ]);
  });

  it('discards the response of a removed line, even when the product is added back at the same key', async () => {
    const { calls, results, queue } = rig();
    queue.request(req('p1'));
    queue.request(req('p2'));
    queue.forget('p1');
    calls[0]!.resolve('10.00');
    calls[1]!.resolve('20.00');
    await flush();
    expect(results).toEqual([['p2', '20.00']]);

    // Removed while in flight, then added again with the very same question.
    queue.request(req('p3'));
    queue.forget('p3');
    queue.request(req('p3'));
    calls[2]!.resolve('31.00');
    await flush();
    expect(results).toEqual([['p2', '20.00']]);
    calls[3]!.resolve('32.00');
    await flush();
    expect(results).toEqual([
      ['p2', '20.00'],
      ['p3', '32.00'],
    ]);
  });

  it('does not send a queued request that has been superseded or forgotten before it started', async () => {
    const settle: Array<(amount: string | null) => void> = [];
    const fetch = vi.fn(
      (_request: PricePrefillRequest) => new Promise<string | null>((resolve) => settle.push(resolve)),
    );
    const queue = createPricePrefillQueue({ fetch, onResult: () => {} });
    for (let i = 1; i <= 4; i += 1) queue.request(req(`p${i}`));
    queue.request(req('p5', 1));
    queue.request(req('p5', 2));
    queue.request(req('p6'));
    queue.forget('p6');
    queue.request(req('p7'));
    expect(fetch).toHaveBeenCalledTimes(4);

    for (const resolve of settle.splice(0)) resolve('1.00');
    await flush();
    // p5 is asked once, for its latest quantity; the forgotten p6 is never asked.
    expect(fetch.mock.calls.slice(4).map(([r]) => [r.productId, r.quantity])).toEqual([
      ['p5', 2],
      ['p7', 1],
    ]);

    queue.request(req('p8'));
    queue.dispose();
    for (const resolve of settle.splice(0)) resolve('1.00');
    await flush();
    // Disposal empties the queue: nothing waiting is sent afterwards.
    expect(fetch).toHaveBeenCalledTimes(7);
  });

  it('keys questions by line, so two lines of one product are each answered (feature 159, N-31)', async () => {
    const { calls, results, queue } = rig();
    queue.request(req('p1', 5, 'cust-1', 'line-a'));
    queue.request(req('p1', 3, 'cust-1', 'line-b'));
    calls[1]!.resolve('9.00');
    calls[0]!.resolve('10.00');
    await flush();
    expect(results).toEqual([
      ['line-b', '9.00'],
      ['line-a', '10.00'],
    ]);
    // Forgetting one line leaves the other's question alone.
    queue.request(req('p1', 6, 'cust-1', 'line-a'));
    queue.request(req('p1', 2, 'cust-1', 'line-b'));
    queue.forget('line-a');
    calls[2]!.resolve('1.00');
    calls[3]!.resolve('2.00');
    await flush();
    expect(results.slice(2)).toEqual([['line-b', '2.00']]);
  });

  it('applies nothing once disposed', async () => {
    const { calls, results, queue } = rig();
    queue.request(req('p1'));
    queue.dispose();
    calls[0]!.resolve('10.00');
    await flush();
    expect(results).toEqual([]);
  });
});
