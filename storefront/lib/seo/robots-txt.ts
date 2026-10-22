/**
 * `GET /robots.txt` — the decision, apart from the route file that serves it
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §4).
 *
 * ```text
 * <the system-generated rules, as lib/seo/robots-system-rules.ts renders them>
 * <a blank line>
 * <the sales channel's custom instructions>
 * ```
 *
 * The first part is this storefront's and is always served. The second is an
 * operator's, per sales channel, read from the `seo` module; with none, the
 * file is the first part byte for byte, which is what it was before operators
 * could add to it. The join is `composeCrawlerFile` from
 * `@endora-commerce/contracts` — the same function the Admin UI previews the
 * file with — and it is also where "the text as written" is defined: every
 * character is served unchanged, except that a line break is always a line
 * feed, the text ends with exactly one, and a byte order mark at its very
 * start is not served.
 *
 * ## The five answers
 *
 * | What is known about the channel | Served |
 * | --- | --- |
 * | its custom instructions, read now or remembered from an earlier read | `200`, the system rules and the instructions |
 * | that there are none — `seo` is switched off, or the backend has no such feature | `200`, the system rules alone |
 * | nothing: the backend could not be asked and never has been | **`503`** with `Retry-After` |
 * | that the store is closed to anonymous visitors | `200`, `Disallow: /` for every crawler and nothing else |
 * | `?part=system`, whatever is known | `200`, the system rules alone, **without asking**, and `no-store` |
 *
 * ## Why the third row is a failure and not the system rules
 *
 * A page that cannot learn its channel's default robots is served anyway. This
 * file is different, on purpose (FR-022): a `200` is a complete statement of
 * what a crawler may fetch, so a `200` without an operator's `Disallow` lines
 * is permission the operator did not give — and nothing would show that it had
 * been given. A `503` is read by a search engine as "ask again later": it
 * keeps the copy it has and crawls no more than that allowed. No customer
 * reads this file, so the failure costs nobody a page.
 *
 * It lasts only until the first successful read — a process that has read a
 * channel's instructions once serves that version for as long as it cannot
 * read a newer one.
 *
 * ## What the default robots policy does here: nothing
 *
 * A channel set to `noindex` keeps an open `robots.txt` (FR-015). A crawler has
 * to be allowed to fetch a page in order to read that it must not be indexed;
 * closing the file would hide the directive that does the work. The policy is
 * in the answer this module reads and is not looked at — nor is whether it
 * could be read: a channel whose default robots is a value nobody can
 * interpret keeps its `robots.txt` (see `CrawlerFiles.unreadable`).
 *
 * ## Who may keep the answer
 *
 * The file is one sales channel's, and the channel is named by a request
 * header. So the `200` says `Vary: X-Sales-Channel` beside its
 * `public, max-age=60`, and that is only as good as what stands in front of
 * this storefront: a proxy that serves several channels has to set the header
 * itself rather than pass a client's through, and a shared cache that ignores
 * `Vary` on such a header has to key on it or leave the file alone.
 *
 * `?part=system` is `no-store`. It is the file without the operator's
 * instructions, at an address that differs from the real one by a query
 * string only — and a cache set up to ignore query strings would file it
 * under `/robots.txt`. Only the Admin UI's preview asks for it.
 *
 * The handler asks nothing of the backend for `?part=system`. The request as
 * a whole is not free of it: the middleware in front of this route still reads
 * the channel's default robots policy for the response header, and waits for
 * that read on a process that knows nothing yet.
 *
 * ## The text is an operator's, and it is served as text
 *
 * See `crawler-file-response.ts`, which holds what this file's answers share
 * with `llms.txt`'s: the headers and the temporary failure.
 */

import { composeCrawlerFile } from '@endora-commerce/contracts/seo';

import {
  CRAWLER_FILE_RETRY_AFTER_SECONDS,
  crawlerFileGeneratedPart,
  crawlerFileServed,
  crawlerFileUnavailable,
  requestChannelCode,
} from './crawler-file-response';
import type { CrawlerFiles, CrawlerFilesRead } from './crawler-policy';
import { renderClosedStoreRobotsTxt, renderRobotsSystemRules } from './robots-system-rules';

export { CRAWLER_FILES_CAPABILITY_HEADER } from './crawler-file-response';

/** How long a crawler is asked to wait before asking again, on `503`. */
export const ROBOTS_TXT_RETRY_AFTER_SECONDS = CRAWLER_FILE_RETRY_AFTER_SECONDS;

export interface RobotsTxtDeps {
  /** The channel's crawler files, through the per-process reader. Never rejects. */
  readonly readCrawlerFiles: (channelCode: string | undefined) => Promise<CrawlerFilesRead>;
}

/**
 * The file composed for a configuration, kept for as long as the reader holds
 * that configuration.
 *
 * Keyed by the configuration **object**: the reader hands out the same object
 * for a channel until a read replaces it, so a kept file cannot outlive the
 * text it was made from, cannot be another channel's, and is collected with
 * the cache entry it belongs to. The system rules are kept beside it because
 * they are rendered per request and are compared, not assumed.
 */
const composed = new WeakMap<CrawlerFiles, { systemRules: string; body: string }>();

function fileFor(systemRules: string, configuration: CrawlerFiles): string {
  const kept = composed.get(configuration);
  if (kept !== undefined && kept.systemRules === systemRules) return kept.body;
  const body = composeCrawlerFile(systemRules, configuration.robotsTxtCustom);
  composed.set(configuration, { systemRules, body });
  return body;
}

export async function robotsTxtResponse(request: Request, deps: RobotsTxtDeps): Promise<Response> {
  const systemRules = renderRobotsSystemRules();

  // The system-generated rules alone. Answered from this storefront's own
  // sources, so it answers while the backend is down.
  if (new URL(request.url).searchParams.get('part') === 'system') {
    return crawlerFileGeneratedPart(systemRules);
  }

  const read = await deps.readCrawlerFiles(requestChannelCode(request));

  // Not a robots.txt, and not shaped like one: nothing in it is a rule.
  if (read.kind === 'unknown') return crawlerFileUnavailable('robots.txt');

  if (read.kind === 'none') return crawlerFileServed(systemRules);
  // A store closed to anonymous visitors has nothing a crawler may fetch. The
  // closed-store file wins over the operator's instructions, which are not
  // served on it — see `renderClosedStoreRobotsTxt`.
  if (read.value.anonymousAccess === false) return crawlerFileServed(renderClosedStoreRobotsTxt());
  // `read.value.unreadable` is not looked at: what the backend can name there
  // — the default robots policy, the `llms.txt` content — is nothing this
  // file is made of.
  return crawlerFileServed(fileFor(systemRules, read.value));
}
