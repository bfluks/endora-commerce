import {
  CRAWLER_FILES_UNREADABLE_LLMS_TXT,
  CRAWLER_FILES_UNREADABLE_POLICY,
  CRAWLER_TEXT_MAX_BYTES,
  type StorefrontCrawlerFiles,
  type StorefrontRobotsPolicy,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import {
  DEFAULT_ROBOTS_SETTING_CODE,
  UnknownRobotsTokenError,
  robotsPolicyForToken,
} from './robots-policy.js';

/**
 * What a sales channel's crawler files are built from
 * (`specs/144-seo-search-engine-robots/contracts/crawler-policy.md` §2).
 *
 * The storefront owns the files: it generates the system rules, joins the
 * operator's text to them and serves the result. This module owns what the
 * operator configured, and answers it for one channel at a time.
 *
 * ## The text leaves here exactly as it was stored
 *
 * No trimming and no line-break rewriting. What a served file does with the
 * text is `composeCrawlerFile`'s to say, in `@endora-commerce/contracts`, where
 * the storefront and the Admin UI's preview both read it; rewriting here as
 * well would be a second definition of the same thing.
 *
 * ## It never answers something it cannot stand behind — and its parts fail apart
 *
 * Every answer at `200` is definitive to a storefront: it replaces whatever
 * the storefront knew. So nothing here is ever answered as if it had been
 * read when it was not. What happens instead depends on who reads the member:
 *
 *  * **The `robots.txt` instructions** are read by every storefront that has
 *    this endpoint. A stored value that is not a text, or is longer than the
 *    write door accepts, is a **throw** — the endpoint answers `500`, the
 *    storefront keeps the file it last served, and one that knows nothing
 *    answers `robots.txt` with a temporary failure instead of a file that
 *    silently omits the operator's rules (FR-022).
 *  * **The default robots policy and the `llms.txt` content** are read only by
 *    `llms.txt`. An unreadable one is **named** in `unreadable` and the rest is
 *    answered: `robots.txt` reads neither, and a *Default robots* row holding
 *    a value nobody can interpret must not cost a channel its `robots.txt`
 *    (FR-015 — the policy has no say in that file). `llms.txt` is not served
 *    while either is named.
 *
 * The policy is then answered as `index: false, follow: false`. That is not a
 * guess at the value: it is the reading under which a consumer that does not
 * know `unreadable` errs towards keeping a channel out, never towards
 * inviting anyone in.
 *
 * "Unreadable" is about the **value**. A settings store that cannot be asked,
 * or that has no such setting, still throws: that is an instance that is
 * wrong, not a row, and nothing here can answer for it.
 */

/** The setting an operator edits, per sales channel. */
export const ROBOTS_TXT_CUSTOM_SETTING_CODE = 'seo.robots_txt_custom';

/** The setting an operator edits, per sales channel. */
export const LLMS_TXT_ADDITIONAL_SETTING_CODE = 'seo.llms_txt_additional';

/** The reading of a policy nobody could read. See the module doc. */
const POLICY_WHEN_UNREADABLE: StorefrontRobotsPolicy = { index: false, follow: false };

/**
 * The shop's public name. Declared by the `settings` module; read here through
 * the settings store like any other value, never through that module's route
 * or resolver.
 */
const SHOP_NAME_SETTING_CODE = 'shop.name';

/** The reads this service makes of the settings store. */
export interface CrawlerFilesSettingsPort {
  get<T>(code: string, salesChannelId: string, schema: z.ZodType<T>): Promise<T>;
  getMany(
    codes: string[],
    salesChannelId: string,
  ): Promise<Map<string, { ok: true; value: unknown } | { ok: false }>>;
}

/**
 * A stored crawler text is longer than {@link CRAWLER_TEXT_MAX_BYTES}.
 *
 * The settings API refuses such a text when it is saved
 * (`crawler-text-validator.ts`), so this takes a row written around it — an
 * import, or a hand-edited database.
 */
export class StoredCrawlerTextTooLargeError extends Error {
  constructor(
    readonly settingCode: string,
    readonly actualBytes: number,
  ) {
    super(
      `"${settingCode}" holds a text of ${actualBytes} bytes, which is more than the ` +
        `${CRAWLER_TEXT_MAX_BYTES} bytes that can be saved and is not served.`,
    );
    this.name = 'StoredCrawlerTextTooLargeError';
  }
}

/**
 * A crawler text as it resolves for one sales channel, or a throw when it is
 * longer than can be saved. The storefront's read and the Admin UI's preview
 * both go through it, so the preview never shows a text the storefront would
 * refuse to serve.
 */
export async function storedCrawlerText(
  settings: Pick<CrawlerFilesSettingsPort, 'get'>,
  code: string,
  salesChannelId: string,
): Promise<string> {
  const text = await settings.get(code, salesChannelId, z.string());
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > CRAWLER_TEXT_MAX_BYTES) throw new StoredCrawlerTextTooLargeError(code, bytes);
  return text;
}

/** What this service needs of the request's resolved sales channel. */
export interface CrawlerFilesChannel {
  readonly id: string;
  /** `false` on a store closed to anonymous visitors (`specs/154-sales-channel-access/`). */
  readonly anonymousAccess: boolean;
}

/**
 * The crawler-file configuration of one sales channel.
 *
 * `channel` is the request's resolved channel. Every read below is made for
 * that channel and no other, and the settings store resolves each one as it
 * resolves any setting: the channel's own value, else the all-channels value,
 * else the declared default.
 *
 * Whether the channel is open to anonymous visitors is answered beside what
 * the operator configured, which is answered as stored either way: a closed
 * store's files — `robots.txt` disallowing everything, an `llms.txt` that
 * lists nothing — are the storefront's to build, as every other part of the
 * files is.
 */
export async function resolveCrawlerFiles(
  settings: CrawlerFilesSettingsPort,
  channel: CrawlerFilesChannel,
): Promise<StorefrontCrawlerFiles> {
  const salesChannelId = channel.id;
  const unreadable: string[] = [];

  // Read as whatever is stored and judged here, so that "the store could not
  // be asked" (a throw, below this line) and "the value is not one of the
  // four" (an answer) stay two different things.
  let policy: StorefrontRobotsPolicy;
  try {
    policy = robotsPolicyForToken(
      await settings.get(DEFAULT_ROBOTS_SETTING_CODE, salesChannelId, z.unknown()),
    );
  } catch (error) {
    if (!(error instanceof UnknownRobotsTokenError)) throw error;
    policy = { ...POLICY_WHEN_UNREADABLE };
    unreadable.push(CRAWLER_FILES_UNREADABLE_POLICY);
  }

  const robotsTxtCustom = await storedCrawlerText(
    settings,
    ROBOTS_TXT_CUSTOM_SETTING_CODE,
    salesChannelId,
  );

  let llmsTxtAdditional = '';
  const storedLlms = await settings.get(
    LLMS_TXT_ADDITIONAL_SETTING_CODE,
    salesChannelId,
    z.unknown(),
  );
  if (typeof storedLlms === 'string' && Buffer.byteLength(storedLlms, 'utf8') <= CRAWLER_TEXT_MAX_BYTES) {
    llmsTxtAdditional = storedLlms;
  } else {
    // Never the text, and never a part of it.
    unreadable.push(CRAWLER_FILES_UNREADABLE_LLMS_TXT);
  }

  // The one read that degrades instead of throwing: a shop with no name is a
  // shop with no name, and nothing a crawler file says depends on it being
  // there. `getMany` answers a missing or unreadable code per code.
  const shopName = (await settings.getMany([SHOP_NAME_SETTING_CODE], salesChannelId)).get(
    SHOP_NAME_SETTING_CODE,
  );

  return {
    ...policy,
    robotsTxtCustom,
    llmsTxtAdditional,
    shop: {
      name: shopName?.ok === true && typeof shopName.value === 'string' ? shopName.value : '',
    },
    anonymousAccess: channel.anonymousAccess,
    // Said only when there is something to say: an answer in which everything
    // was read is the shape it has always had.
    ...(unreadable.length > 0 ? { unreadable } : {}),
  };
}
