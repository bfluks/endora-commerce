import { describe, expect, it } from 'vitest';
import {
  CRAWLER_FILES_PATH,
  CRAWLER_TEXT_MAX_LENGTH,
  FAILURE_BACKOFF_MS,
  FRESH_FOR_MS,
  IN_FLIGHT_ABANDONED_AFTER_MS,
  MAX_CACHED_CHANNELS,
  READ_TIMEOUT_MS,
  ROBOTS_POLICY_PATH,
  STALE_REFRESH_BUDGET_MS,
  createCrawlerPolicyReader,
  isCrawlerFilesResponse,
  isRobotsPolicyResponse,
} from '../../lib/seo/crawler-policy';
import {
  CRAWLER_TEXT_MAX_BYTES,
  storefrontCrawlerFilesResponseSchema,
  storefrontRobotsPolicyResponseSchema,
} from '@endora-commerce/contracts/seo';

/**
 * How the storefront reads a channel's default robots policy
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §3).
 *
 * The reader runs in the middleware, in front of every response, so the two
 * things it must never do are the two this file is mostly about:
 *
 *  * **fail a page.** Whatever the backend does — refuse, hang, answer
 *    nonsense — the reader answers, and the page is served (FR-017);
 *  * **confuse "there is no policy" with "I could not ask".** A switched-off
 *    module and a backend without the feature are *answers* and replace what
 *    was known; a timeout is not, and what was known stands. Treating the
 *    first as the second keeps a `noindex` in force after an operator withdrew
 *    it; treating the second as the first drops a `noindex` every time the
 *    backend hiccups.
 *
 * `fetch` and the clock are injected, so every case below is deterministic and
 * none of them waits.
 */

type Answer =
  | { status: number; body?: unknown; text?: string }
  | { throws: unknown }
  /** The request stays open until the test settles it with `settle()`. */
  | { hangs: true };

interface Call {
  url: string;
  headers: Headers;
  signal: AbortSignal | null | undefined;
}

function respond(answer: Exclude<Answer, { hangs: true }>): Response {
  if ('throws' in answer) throw answer.throws;
  const body = answer.text ?? JSON.stringify(answer.body ?? {});
  return new Response(body, {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness(initial: Answer) {
  let answer = initial;
  let now = 1_000_000;
  const calls: Call[] = [];
  const hanging: ((settled: Exclude<Answer, { hangs: true }>) => void)[] = [];
  const timers: { at: number; fire: () => void }[] = [];
  const reader = createCrawlerPolicyReader({
    baseUrl: () => 'http://backend.test:3001',
    now: () => now,
    delay: (ms) =>
      new Promise<void>((resolve) => {
        timers.push({ at: now + ms, fire: resolve });
      }),
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        signal: init?.signal,
      });
      if ('hangs' in answer) {
        return new Promise<Response>((resolve, reject) => {
          hanging.push((settled) => {
            try {
              resolve(respond(settled));
            } catch (error) {
              reject(error);
            }
          });
        });
      }
      return respond(answer);
    },
  });
  /** Let every promise that can settle, settle. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  return {
    reader,
    calls,
    flush,
    answerWith(next: Answer) {
      answer = next;
    },
    /** Move the clock without firing any timer — for the freshness and back-off cases. */
    advance(ms: number) {
      now += ms;
    },
    /** Move the clock and fire the timers that fall due. */
    async elapse(ms: number) {
      now += ms;
      for (const timer of timers.splice(0).filter((t) => {
        if (t.at <= now) return true;
        timers.push(t);
        return false;
      })) {
        timer.fire();
      }
      await flush();
    },
    /** Settle every request that is hanging. */
    async settle(settled: Exclude<Answer, { hangs: true }>) {
      for (const finish of hanging.splice(0)) finish(settled);
      await flush();
    },
    pendingTimers: () => timers.length,
  };
}

const ok = (index: boolean, follow: boolean): Exclude<Answer, { hangs: true }> => ({
  status: 200,
  body: { data: { index, follow } },
});
const MODULE_DISABLED: Exclude<Answer, { hangs: true }> = {
  status: 503,
  body: { error: { code: 'MODULE_DISABLED', message: "Module 'seo' is currently disabled." } },
};
const NOINDEX = { kind: 'value', value: { index: false, follow: false } } as const;

describe('a readable policy', () => {
  it('is the value the backend answered', async () => {
    const h = harness(ok(false, true));
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: false, follow: true },
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.url).toBe(`http://backend.test:3001${ROBOTS_POLICY_PATH}`);
    expect(ROBOTS_POLICY_PATH).toBe('/api/v1/storefront/seo/robots-policy');
  });

  it('is fresh for a minute: no second request inside the window', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.answerWith(ok(true, true));
    h.advance(FRESH_FOR_MS - 1);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(1);
    expect(FRESH_FOR_MS).toBe(60_000);
  });

  it('is refetched once when stale, and the new value replaces the old', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.answerWith(ok(true, true));
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(2);
    // …and that answer is fresh in its turn.
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(2);
  });

  it('is asked for once when several requests arrive together', async () => {
    const h = harness(ok(false, false));
    const answers = await Promise.all([
      h.reader.robotsPolicy('pl'),
      h.reader.robotsPolicy('pl'),
      h.reader.robotsPolicy('pl'),
    ]);
    expect(answers).toEqual([NOINDEX, NOINDEX, NOINDEX]);
    expect(h.calls).toHaveLength(1);
  });

  it('is read from an answer carrying fields this storefront does not know', async () => {
    // A storefront is deployed apart from its backend and is usually the older
    // one. A backend that later adds a field must not turn this read into
    // "unreadable": on a freshly started storefront that would serve a noindex
    // channel with no directive at all.
    const h = harness({
      status: 200,
      body: {
        data: { index: false, follow: false, maxSnippet: 0, somethingNewer: { nested: true } },
        meta: { generatedAt: '2026-10-11T00:00:00.000Z' },
      },
    });
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
  });

  it('is asked for with a two-second budget', async () => {
    const h = harness(ok(true, true));
    await h.reader.robotsPolicy('pl');
    expect(h.calls[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(READ_TIMEOUT_MS).toBe(2_000);
  });
});

describe('a definitive "there is no policy"', () => {
  it('is what a switched-off module means', async () => {
    const h = harness(MODULE_DISABLED);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });
  });

  it('is what a backend without the route means', async () => {
    const h = harness({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });
  });

  it('is cached like a value', async () => {
    const h = harness(MODULE_DISABLED);
    await h.reader.robotsPolicy('pl');
    h.advance(FRESH_FOR_MS - 1);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });
    expect(h.calls).toHaveLength(1);
  });

  it('replaces an earlier value — the module was switched off, so the noindex is withdrawn', async () => {
    const h = harness(ok(false, false));
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);

    h.answerWith(MODULE_DISABLED);
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });

    // And it stays withdrawn when the backend then becomes unreadable: the
    // last thing known is that there is no policy, not the value before it.
    h.answerWith({ throws: new TypeError('fetch failed') });
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });
  });

  it('is replaced in its turn when the module comes back', async () => {
    const h = harness(MODULE_DISABLED);
    await h.reader.robotsPolicy('pl');
    h.answerWith(ok(false, false));
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
  });

  it('is not what a 503 without the module code means', async () => {
    // A proxy in front of a restarting backend answers 503 too. That is "could
    // not ask", and it must not withdraw a noindex.
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    for (const unreadable of [
      { status: 503, text: '<html>Service Unavailable</html>' },
      { status: 503, body: { error: { code: 'SERVICE_UNAVAILABLE' } } },
      { status: 503, body: {} },
    ] satisfies Answer[]) {
      h.answerWith(unreadable);
      h.advance(FRESH_FOR_MS);
      expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    }
  });
});

describe('an unreadable policy', () => {
  const UNREADABLE: [string, Answer][] = [
    ['a timeout', { throws: new DOMException('The operation timed out.', 'TimeoutError') }],
    [
      'a refused connection',
      {
        throws: new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        }),
      },
    ],
    ['a 500', { status: 500, body: { error: { code: 'INTERNAL_ERROR' } } }],
    ['a 502', { status: 502, text: 'Bad Gateway' }],
    ['a 401', { status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }],
    ['a body that is not JSON', { status: 200, text: '<!doctype html><title>Login</title>' }],
    ['a body with a key missing', { status: 200, body: { data: { index: false } } }],
    ['a body with a string for a boolean', { status: 200, body: { data: { index: 'false', follow: true } } }],
    ['a body with no envelope', { status: 200, body: { index: false, follow: false } }],
    [
      'a body whose unknown fields come with a known one missing',
      { status: 200, body: { data: { follow: false, somethingNewer: true } } },
    ],
  ];

  it.each(UNREADABLE)('answers "unknown" for %s when nothing was ever known', async (_label, answer) => {
    const h = harness(answer);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'unknown' });
  });

  it.each(UNREADABLE)('answers the last-known value for %s', async (_label, answer) => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.answerWith(answer);
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
  });

  it('answers the last-known value however old it is', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.answerWith({ throws: new TypeError('fetch failed') });
    h.advance(7 * 24 * 60 * 60 * 1000);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
  });

  it('never rejects, whatever the failure', async () => {
    for (const [, answer] of UNREADABLE) {
      await expect(harness(answer).reader.robotsPolicy('pl')).resolves.toBeDefined();
    }
    await expect(
      harness({ throws: 'a thrown string, not an Error' }).reader.robotsPolicy('pl'),
    ).resolves.toEqual({ kind: 'unknown' });
  });

  it('is retried at most once every five seconds while it keeps failing', async () => {
    const h = harness({ throws: new TypeError('fetch failed') });
    await h.reader.robotsPolicy('pl');
    expect(h.calls).toHaveLength(1);

    h.advance(FAILURE_BACKOFF_MS - 1);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'unknown' });
    expect(h.calls).toHaveLength(1);

    h.advance(1);
    await h.reader.robotsPolicy('pl');
    expect(h.calls).toHaveLength(2);
    expect(FAILURE_BACKOFF_MS).toBe(5_000);
  });

  it('holds the same back-off when a stale value is being served', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.answerWith({ status: 500 });
    h.advance(FRESH_FOR_MS);
    await h.reader.robotsPolicy('pl');
    await h.reader.robotsPolicy('pl');
    h.advance(FAILURE_BACKOFF_MS - 1);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(2);
    h.advance(1);
    await h.reader.robotsPolicy('pl');
    expect(h.calls).toHaveLength(3);
  });

  it('recovers on the first successful read after the back-off', async () => {
    const h = harness({ throws: new TypeError('fetch failed') });
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'unknown' });
    h.answerWith(ok(false, true));
    h.advance(FAILURE_BACKOFF_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: false, follow: true },
    });
  });
});

describe('sales-channel isolation', () => {
  it('names the channel to the backend, and names none when the request had none', async () => {
    const h = harness(ok(true, true));
    await h.reader.robotsPolicy('pl_retail');
    await h.reader.robotsPolicy(undefined);
    expect(h.calls[0]!.headers.get('x-sales-channel')).toBe('pl_retail');
    expect(h.calls[1]!.headers.has('x-sales-channel')).toBe(false);
  });

  it('never answers one channel with another channel’s value', async () => {
    const h = harness(ok(false, false));
    expect(await h.reader.robotsPolicy('a')).toEqual(NOINDEX);

    // Channel B is asked for inside A's freshness window. It is a different
    // channel, so A's cached answer is not an answer to it.
    h.answerWith(ok(true, true));
    expect(await h.reader.robotsPolicy('b')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls.map((call) => call.headers.get('x-sales-channel'))).toEqual(['a', 'b']);

    // And both keep their own.
    expect(await h.reader.robotsPolicy('a')).toEqual(NOINDEX);
    expect(await h.reader.robotsPolicy('b')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(2);
  });

  it('never answers a request naming no channel with a named channel’s value, nor the reverse', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('a');

    h.answerWith(ok(true, true));
    expect(await h.reader.robotsPolicy(undefined)).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });

    h.answerWith(ok(true, false));
    expect(await h.reader.robotsPolicy('c')).toEqual({
      kind: 'value',
      value: { index: true, follow: false },
    });
    expect(h.calls).toHaveLength(3);
  });

  it('keeps "no channel" apart from a channel whose code is the empty string or "undefined"', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy(undefined);
    h.answerWith(ok(true, true));
    for (const code of ['', 'undefined', 'null']) {
      expect(await h.reader.robotsPolicy(code)).toEqual({
        kind: 'value',
        value: { index: true, follow: true },
      });
    }
    expect(h.calls).toHaveLength(4);
  });

  it('does not fall back to another channel’s last-known value when its own read fails', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('a');
    h.answerWith({ throws: new TypeError('fetch failed') });
    expect(await h.reader.robotsPolicy('b')).toEqual({ kind: 'unknown' });
    expect(await h.reader.robotsPolicy(undefined)).toEqual({ kind: 'unknown' });
  });

  it('keeps "no channel" apart from a channel whose code is literally "default"', async () => {
    // The seeded system channel is called exactly that. A request naming it and
    // a request naming nothing are the same channel to the backend today, and
    // still two questions here: the backend is what resolves "none named".
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy(undefined);
    h.answerWith(ok(true, true));
    expect(await h.reader.robotsPolicy('default')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(await h.reader.robotsPolicy(undefined)).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(2);
  });
});

/**
 * The channel code is a request header. Behind a proxy it is the proxy's;
 * reached directly it is whatever the client typed. So the cache is bounded —
 * and the bound must not become a way to make this storefront forget a real
 * channel's `noindex`: a forgotten value plus a backend outage is that
 * channel's files and its outage notice served with no directive.
 */
describe('a client inventing channel codes', () => {
  const UNKNOWN_CHANNEL: Answer = {
    status: 400,
    body: { error: { code: 'UNKNOWN_SALES_CHANNEL' } },
  };

  it('cannot grow the cache past its bound', async () => {
    const h = harness(ok(false, false));
    for (let i = 0; i < MAX_CACHED_CHANNELS + 50; i += 1) {
      await h.reader.robotsPolicy(`invented-${i}`);
    }
    expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
  });

  it.each([
    ['refuses with 400', UNKNOWN_CHANNEL],
    ['answers 404', { status: 404, body: { error: { code: 'UNKNOWN_SALES_CHANNEL' } } }],
    ['cannot be read at all', { throws: new TypeError('fetch failed') }],
  ] satisfies [string, Answer][])(
    'cannot evict a real channel’s last-known value when the backend %s for the invented ones',
    async (_label, forInvented) => {
      const h = harness(ok(false, false));
      expect(await h.reader.robotsPolicy('real')).toEqual(NOINDEX);
      expect(await h.reader.robotsPolicy(undefined)).toEqual(NOINDEX);

      h.answerWith(forInvented);
      for (let i = 0; i < 300; i += 1) await h.reader.robotsPolicy(`inv_${i}`);
      expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);

      // Then the backend goes away, after the real channel's value went stale.
      h.answerWith({ throws: new TypeError('fetch failed') });
      h.advance(FRESH_FOR_MS);
      expect(await h.reader.robotsPolicy('real')).toEqual(NOINDEX);
      expect(await h.reader.robotsPolicy(undefined)).toEqual(NOINDEX);
    },
  );

  it('cannot grow the cache past its bound by asking for many codes at once', async () => {
    // Every read below is in progress before any of them answers, so each
    // entry is created — and, holding nothing yet, evicted to make room for
    // the next — long before its answer arrives. An answer must not put its
    // entry back into a cache that is already full.
    const h = harness({ hangs: true });
    const reads = Array.from({ length: MAX_CACHED_CHANNELS * 4 }, (_unused, i) =>
      h.reader.robotsPolicy(`together-${i}`),
    );
    await h.flush();
    expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);

    await h.settle(ok(false, false));
    // Every caller is still told what the backend answered it…
    expect(await Promise.all(reads)).toEqual(reads.map(() => NOINDEX));
    // …and no more of the answers are kept than the cache may hold.
    expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
    expect(h.calls).toHaveLength(MAX_CACHED_CHANNELS * 4);
  });

  it('holds the same bound when the invented codes are answered "no policy"', async () => {
    const h = harness({ hangs: true });
    const reads = Array.from({ length: MAX_CACHED_CHANNELS * 4 }, (_unused, i) =>
      h.reader.crawlerFiles(`together-${i}`),
    );
    await h.flush();
    await h.settle({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(await Promise.all(reads)).toEqual(reads.map(() => ({ kind: 'none' })));
    expect(h.reader.cachedCrawlerFilesCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
  });

  it('does not let a read whose entry was evicted overwrite what was read since', async () => {
    // A's first read hangs. Its entry holds nothing, so it is the first to go
    // when other codes need room.
    const h = harness({ hangs: true });
    const first = h.reader.robotsPolicy('a');
    await h.flush();

    h.answerWith({ throws: new TypeError('fetch failed') });
    for (let i = 0; i < MAX_CACHED_CHANNELS; i += 1) await h.reader.robotsPolicy(`other-${i}`);

    // A is asked again — a new entry, a new read — and answered.
    h.answerWith(ok(true, true));
    const NEWER = { kind: 'value', value: { index: true, follow: true } } as const;
    expect(await h.reader.robotsPolicy('a')).toEqual(NEWER);

    // Now the first read answers, with what was true when it was sent. The
    // request that waited for it is told that; the cache keeps the newer one.
    await h.settle(ok(false, false));
    expect(await first).toEqual(NOINDEX);
    h.answerWith({ throws: new Error('must not be asked: the newer answer is fresh') });
    expect(await h.reader.robotsPolicy('a')).toEqual(NEWER);
    expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
  });

  it('tells the caller, but does not keep, an evicted read’s answer when the cache is full', async () => {
    const h = harness({ hangs: true });
    const first = h.reader.robotsPolicy('a');
    await h.flush();

    // Enough other codes, each answered, to evict A's empty entry and leave
    // the cache full of values.
    h.answerWith(ok(true, true));
    for (let i = 0; i < MAX_CACHED_CHANNELS; i += 1) await h.reader.robotsPolicy(`other-${i}`);
    expect(h.reader.cachedChannelCount()).toBe(MAX_CACHED_CHANNELS);
    const callsBefore = h.calls.length;

    await h.settle(ok(false, false));
    expect(await first).toEqual(NOINDEX);
    expect(h.reader.cachedChannelCount()).toBe(MAX_CACHED_CHANNELS);

    // Not kept: the next request for A asks again — a late answer does not
    // get to evict a channel that was read in the meantime.
    h.answerWith(ok(false, true));
    expect(await h.reader.robotsPolicy('a')).toEqual({
      kind: 'value',
      value: { index: false, follow: true },
    });
    expect(h.calls).toHaveLength(callsBefore + 1);
    expect(h.reader.cachedChannelCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
  });

  it('keeps the answer of a read whose entry was not evicted', async () => {
    // The ordinary case, stated beside the two above so that "not kept" cannot
    // quietly become the rule: B's read is slow, nothing evicts B meanwhile.
    const h = harness(ok(true, true));
    await h.reader.robotsPolicy('a');
    h.answerWith({ hangs: true });
    const b = h.reader.robotsPolicy('b');
    await h.flush();
    await h.settle(ok(false, false));
    expect(await b).toEqual(NOINDEX);
    h.answerWith({ throws: new Error('must not be asked: B is fresh') });
    expect(await h.reader.robotsPolicy('b')).toEqual(NOINDEX);
    expect(h.reader.cachedChannelCount()).toBe(2);
  });

  it('evicts the channel read longest ago when every entry holds a value', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('first');
    await h.reader.robotsPolicy('second');
    for (let i = 0; i < MAX_CACHED_CHANNELS - 2; i += 1) await h.reader.robotsPolicy(`c-${i}`);
    expect(h.reader.cachedChannelCount()).toBe(MAX_CACHED_CHANNELS);

    // "first" is read again successfully, which makes it the most recent.
    h.advance(FRESH_FOR_MS);
    await h.reader.robotsPolicy('first');
    const before = h.calls.length;

    // One more channel: "second" is now the oldest and is the one that goes.
    await h.reader.robotsPolicy('one-more');
    h.answerWith({ throws: new TypeError('fetch failed') });
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.robotsPolicy('first')).toEqual(NOINDEX);
    expect(await h.reader.robotsPolicy('second')).toEqual({ kind: 'unknown' });
    expect(h.calls.length).toBeGreaterThan(before);
  });
});

/**
 * FR-017: no response is *delayed* because the policy could not be read.
 *
 * Once a value is known there is something to serve, so a refresh is given a
 * short budget and no more: a healthy backend answers inside it and the fresh
 * value is served on the same request; a hanging one is left to finish in the
 * background while the known value is served. Only a process that knows nothing
 * waits for its first read — the alternative is serving a `noindex` channel
 * bare — and it waits once, then backs off.
 */
describe('a refresh that does not answer', () => {
  async function warm(): Promise<ReturnType<typeof harness>> {
    const h = harness(ok(false, false));
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    h.advance(FRESH_FOR_MS);
    return h;
  }

  it('costs a request with a known value no more than the budget', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });

    let answered: unknown = 'pending';
    void h.reader.robotsPolicy('pl').then((read) => {
      answered = read;
    });
    await h.flush();
    expect(answered).toBe('pending');

    await h.elapse(STALE_REFRESH_BUDGET_MS);
    expect(answered).toEqual(NOINDEX);
    expect(STALE_REFRESH_BUDGET_MS).toBeLessThanOrEqual(250);
    expect(STALE_REFRESH_BUDGET_MS).toBeLessThan(READ_TIMEOUT_MS);
  });

  it('costs the requests that arrive while it is still hanging nothing at all', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });
    void h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);

    // The budget is the refresh's, not each request's: it is already spent.
    const timersBefore = h.pendingTimers();
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.pendingTimers()).toBe(timersBefore);
    expect(h.calls).toHaveLength(2);
  });

  it('shares one budget between requests that arrive together', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });
    const all = Promise.all(Array.from({ length: 20 }, () => h.reader.robotsPolicy('pl')));
    await h.elapse(STALE_REFRESH_BUDGET_MS);
    expect(await all).toEqual(Array.from({ length: 20 }, () => NOINDEX));
    expect(h.calls).toHaveLength(2);
  });

  it('still serves the fresh value on the same request when the backend answers in time', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });
    const read = h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS - 1);
    await h.settle(ok(true, true));
    expect(await read).toEqual({ kind: 'value', value: { index: true, follow: true } });
  });

  it('replaces the value when the refresh finishes in the background', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });
    const read = h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);
    expect(await read).toEqual(NOINDEX);

    await h.settle(ok(true, true));
    h.answerWith({ throws: new Error('must not be asked: the background answer is fresh') });
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(2);
  });

  it('withdraws the value when the background refresh says the module is off', async () => {
    const h = await warm();
    h.answerWith({ hangs: true });
    void h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);
    await h.settle(MODULE_DISABLED);
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'none' });
  });

  it('keeps the value, backs off and raises nothing when the background refresh fails', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const h = await warm();
      h.answerWith({ hangs: true });
      void h.reader.robotsPolicy('pl');
      await h.elapse(STALE_REFRESH_BUDGET_MS);

      await h.settle({ throws: new DOMException('The operation timed out.', 'TimeoutError') });
      // A macrotask, so that Node has had its chance to report a rejection.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);

      // Known value served, and no new request inside the back-off.
      expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
      expect(h.calls).toHaveLength(2);
      h.advance(FAILURE_BACKOFF_MS);
      h.answerWith(ok(false, true));
      expect(await h.reader.robotsPolicy('pl')).toEqual({
        kind: 'value',
        value: { index: false, follow: true },
      });
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('is waited for by a process that knows nothing — once', async () => {
    // Cold start: there is nothing to serve in the meantime, and serving a
    // noindex channel bare is the worse answer. The read has its own two-second
    // limit, and the back-off keeps the next requests from waiting again.
    const h = harness({ hangs: true });
    let answered: unknown = 'pending';
    void h.reader.robotsPolicy('pl').then((read) => {
      answered = read;
    });
    await h.elapse(STALE_REFRESH_BUDGET_MS * 4);
    expect(answered).toBe('pending');

    await h.settle({ throws: new DOMException('The operation timed out.', 'TimeoutError') });
    expect(answered).toEqual({ kind: 'unknown' });
    expect(await h.reader.robotsPolicy('pl')).toEqual({ kind: 'unknown' });
    expect(h.calls).toHaveLength(1);
  });
});

/**
 * The reader checks the answer with a small guard of its own rather than with
 * the contract's Zod schema, so that the middleware bundle does not carry a
 * validation library for two booleans. The schema in `@endora-commerce/contracts`
 * stays the statement of what the answer is; this holds the guard to it.
 */
describe('isRobotsPolicyResponse agrees with the contract schema', () => {
  const FIXTURES: unknown[] = [
    { data: { index: true, follow: true } },
    { data: { index: false, follow: true } },
    { data: { index: true, follow: false } },
    { data: { index: false, follow: false } },
    { data: { index: false, follow: false, maxSnippet: 0 }, meta: { a: 1 } },
    { data: { index: false } },
    { data: { follow: false, somethingNewer: true } },
    { data: { index: 'false', follow: true } },
    { data: { index: 0, follow: 1 } },
    { data: { index: null, follow: true } },
    { data: null },
    { data: 'NOINDEX, FOLLOW' },
    { data: [true, true] },
    { data: {} },
    { index: false, follow: false },
    {},
    null,
    undefined,
    'a string',
    42,
    [],
    [{ data: { index: true, follow: true } }],
  ];

  it.each(FIXTURES.map((fixture) => [JSON.stringify(fixture) ?? 'undefined', fixture]))(
    'on %s',
    (_label, fixture) => {
      expect(isRobotsPolicyResponse(fixture)).toBe(
        storefrontRobotsPolicyResponseSchema.safeParse(fixture).success,
      );
    },
  );

  it('accepts some fixtures and refuses others — the comparison is not vacuous', () => {
    const verdicts = FIXTURES.map((fixture) => isRobotsPolicyResponse(fixture));
    expect(verdicts.filter(Boolean)).toHaveLength(5);
    expect(verdicts.filter((verdict) => !verdict).length).toBeGreaterThan(10);
  });
});

/**
 * A read the process abandoned must not block the channel for ever.
 *
 * A read normally ends within its two-second limit, one way or the other. A
 * process that is frozen mid-request — a paused container, a suspended
 * serverless instance — can come back holding a read that will never settle:
 * its timer is gone with the request. Every later request would then find a
 * read "in progress", start none of its own, and serve what it knew at the
 * moment of the freeze for the life of the process. So a read in progress for
 * longer than any read can take is treated as dead, and its answer, should one
 * ever arrive, is ignored.
 */
describe('a read that never settles', () => {
  it('is replaced by a new read once it is older than any read can be', async () => {
    const h = harness(ok(false, false));
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    h.advance(FRESH_FOR_MS);

    h.answerWith({ hangs: true });
    void h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);
    expect(h.calls).toHaveLength(2);

    // Still inside the time a read may take: it is in progress, not dead.
    h.answerWith(ok(true, true));
    h.advance(IN_FLIGHT_ABANDONED_AFTER_MS - STALE_REFRESH_BUDGET_MS - 1);
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(2);

    // Past it: the read is given up, and this request starts another.
    h.advance(1);
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(3);
    expect(IN_FLIGHT_ABANDONED_AFTER_MS).toBeGreaterThan(READ_TIMEOUT_MS);
    expect(IN_FLIGHT_ABANDONED_AFTER_MS).toBeLessThanOrEqual(10_000);
  });

  it('does not let the abandoned read overwrite what was read since, should it answer after all', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.advance(FRESH_FOR_MS);
    h.answerWith({ hangs: true });
    void h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);

    h.answerWith(ok(true, true));
    h.advance(IN_FLIGHT_ABANDONED_AFTER_MS);
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });

    // The frozen read wakes up with what was true before the freeze — or with
    // a failure. Neither is news.
    await h.settle(ok(false, true));
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: true, follow: true },
    });
    expect(h.calls).toHaveLength(3);
  });

  it('does not let the abandoned read’s failure start a back-off', async () => {
    const h = harness(ok(false, false));
    await h.reader.robotsPolicy('pl');
    h.advance(FRESH_FOR_MS);
    h.answerWith({ hangs: true });
    void h.reader.robotsPolicy('pl');
    await h.elapse(STALE_REFRESH_BUDGET_MS);

    h.answerWith(ok(true, true));
    h.advance(IN_FLIGHT_ABANDONED_AFTER_MS);
    await h.reader.robotsPolicy('pl');
    await h.settle({ throws: new TypeError('fetch failed') });

    // Fresh for its minute, then refreshed on time — no back-off in the way.
    h.advance(FRESH_FOR_MS);
    h.answerWith(ok(false, true));
    expect(await h.reader.robotsPolicy('pl')).toEqual({
      kind: 'value',
      value: { index: false, follow: true },
    });
  });

  it('is replaced for a process that knows nothing, too', async () => {
    const h = harness({ hangs: true });
    let first: unknown = 'pending';
    void h.reader.robotsPolicy('pl').then((read) => {
      first = read;
    });
    await h.flush();
    h.advance(IN_FLIGHT_ABANDONED_AFTER_MS);
    h.answerWith(ok(false, false));
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(2);
    // The request that was waiting on the dead read is not answered by it.
    expect(first).toBe('pending');
  });
});

/**
 * The second thing this reader reads: what a channel's crawler files are built
 * from (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2).
 *
 * Same cache, same three answers, same rules — the cases above are about the
 * machinery and are not repeated per read. What is held here is that this read
 * goes through that machinery (one case per row of the classification table),
 * that it is a different question from the policy with its own answers, and
 * the two things that are its own: the texts leave the reader exactly as the
 * backend sent them, and a text longer than the backend accepts is not served.
 *
 * `robots.txt` treats `unknown` differently from a page — it answers `503`
 * rather than serve a file that silently omits the operator's instructions —
 * and that is the route's decision (`robots-txt-route.test.ts`), not the
 * reader's: the reader says the same three things to every caller.
 */
describe('the crawler-files read', () => {
  const FILES = {
    index: false,
    follow: true,
    robotsTxtCustom: 'User-agent: GPTBot\r\nDisallow: /\n\n  # kept \n',
    llmsTxtAdditional: '',
    shop: { name: 'Endora Demo' },
  };
  const filesOk = (overrides: Record<string, unknown> = {}): Exclude<Answer, { hangs: true }> => ({
    status: 200,
    body: { data: { ...FILES, ...overrides } },
  });
  const VALUE = { kind: 'value', value: FILES } as const;

  it('asks the crawler-files route, for the channel it was given', async () => {
    const h = harness(filesOk());
    expect(await h.reader.crawlerFiles('pl_retail')).toEqual(VALUE);
    await h.reader.crawlerFiles(undefined);
    expect(CRAWLER_FILES_PATH).toBe('/api/v1/storefront/seo/crawler-files');
    expect(h.calls.map((call) => call.url)).toEqual([
      `http://backend.test:3001${CRAWLER_FILES_PATH}`,
      `http://backend.test:3001${CRAWLER_FILES_PATH}`,
    ]);
    expect(h.calls[0]!.headers.get('x-sales-channel')).toBe('pl_retail');
    expect(h.calls[1]!.headers.has('x-sales-channel')).toBe(false);
    expect(h.calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('hands the texts over exactly as the backend sent them', async () => {
    const h = harness(filesOk());
    const read = await h.reader.crawlerFiles('pl');
    expect(read.kind === 'value' && read.value.robotsTxtCustom).toBe(FILES.robotsTxtCustom);
  });

  it('hands over the members this storefront was written for, and no others', async () => {
    const h = harness({
      status: 200,
      body: {
        data: { ...FILES, somethingNewer: true, shop: { name: 'Endora Demo', logoUrl: 'x' } },
        meta: { a: 1 },
      },
    });
    expect(await h.reader.crawlerFiles('pl')).toEqual(VALUE);
  });

  it('hands over whether the store is open to anonymous visitors, when the backend says', async () => {
    for (const anonymousAccess of [false, true]) {
      const h = harness(filesOk({ anonymousAccess }));
      expect(await h.reader.crawlerFiles('trade')).toEqual({
        kind: 'value',
        value: { ...FILES, anonymousAccess },
      });
    }
    // A backend older than the member says nothing, and nothing is invented.
    const older = harness(filesOk());
    const read = await older.reader.crawlerFiles('trade');
    expect(read.kind === 'value' && 'anonymousAccess' in read.value).toBe(false);
  });

  it('is fresh for a minute, then refetched once', async () => {
    const h = harness(filesOk());
    await h.reader.crawlerFiles('pl');
    h.answerWith(filesOk({ robotsTxtCustom: 'Disallow: /new' }));
    h.advance(FRESH_FOR_MS - 1);
    expect(await h.reader.crawlerFiles('pl')).toEqual(VALUE);
    expect(h.calls).toHaveLength(1);

    h.advance(1);
    expect(await h.reader.crawlerFiles('pl')).toEqual({
      kind: 'value',
      value: { ...FILES, robotsTxtCustom: 'Disallow: /new' },
    });
    expect(h.calls).toHaveLength(2);
  });

  it.each([
    ['a switched-off module', MODULE_DISABLED],
    ['a backend without the route', { status: 404, body: { error: { code: 'NOT_FOUND' } } }],
  ] satisfies [string, Answer][])('reads %s as "none", and it replaces an earlier text', async (_label, none) => {
    const cold = harness(none);
    expect(await cold.reader.crawlerFiles('pl')).toEqual({ kind: 'none' });

    const warm = harness(filesOk());
    await warm.reader.crawlerFiles('pl');
    warm.answerWith(none);
    warm.advance(FRESH_FOR_MS);
    expect(await warm.reader.crawlerFiles('pl')).toEqual({ kind: 'none' });
    // …and stays withdrawn when the backend then becomes unreadable.
    warm.answerWith({ throws: new TypeError('fetch failed') });
    warm.advance(FRESH_FOR_MS);
    expect(await warm.reader.crawlerFiles('pl')).toEqual({ kind: 'none' });
  });

  const UNREADABLE: [string, Answer][] = [
    ['a timeout', { throws: new DOMException('The operation timed out.', 'TimeoutError') }],
    ['a refused connection', { throws: new TypeError('fetch failed') }],
    ['a 500', { status: 500, body: { error: { code: 'INTERNAL' } } }],
    ['a 503 without the module code', { status: 503, text: '<html>Service Unavailable</html>' }],
    ['a 400 for a channel the backend does not know', { status: 400, body: { error: { code: 'UNKNOWN_SALES_CHANNEL' } } }],
    ['a body that is not JSON', { status: 200, text: 'User-agent: *\nDisallow: /' }],
    ['a body with no envelope', { status: 200, body: FILES }],
    ['a robots policy alone', { status: 200, body: { data: { index: true, follow: true } } }],
    ['a text that is not a string', filesOk({ robotsTxtCustom: null })],
    ['a missing text', { status: 200, body: { data: { ...FILES, robotsTxtCustom: undefined } } }],
    ['a shop without a name', filesOk({ shop: {} })],
    ['a text longer than the backend accepts', filesOk({ robotsTxtCustom: 'a'.repeat(CRAWLER_TEXT_MAX_BYTES + 1) })],
  ];

  it.each(UNREADABLE)('answers "unknown" for %s when nothing was ever known', async (_label, answer) => {
    const h = harness(answer);
    expect(await h.reader.crawlerFiles('pl')).toEqual({ kind: 'unknown' });
  });

  it.each(UNREADABLE)('answers the last-known files for %s, however old', async (_label, answer) => {
    const h = harness(filesOk());
    await h.reader.crawlerFiles('pl');
    h.answerWith(answer);
    h.advance(30 * 24 * 60 * 60 * 1000);
    expect(await h.reader.crawlerFiles('pl')).toEqual(VALUE);
  });

  it('is retried at most once every five seconds while it keeps failing', async () => {
    const h = harness({ throws: new TypeError('fetch failed') });
    await h.reader.crawlerFiles('pl');
    h.advance(FAILURE_BACKOFF_MS - 1);
    expect(await h.reader.crawlerFiles('pl')).toEqual({ kind: 'unknown' });
    expect(h.calls).toHaveLength(1);
    h.advance(1);
    await h.reader.crawlerFiles('pl');
    expect(h.calls).toHaveLength(2);
  });

  it('never rejects', async () => {
    for (const [, answer] of UNREADABLE) {
      await expect(harness(answer).reader.crawlerFiles('pl')).resolves.toBeDefined();
    }
  });

  it('never answers one channel with another channel’s text', async () => {
    const h = harness(filesOk({ robotsTxtCustom: 'Disallow: /only-a' }));
    await h.reader.crawlerFiles('a');

    h.answerWith(filesOk({ robotsTxtCustom: '' }));
    const b = await h.reader.crawlerFiles('b');
    const none = await h.reader.crawlerFiles(undefined);
    const literalDefault = await h.reader.crawlerFiles('default');
    for (const read of [b, none, literalDefault]) {
      expect(read.kind === 'value' && read.value.robotsTxtCustom).toBe('');
    }
    expect(h.calls.map((call) => call.headers.get('x-sales-channel'))).toEqual([
      'a',
      'b',
      null,
      'default',
    ]);

    // And when B's own read fails it does not fall back to A's text.
    const failing = harness(filesOk({ robotsTxtCustom: 'Disallow: /only-a' }));
    await failing.reader.crawlerFiles('a');
    failing.answerWith({ throws: new TypeError('fetch failed') });
    expect(await failing.reader.crawlerFiles('b')).toEqual({ kind: 'unknown' });
    expect(await failing.reader.crawlerFiles(undefined)).toEqual({ kind: 'unknown' });
  });

  it('is a different question from the policy: neither answers for the other', async () => {
    const h = harness(ok(false, false));
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);

    // The policy is fresh for `pl`; the files were never asked for.
    h.answerWith(filesOk({ index: true, follow: true }));
    const files = await h.reader.crawlerFiles('pl');
    expect(files.kind === 'value' && files.value.index).toBe(true);
    expect(h.calls.map((call) => new URL(call.url).pathname)).toEqual([
      ROBOTS_POLICY_PATH,
      CRAWLER_FILES_PATH,
    ]);

    // And the policy the middleware applies is still the one it read itself.
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
    expect(h.calls).toHaveLength(2);

    // A failed files read does not disturb the policy either, nor the reverse.
    h.answerWith({ throws: new TypeError('fetch failed') });
    expect(await h.reader.crawlerFiles('other')).toEqual({ kind: 'unknown' });
    expect(await h.reader.robotsPolicy('pl')).toEqual(NOINDEX);
  });

  it('holds a bounded number of channels, and an invented code cannot evict a real one', async () => {
    const h = harness(filesOk());
    expect(await h.reader.crawlerFiles('real')).toEqual(VALUE);

    h.answerWith({ status: 400, body: { error: { code: 'UNKNOWN_SALES_CHANNEL' } } });
    for (let i = 0; i < MAX_CACHED_CHANNELS + 50; i += 1) await h.reader.crawlerFiles(`inv_${i}`);
    expect(h.reader.cachedCrawlerFilesCount()).toBeLessThanOrEqual(MAX_CACHED_CHANNELS);
    // The policy's cache is its own: nothing here grew it.
    expect(h.reader.cachedChannelCount()).toBe(0);

    h.answerWith({ throws: new TypeError('fetch failed') });
    h.advance(FRESH_FOR_MS);
    expect(await h.reader.crawlerFiles('real')).toEqual(VALUE);
  });

  it('serves a known file within the refresh budget when the backend hangs', async () => {
    const h = harness(filesOk());
    await h.reader.crawlerFiles('pl');
    h.advance(FRESH_FOR_MS);
    h.answerWith({ hangs: true });

    let answered: unknown = 'pending';
    void h.reader.crawlerFiles('pl').then((read) => {
      answered = read;
    });
    await h.flush();
    expect(answered).toBe('pending');
    await h.elapse(STALE_REFRESH_BUDGET_MS);
    expect(answered).toEqual(VALUE);
  });
});

describe('isCrawlerFilesResponse agrees with the contract schema', () => {
  const FILES = {
    index: true,
    follow: false,
    robotsTxtCustom: 'Disallow: /x\r\n',
    llmsTxtAdditional: '# more',
    shop: { name: 'Shop' },
  };
  const AT_LIMIT = 'a'.repeat(CRAWLER_TEXT_MAX_BYTES);
  const FIXTURES: unknown[] = [
    { data: FILES },
    { data: { ...FILES, robotsTxtCustom: '', llmsTxtAdditional: '', shop: { name: '' } } },
    { data: { ...FILES, extra: 1, shop: { name: 'Shop', logoUrl: 'x' } }, meta: {} },
    { data: { ...FILES, robotsTxtCustom: AT_LIMIT, llmsTxtAdditional: AT_LIMIT } },
    // `unreadable` — optional, a list of names, any names.
    { data: { ...FILES, unreadable: [] } },
    { data: { ...FILES, index: false, follow: false, unreadable: ['policy'] } },
    { data: { ...FILES, unreadable: ['policy', 'llmsTxtAdditional', 'somethingLater'] } },
    { data: { ...FILES, unreadable: 'policy' } },
    { data: { ...FILES, unreadable: null } },
    { data: { ...FILES, unreadable: true } },
    { data: { ...FILES, unreadable: [1] } },
    { data: { ...FILES, unreadable: ['policy', null] } },
    { data: { ...FILES, unreadable: { policy: true } } },
    // `anonymousAccess` — optional, a boolean when it is there.
    { data: { ...FILES, anonymousAccess: false } },
    { data: { ...FILES, anonymousAccess: true } },
    { data: { ...FILES, anonymousAccess: 'false' } },
    { data: { ...FILES, anonymousAccess: null } },
    { data: { ...FILES, anonymousAccess: 0 } },
    { data: { ...FILES, robotsTxtCustom: `${AT_LIMIT}a` } },
    { data: { ...FILES, llmsTxtAdditional: `${AT_LIMIT}a` } },
    { data: { ...FILES, robotsTxtCustom: null } },
    { data: { ...FILES, robotsTxtCustom: ['Disallow: /'] } },
    { data: { ...FILES, llmsTxtAdditional: 1 } },
    { data: { ...FILES, shop: {} } },
    { data: { ...FILES, shop: null } },
    { data: { ...FILES, shop: 'Shop' } },
    { data: { ...FILES, shop: ['Shop'] } },
    { data: { ...FILES, shop: { name: null } } },
    { data: { ...FILES, index: 'true' } },
    { data: { index: true, follow: true } },
    { data: { robotsTxtCustom: '', llmsTxtAdditional: '', shop: { name: '' } } },
    { data: null },
    { data: [FILES] },
    { data: 'Disallow: /' },
    FILES,
    {},
    null,
    undefined,
    'a string',
    [],
  ];

  it.each(FIXTURES.map((fixture, i) => [`#${i} ${(JSON.stringify(fixture) ?? 'undefined').slice(0, 80)}`, fixture]))(
    'on %s',
    (_label, fixture) => {
      expect(isCrawlerFilesResponse(fixture)).toBe(
        storefrontCrawlerFilesResponseSchema.safeParse(fixture).success,
      );
    },
  );

  it('accepts some fixtures and refuses others — the comparison is not vacuous', () => {
    const verdicts = FIXTURES.map((fixture) => isCrawlerFilesResponse(fixture));
    expect(verdicts.filter(Boolean)).toHaveLength(9);
    expect(verdicts.filter((verdict) => !verdict).length).toBeGreaterThan(15);
  });

  it('hands on what the backend could not read, and says nothing when it read everything', async () => {
    const read = async (data: unknown) => {
      const reader = createCrawlerPolicyReader({
        fetch: async () => new Response(JSON.stringify({ data }), { status: 200 }),
        now: () => 0,
        baseUrl: () => 'http://api.test',
        delay: () => new Promise(() => undefined),
      });
      return reader.crawlerFiles(undefined);
    };
    expect(await read({ ...FILES, unreadable: ['policy', 'later'] })).toEqual({
      kind: 'value',
      value: { ...FILES, unreadable: ['policy', 'later'] },
    });
    // Absent and empty are the same statement, and the value has one shape for it.
    for (const data of [FILES, { ...FILES, unreadable: [] }]) {
      const answer = await read(data);
      expect(answer).toEqual({ kind: 'value', value: FILES });
      expect(answer.kind === 'value' && 'unreadable' in answer.value).toBe(false);
    }
    // A list that is not one makes the whole answer unreadable, like any other
    // member that fails the guard.
    expect(await read({ ...FILES, unreadable: 'policy' })).toEqual({ kind: 'unknown' });
  });

  it('restates the contract’s limit rather than importing it', () => {
    // The middleware bundle carries this file, and must not carry a validation
    // library with it; so the number is written twice and held equal here.
    expect(CRAWLER_TEXT_MAX_LENGTH).toBe(CRAWLER_TEXT_MAX_BYTES);
  });
});
