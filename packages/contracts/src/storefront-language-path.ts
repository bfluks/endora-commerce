import { z } from 'zod';

/**
 * Feature 167 (`specs/167-storefront-locale-path/`, issue #396) — the language of a
 * storefront page is the first segment of its path (`/pl/p/wiertarka`, `/en/p/drill`).
 *
 * This module is the **one** derivation of a channel's URL language prefixes
 * (`contracts/url-shape.md` §2) and the one composer of a storefront page path in a
 * language. The backend answers the derived prefixes on the public channel read, so the
 * storefront never re-derives them; every backend emitter composes its storefront URLs
 * through {@link storefrontPagePath}. Nothing is stored: a prefix is a function of the
 * channel's languages and its *prefix the default language* setting, so it cannot drift
 * from them.
 *
 * A leaf: imports only `zod`.
 */

/** What a URL composer needs to know about a channel. `CachedChannel` and `PublicSalesChannel` satisfy it. */
export interface ChannelUrlFacts {
  readonly languages: readonly string[];
  readonly defaultLanguage: string;
  readonly prefixDefaultLanguage: boolean;
}

/** The prefix grammar of `url-shape.md` §1: a lower-case primary subtag, optionally the full lower-case tag. */
export const URL_LANGUAGE_PREFIX_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/;

export const channelUrlLanguageSchema = z.object({
  languageCode: z.string().min(1).max(16),
  prefix: z.string().regex(URL_LANGUAGE_PREFIX_PATTERN),
  /** `false` only for the default language with `prefixDefaultLanguage` off. */
  prefixed: z.boolean(),
  isDefault: z.boolean(),
});
export type ChannelUrlLanguage = z.infer<typeof channelUrlLanguageSchema>;

/**
 * A primary subtag shared by several channel languages (`en` for `en-US` and `en-GB`).
 * It is no language's prefix, but a request under it is answered 307 to one of its
 * languages (FR-015), so links taken before the channel gained the second variant keep
 * working.
 */
export const channelUrlLanguageAliasSchema = z.object({
  alias: z.string().regex(/^[a-z]{2,3}$/),
  languageCodes: z.array(z.string()).min(2),
});
export type ChannelUrlLanguageAlias = z.infer<typeof channelUrlLanguageAliasSchema>;

function primarySubtag(code: string): string {
  return code.split('-')[0]!.toLowerCase();
}

/** The channel's languages in channel order, the default language included (first when absent). */
function orderedLanguages(channel: ChannelUrlFacts): string[] {
  const list = [...channel.languages];
  const hasDefault = list.some((code) => code.toLowerCase() === channel.defaultLanguage.toLowerCase());
  if (!hasDefault) list.unshift(channel.defaultLanguage);
  const seen = new Set<string>();
  for (const code of list) {
    const key = code.toLowerCase();
    if (seen.has(key)) throw new Error(`channelUrlLanguages: duplicate language code "${code}"`);
    seen.add(key);
  }
  return list;
}

/**
 * The URL language of every channel language (`url-shape.md` §2): the lower-case primary
 * subtag when it is the only channel language with that subtag, else the full lower-case
 * tag. Channel order, the default language included. Throws on a case-insensitive
 * duplicate code, which the channel validator already refuses.
 */
export function channelUrlLanguages(channel: ChannelUrlFacts): ChannelUrlLanguage[] {
  const languages = orderedLanguages(channel);
  const perPrimary = new Map<string, number>();
  for (const code of languages) {
    const primary = primarySubtag(code);
    perPrimary.set(primary, (perPrimary.get(primary) ?? 0) + 1);
  }
  const defaultKey = channel.defaultLanguage.toLowerCase();
  return languages.map((code) => {
    const primary = primarySubtag(code);
    const isDefault = code.toLowerCase() === defaultKey;
    return {
      languageCode: code,
      prefix: perPrimary.get(primary) === 1 ? primary : code.toLowerCase(),
      prefixed: !(isDefault && !channel.prefixDefaultLanguage),
      isDefault,
    };
  });
}

/** The split aliases of a channel (FR-015): each primary subtag shared by two or more channel languages. */
export function channelUrlLanguageAliases(channel: ChannelUrlFacts): ChannelUrlLanguageAlias[] {
  const groups = new Map<string, string[]>();
  for (const code of orderedLanguages(channel)) {
    const primary = primarySubtag(code);
    groups.set(primary, [...(groups.get(primary) ?? []), code]);
  }
  return [...groups.entries()]
    .filter(([, codes]) => codes.length >= 2)
    .map(([alias, languageCodes]) => ({ alias, languageCodes }));
}

function assertLogicalPath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`storefrontPagePath: "${path}" is not a root-relative storefront path`);
  }
}

/**
 * The storefront path of a page in a language. `path` is a **logical** path — today's
 * route (`/`, `/c/x`, `/p/k?variant=A`); the answer is `/<prefix>` + path when the
 * language is prefixed (`/<prefix>` alone for `/`), else `path`. The query and fragment
 * are kept verbatim. Throws on a language the channel does not have: an emitter asking
 * for one has a bug.
 */
export function storefrontPagePath(input: {
  path: string;
  languageCode: string;
  channel: ChannelUrlFacts;
}): string {
  assertLogicalPath(input.path);
  const wanted = input.languageCode.toLowerCase();
  const language = channelUrlLanguages(input.channel).find((l) => l.languageCode.toLowerCase() === wanted);
  if (language === undefined) {
    throw new Error(`storefrontPagePath: language "${input.languageCode}" is not a language of the channel`);
  }
  if (!language.prefixed) return input.path;
  const rest = /^\/(?=[?#]|$)/.test(input.path) ? input.path.slice(1) : input.path;
  return `/${language.prefix}${rest}`;
}

/** The unprefixed URL of a logical path — the `x-default` target in both setting states (`url-shape.md` §8). */
export function storefrontDefaultPath(path: string): string {
  assertLogicalPath(path);
  return path;
}

/**
 * The storefront path of a page for a **message** (an e-mail link, a redirect a
 * backend route answers) — feature 167, FR-034. The language is the one the message
 * is rendered in when the channel serves it (exact tag, then primary subtag), else
 * the channel's default language. With no channel known the logical path is answered
 * unchanged: the storefront's redirects then choose the language.
 */
export function storefrontPagePathFor(input: {
  path: string;
  channel: ChannelUrlFacts | null | undefined;
  requestedLanguage?: string | null | undefined;
}): string {
  assertLogicalPath(input.path);
  if (!input.channel) return input.path;
  const languages = channelUrlLanguages(input.channel);
  const wanted = input.requestedLanguage?.trim().toLowerCase() ?? '';
  const primary = wanted.split('-')[0];
  const match =
    (wanted === '' ? undefined : languages.find((l) => l.languageCode.toLowerCase() === wanted)) ??
    (wanted === '' ? undefined : languages.find((l) => l.languageCode.split('-')[0]!.toLowerCase() === primary)) ??
    languages.find((l) => l.isDefault)!;
  return storefrontPagePath({ path: input.path, languageCode: match.languageCode, channel: input.channel });
}
