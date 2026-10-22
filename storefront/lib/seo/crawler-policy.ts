/**
 * How this storefront learns what the `seo` module configured for a sales
 * channel (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §3).
 *
 * Two questions, one way of asking them:
 *
 *  * the channel's **default robots policy** — asked by the middleware, on
 *    behalf of every response it serves;
 *  * what the channel's **crawler files** are built from — the operator's
 *    custom `robots.txt` instructions and additional `llms.txt` content among
 *    it — asked when such a file is served.
 *
 * Each is a cache first and a client second: one request per channel per
 * minute, held in this module's own memory. Neither uses Next's data cache or
 * cache tags, for two reasons — the middleware cannot reach them, and the
 * requirement is a guaranteed answer when the backend cannot be asked, which a
 * tag-invalidated entry does not promise. The two share every rule below and
 * no state: an answer to one question is never an answer to the other.
 *
 * ## Three answers, and why two of them must not be confused
 *
 * | The backend said | That is | Effect |
 * | --- | --- | --- |
 * | `200` and a valid body | a **value** | cached, fresh for a minute; becomes what is known |
 * | `503` `MODULE_DISABLED`, or `404` | **no policy, definitively** | cached the same way, and it *replaces* what was known |
 * | anything else — a timeout, a refused connection, any other status, a body that fails the schema | **unreadable** | what was known stands, however old; if nothing was ever known, `unknown` |
 *
 * "The module is switched off" and "the backend has no such route" are answers:
 * an operator withdrew the policy, or it never existed here, and a `noindex`
 * kept in force after that would be this storefront overruling them. A timeout
 * is not an answer, and dropping a `noindex` every time the backend hiccups
 * would put a shop that must stay out of search back into it for a minute at a
 * time. So the first replaces the last-known value and the second never does.
 *
 * ## What it never does
 *
 * **It never rejects.** No page is answered with a failure because this read
 * failed (FR-017); every failure becomes one of the three answers above. What
 * `unknown` *means* is each caller's to decide, and they decide differently on
 * purpose: a page is served without a default directive, while `robots.txt`
 * answers a temporary failure rather than a file that silently omits the
 * operator's instructions (FR-022; `lib/seo/robots-txt.ts`).
 *
 * **It never makes a response wait for a backend that is not answering, once it
 * knows something.** A stale value is refreshed on the request that finds it
 * stale, and that request waits for the refresh for at most
 * {@link STALE_REFRESH_BUDGET_MS}: a healthy backend answers well inside it, so
 * the fresh value is served on the same request and a saved change is in force
 * as soon as the minute is up. A backend that does not answer in time is left
 * to finish in the background — its answer replaces the value when it arrives —
 * and the known value is served meanwhile. The budget belongs to the refresh,
 * not to each request: requests arriving while it is still running wait only
 * for what is left of it, which after the first is nothing.
 *
 * **The one wait that remains is a cold start.** A process that knows nothing
 * has nothing to serve in the meantime, and serving a `noindex` channel with no
 * directive is the worse answer, so the first read of a channel is waited for —
 * up to {@link READ_TIMEOUT_MS}, once, after which the back-off keeps later
 * requests from waiting again.
 *
 * The background refresh relies on this process outliving the response, which
 * is true of the standalone server this storefront is built as.
 *
 * **It never waits on a read that can no longer answer.** A read ends within
 * {@link READ_TIMEOUT_MS} one way or the other — unless the process was frozen
 * under it, in which case it may never settle. A read in progress for longer
 * than {@link IN_FLIGHT_ABANDONED_AFTER_MS} is given up: the next request
 * starts another, and the abandoned one's answer, should it ever arrive, is
 * ignored.
 *
 * ## What "known" means
 *
 * Per storefront process, in memory, per runtime: the middleware's copy and a
 * route handler's are separate and each is bounded by the same minute. A
 * freshly started process knows nothing, so until its first successful read a
 * channel's documents carry no default directive — the cold-start window the
 * module's documentation names — and its `robots.txt` answers a temporary
 * failure.
 */

import { backendBaseUrl } from '../env.mjs';
import { channelHeaders } from '../channel/channel-header';

/**
 * A sales channel's default robots policy, as the backend answers it.
 *
 * The contract is `storefrontRobotsPolicySchema` in `@endora-commerce/contracts`.
 * It is restated here as a type and checked by {@link isRobotsPolicyResponse}
 * rather than imported, so that the middleware bundle carries no validation
 * library for two booleans and this file needs nothing from a package to run.
 * `test/seo/crawler-policy.test.ts` holds the guard to the schema.
 */
export interface RobotsPolicy {
  /** `false` asks search engines not to index the channel's storefront. */
  readonly index: boolean;
  /** `false` asks search engines not to follow the links on its pages. */
  readonly follow: boolean;
}

/**
 * Whether `body` is `{ data: { index: boolean, follow: boolean } }`.
 *
 * Strict about the two members it reads and tolerant of any it does not know,
 * exactly as the schema is: a backend that later adds a field must not make
 * this storefront read the answer as unreadable.
 */
export function isRobotsPolicyResponse(body: unknown): body is { data: RobotsPolicy } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  const { index, follow } = data as { index?: unknown; follow?: unknown };
  return typeof index === 'boolean' && typeof follow === 'boolean';
}

/** The backend route the policy is read from. */
export const ROBOTS_POLICY_PATH = '/api/v1/storefront/seo/robots-policy';

/**
 * What a sales channel's crawler files are built from, as the backend answers
 * it.
 *
 * The contract is `storefrontCrawlerFilesSchema` in `@endora-commerce/contracts`,
 * restated and guarded here for the reason given at {@link RobotsPolicy}: this
 * file is in the middleware bundle. The two texts are the operator's, exactly
 * as stored; `lib/seo/robots-txt.ts` says what a served file does with them.
 */
export interface CrawlerFiles extends RobotsPolicy {
  /** The operator's custom `robots.txt` instructions, or `''`. */
  readonly robotsTxtCustom: string;
  /** The operator's additional `llms.txt` content, or `''`. */
  readonly llmsTxtAdditional: string;
  readonly shop: {
    /** The channel's configured shop name, or `''`. */
    readonly name: string;
  };
  /**
   * What the backend could not read from what is stored, by name — absent
   * when it read everything. It answers the rest rather than fail the whole
   * read, so that a file which needs none of what is named is still served:
   * `robots.txt` reads neither of the two things that can be named here.
   *
   * {@link UNREADABLE_POLICY} — `index` and `follow` are not known, whatever
   * they say; {@link UNREADABLE_LLMS_TXT} — `llmsTxtAdditional` is not known,
   * and is `''`. A name this storefront does not know is one it has no use
   * for.
   */
  readonly unreadable?: readonly string[];
  /**
   * `false` on a store closed to anonymous visitors
   * (`specs/154-sales-channel-access/`): nothing on it is public, so its
   * `robots.txt` disallows everything and its `llms.txt` lists nothing,
   * whatever the rest of the answer says. Absent from a backend older than
   * that feature, whose channels are all open — read as `true`.
   */
  readonly anonymousAccess?: boolean;
}

/** In {@link CrawlerFiles.unreadable}: the channel's default robots is not known. */
export const UNREADABLE_POLICY = 'policy';
/** In {@link CrawlerFiles.unreadable}: the channel's additional `llms.txt` content is not known. */
export const UNREADABLE_LLMS_TXT = 'llmsTxtAdditional';

/**
 * The longest text this storefront takes from the backend, in characters.
 *
 * `CRAWLER_TEXT_MAX_BYTES` in the contract, restated. The backend refuses a
 * longer text when it is saved and refuses to answer with one, so this is the
 * third door and is not expected to turn anything away. It is here because the
 * text ends up in a public file: an answer carrying more than can be saved did
 * not come from a backend behaving as agreed, and is treated as unreadable
 * rather than served.
 */
export const CRAWLER_TEXT_MAX_LENGTH = 65_536;

function isCrawlerText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CRAWLER_TEXT_MAX_LENGTH;
}

/**
 * Whether `body` is `{ data: <crawler files> }`.
 *
 * Strict about the members it names, tolerant of any it does not — as
 * {@link isRobotsPolicyResponse} is, and for the same reason.
 */
export function isCrawlerFilesResponse(body: unknown): body is { data: CrawlerFiles } {
  if (!isRobotsPolicyResponse(body)) return false;
  const { robotsTxtCustom, llmsTxtAdditional, shop, unreadable, anonymousAccess } = body.data as {
    robotsTxtCustom?: unknown;
    llmsTxtAdditional?: unknown;
    shop?: unknown;
    unreadable?: unknown;
    anonymousAccess?: unknown;
  };
  if (!isCrawlerText(robotsTxtCustom) || !isCrawlerText(llmsTxtAdditional)) return false;
  // Optional, and a boolean when it is there.
  if (anonymousAccess !== undefined && typeof anonymousAccess !== 'boolean') return false;
  // Optional, and a list of names when it is there. Which names is not judged:
  // a later backend may name something this storefront has never heard of.
  if (
    unreadable !== undefined &&
    !(Array.isArray(unreadable) && unreadable.every((name) => typeof name === 'string'))
  ) {
    return false;
  }
  if (typeof shop !== 'object' || shop === null || Array.isArray(shop)) return false;
  return typeof (shop as { name?: unknown }).name === 'string';
}

/** The backend route the crawler files are read from. */
export const CRAWLER_FILES_PATH = '/api/v1/storefront/seo/crawler-files';

/** How long an answer is served without asking again. */
export const FRESH_FOR_MS = 60_000;

/** While the backend cannot be read, how long before it is asked again. */
export const FAILURE_BACKOFF_MS = 5_000;

/** How long one read is given before it counts as unreadable. */
export const READ_TIMEOUT_MS = 2_000;

/**
 * How long a request holding a known value waits for its refresh.
 *
 * Long enough that a healthy backend on the same network always answers inside
 * it, short enough that a backend which does not is not felt.
 */
export const STALE_REFRESH_BUDGET_MS = 150;

/**
 * How long a read may be in progress before it is taken for dead.
 *
 * More than twice the longest a read can take, so a slow read is never
 * mistaken for an abandoned one.
 */
export const IN_FLIGHT_ABANDONED_AFTER_MS = 5_000;

/**
 * How many channels are held at once, per question.
 *
 * The channel code is a request header: behind a proxy it is the proxy's, but a
 * storefront reached directly takes whatever the client typed. Without a bound
 * a client inventing codes would grow this map for the life of the process.
 *
 * What is dropped to make room is chosen so that inventing codes cannot make
 * this process forget a real channel's policy: an entry that holds nothing goes
 * first, then one that holds "no policy", and only when every entry holds a
 * value does the value read longest ago go. A code the backend refuses never
 * comes to hold a value, so it can only ever displace its own kind.
 */
export const MAX_CACHED_CHANNELS = 256;

/** What a caller is told. `unknown` is "could not ask, and nothing was ever known". */
export type CrawlerRead<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' };

export type RobotsPolicyRead = CrawlerRead<RobotsPolicy>;
export type CrawlerFilesRead = CrawlerRead<CrawlerFiles>;

/** A definitive answer — the only kind that is cached and the only kind that is "known". */
type Known<T> = Exclude<CrawlerRead<T>, { kind: 'unknown' }>;

interface Entry<T> {
  /** The last definitive answer, of any age. */
  known: Known<T> | null;
  /** When `known` was read. */
  knownAt: number;
  /** When the last read failed, or `null` if the last read succeeded. */
  failedAt: number | null;
  /** The read in progress, so concurrent requests share it. */
  inFlight: Promise<CrawlerRead<T>> | null;
  /** When `inFlight` started. */
  inFlightSince: number;
}

export interface CrawlerPolicyReaderDeps {
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly now: () => number;
  /** The backend's address, host only. Read per request, never captured. */
  readonly baseUrl: () => string;
  /** Resolves after `ms`. The budget a stale value's refresh is raced against. */
  readonly delay: (ms: number) => Promise<void>;
}

export interface CrawlerPolicyReader {
  /**
   * The default robots policy of `channelCode`, or of the system-default
   * channel when the request named none.
   */
  robotsPolicy(channelCode: string | undefined): Promise<RobotsPolicyRead>;
  /**
   * What the crawler files of `channelCode` are built from, or those of the
   * system-default channel when the request named none.
   */
  crawlerFiles(channelCode: string | undefined): Promise<CrawlerFilesRead>;
  /** How many channels' policies are held. For tests. */
  cachedChannelCount(): number;
  /** How many channels' crawler files are held. For tests. */
  cachedCrawlerFilesCount(): number;
}

/**
 * The cache key for a channel.
 *
 * "No channel named" is its own key and cannot collide with any code a request
 * could carry — including the empty string and the literal `undefined` — which
 * is what keeps one channel's answer from being served for another.
 */
function channelKey(channelCode: string | undefined): string {
  return channelCode === undefined ? 'default' : `code:${channelCode}`;
}

/** Whether a `503` body is the platform saying the owning module is switched off. */
function saysModuleDisabled(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === 'MODULE_DISABLED';
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** One question this reader can ask the backend about a channel. */
export interface Question<T> {
  /** The backend route that answers it. */
  readonly path: string;
  /**
   * The value in a `200` body, or `null` when the body is not one. Only the
   * members this storefront was written for leave it.
   */
  readonly parse: (body: unknown) => T | null;
}

export interface ChannelCache<T> {
  read(channelCode: string | undefined): Promise<CrawlerRead<T>>;
  size(): number;
}

/**
 * The cache for one question: its own entries, its own bound, and every rule
 * the module doc states.
 *
 * Exported for the one other per-channel fact a crawler file is built from —
 * whether a page it lists is served (`llms-txt-pages.ts`) — so that it is
 * remembered on exactly these terms rather than on a second set.
 */
export function createChannelCache<T>(deps: CrawlerPolicyReaderDeps, question: Question<T>): ChannelCache<T> {
  const entries = new Map<string, Entry<T>>();

  /** One read of the backend, classified. `null` means unreadable. */
  async function ask(channelCode: string | undefined): Promise<Known<T> | null> {
    let response: Response;
    try {
      response = await deps.fetch(`${deps.baseUrl()}${question.path}`, {
        headers: {
          accept: 'application/json',
          ...channelHeaders(channelCode),
        },
        // This module is the cache; nothing underneath it may be one too.
        cache: 'no-store',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch {
      return null;
    }

    if (response.status === 404) return { kind: 'none' };
    if (response.status === 503) {
      return saysModuleDisabled(await jsonOrNull(response)) ? { kind: 'none' } : null;
    }
    if (response.status !== 200) return null;

    const value = question.parse(await jsonOrNull(response));
    return value === null ? null : { kind: 'value', value };
  }

  /** Drop one entry to make room. See {@link MAX_CACHED_CHANNELS} for the order. */
  function evictOne(): void {
    let holdsNoPolicy: string | undefined;
    let oldest: string | undefined;
    // A Map iterates in insertion order, and a successful read re-inserts its
    // entry, so the first key of each kind is the one read longest ago.
    for (const [key, entry] of entries) {
      if (entry.known === null) {
        entries.delete(key);
        return;
      }
      if (entry.known.kind === 'none') holdsNoPolicy ??= key;
      oldest ??= key;
    }
    const victim = holdsNoPolicy ?? oldest;
    if (victim !== undefined) entries.delete(victim);
  }

  function entryFor(key: string): Entry<T> {
    const existing = entries.get(key);
    if (existing) return existing;
    if (entries.size >= MAX_CACHED_CHANNELS) evictOne();
    const created: Entry<T> = {
      known: null,
      knownAt: 0,
      failedAt: null,
      inFlight: null,
      inFlightSince: 0,
    };
    entries.set(key, created);
    return created;
  }

  return {
    size: () => entries.size,

    async read(channelCode) {
      const key = channelKey(channelCode);
      const entry = entryFor(key);
      const lastKnown = (): CrawlerRead<T> => entry.known ?? { kind: 'unknown' };

      const now = deps.now();
      if (entry.known !== null && now - entry.knownAt < FRESH_FOR_MS) return entry.known;
      if (entry.failedAt !== null && now - entry.failedAt < FAILURE_BACKOFF_MS) return lastKnown();

      // A read older than any read can be is one this process was frozen
      // under. It is given up here, and — because it is no longer the entry's
      // read in progress — whatever it answers later is ignored below.
      const abandoned =
        entry.inFlight !== null && now - entry.inFlightSince >= IN_FLIGHT_ABANDONED_AFTER_MS;

      if (entry.inFlight === null || abandoned) {
        entry.inFlightSince = now;
        // `ask` turns every failure into `null`; the `catch` is for whatever it
        // did not foresee. This promise never rejects, which is what makes it
        // safe to leave running after the request that started it has answered.
        const started: Promise<CrawlerRead<T>> = ask(channelCode)
          .catch(() => null)
          .then((answer) => {
            // Superseded: a later read took this one's place, and its answer —
            // older than anything that read brings — changes nothing.
            if (entry.inFlight !== started) return lastKnown();
            if (answer === null) {
              entry.failedAt = deps.now();
            } else {
              // Recorded on the entry whatever happens next, so every request
              // that waited for this read is told what the backend answered.
              entry.known = answer;
              entry.knownAt = deps.now();
              entry.failedAt = null;

              // Whether the cache keeps it is a separate question, because
              // this entry may have been evicted while its read was running —
              // an entry that holds nothing is the first to go.
              if (entries.get(key) === entry) {
                // Most recently read goes last, so it is the last to be evicted.
                entries.delete(key);
                entries.set(key, entry);
              }
              // An evicted entry's answer is not kept. Eviction only happens
              // when the cache is full, and it stays full, so there are two
              // cases and both end here: a later read of this channel holds
              // the place, and this answer is the older of the two; or the
              // place went to another channel, and a late answer does not get
              // to evict anything — putting every such entry back is how asking
              // for many codes at once would grow the cache without limit.
            }
            entry.inFlight = null;
            return lastKnown();
          });
        entry.inFlight = started;
      }
      const refresh = entry.inFlight;

      // Nothing is known: there is nothing to serve meanwhile, so wait (the
      // read has its own limit, and the back-off spares the requests after it).
      const stale = entry.known;
      if (stale === null) return refresh;

      // Something is known: the refresh gets what is left of its budget.
      const left = STALE_REFRESH_BUDGET_MS - (now - entry.inFlightSince);
      if (left <= 0) return stale;
      return Promise.race([refresh, deps.delay(left).then(() => stale)]);
    },
  };
}

export function createCrawlerPolicyReader(deps: CrawlerPolicyReaderDeps): CrawlerPolicyReader {
  const policies = createChannelCache<RobotsPolicy>(deps, {
    path: ROBOTS_POLICY_PATH,
    parse: (body) =>
      isRobotsPolicyResponse(body) ? { index: body.data.index, follow: body.data.follow } : null,
  });
  const files = createChannelCache<CrawlerFiles>(deps, {
    path: CRAWLER_FILES_PATH,
    parse: (body) =>
      isCrawlerFilesResponse(body)
        ? {
            index: body.data.index,
            follow: body.data.follow,
            robotsTxtCustom: body.data.robotsTxtCustom,
            llmsTxtAdditional: body.data.llmsTxtAdditional,
            shop: { name: body.data.shop.name },
            // Carried only when it says something, so "everything was read"
            // has one shape whether the backend sent an empty list or none.
            ...(body.data.unreadable !== undefined && body.data.unreadable.length > 0
              ? { unreadable: [...body.data.unreadable] }
              : {}),
            // Carried as the backend said it, and not invented when it did not.
            ...(body.data.anonymousAccess !== undefined
              ? { anonymousAccess: body.data.anonymousAccess }
              : {}),
          }
        : null,
  });

  return {
    robotsPolicy: (channelCode) => policies.read(channelCode),
    crawlerFiles: (channelCode) => files.read(channelCode),
    cachedChannelCount: () => policies.size(),
    cachedCrawlerFilesCount: () => files.size(),
  };
}

/** What this process reads the backend with. */
export const PROCESS_READER_DEPS: CrawlerPolicyReaderDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  baseUrl: backendBaseUrl,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const reader = createCrawlerPolicyReader(PROCESS_READER_DEPS);

/** This process's reader. See the module doc for what it remembers and for how long. */
export function readRobotsPolicy(channelCode: string | undefined): Promise<RobotsPolicyRead> {
  return reader.robotsPolicy(channelCode);
}

/**
 * What `channelCode`'s crawler files are built from, read through this
 * process's reader.
 */
export function readCrawlerFiles(channelCode: string | undefined): Promise<CrawlerFilesRead> {
  return reader.crawlerFiles(channelCode);
}
