/**
 * Which sales channel this storefront is on, and whether that channel is open
 * to anonymous visitors — as the middleware needs to know it, before a page is
 * rendered (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.1,
 * §2).
 *
 * The answer is `GET /api/v1/storefront/sales-channel`, asked with the
 * request's `x-sales-channel` when a proxy stamped one and without it when none
 * did — in which case the backend resolves the channel it would resolve for any
 * call from this storefront, and its code is what the middleware stamps.
 *
 * It is remembered on exactly the terms the crawler policy is
 * (`lib/seo/crawler-policy.ts`, `createChannelCache`): per process, per channel,
 * fresh for a minute, never rejecting, never making a request wait on a backend
 * that does not answer once something is known, bounded against invented codes.
 * Reusing that seam rather than writing a second one is the point — a second
 * set of rules about the same backend from the same middleware is a second set
 * to get wrong. The identity changes at operator speed; a minute is the window
 * in which closing or opening a store reaches the storefront's redirect. The
 * backend applies the change at once on every call either way.
 *
 * Middleware-safe: no `next/headers`, no validation library.
 */

import type { ChannelUrlLanguage, ChannelUrlLanguageAlias } from '@endora-commerce/contracts';
import {
  createChannelCache,
  PROCESS_READER_DEPS,
  type CrawlerPolicyReaderDeps,
  type CrawlerRead,
} from '../seo/crawler-policy';

export interface ChannelIdentity {
  /** The resolved channel's code — what the middleware stamps. */
  readonly code: string;
  /** `false` when the channel serves signed-in customers only. */
  readonly anonymousAccess: boolean;
  /** Whether the default language carries its URL prefix (feature 167). */
  readonly prefixDefaultLanguage: boolean;
  /**
   * The channel's URL languages as the backend derived them (feature 167, FR-004).
   * Empty when the backend did not answer them — language handling is then off
   * (FR-019): no redirect is better than a wrong one.
   */
  readonly urlLanguages: readonly ChannelUrlLanguage[];
  readonly urlLanguageAliases: readonly ChannelUrlLanguageAlias[];
}

const PREFIX = /^[a-z]{2,3}(-[a-z0-9]{1,8})*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The well-formed URL languages of a body, or `[]` when there is no usable list. */
function parseUrlLanguages(value: unknown): ChannelUrlLanguage[] {
  if (!Array.isArray(value)) return [];
  const out: ChannelUrlLanguage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { languageCode, prefix, prefixed, isDefault } = entry;
    if (typeof languageCode !== 'string' || languageCode === '') continue;
    if (typeof prefix !== 'string' || !PREFIX.test(prefix)) continue;
    if (typeof prefixed !== 'boolean' || typeof isDefault !== 'boolean') continue;
    out.push({ languageCode, prefix, prefixed, isDefault });
  }
  // A list without exactly one default cannot be acted on.
  return out.filter((l) => l.isDefault).length === 1 ? out : [];
}

function parseUrlLanguageAliases(value: unknown): ChannelUrlLanguageAlias[] {
  if (!Array.isArray(value)) return [];
  const out: ChannelUrlLanguageAlias[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { alias, languageCodes } = entry;
    if (typeof alias !== 'string' || !/^[a-z]{2,3}$/.test(alias)) continue;
    if (!Array.isArray(languageCodes) || languageCodes.length < 2) continue;
    if (!languageCodes.every((c): c is string => typeof c === 'string')) continue;
    out.push({ alias, languageCodes });
  }
  return out;
}

export type ChannelIdentityRead = CrawlerRead<ChannelIdentity>;

/** The backend route the identity is read from. */
export const CHANNEL_IDENTITY_PATH = '/api/v1/storefront/sales-channel';

/**
 * The members this storefront reads, from a `200` body, or `null`.
 *
 * A backend that predates the flag answers no `anonymousAccess`; that channel
 * is open, as every channel was before the flag existed. One that predates
 * feature 167 answers no URL languages; the identity then carries none and the
 * middleware does no language handling. Malformed URL-language entries are
 * dropped, never trusted.
 */
export function parseChannelIdentity(body: unknown): ChannelIdentity | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { code, anonymousAccess, prefixDefaultLanguage, urlLanguages, urlLanguageAliases } = data as Record<
    string,
    unknown
  >;
  if (typeof code !== 'string' || code === '') return null;
  if (anonymousAccess !== undefined && typeof anonymousAccess !== 'boolean') return null;
  return {
    code,
    anonymousAccess: anonymousAccess ?? true,
    prefixDefaultLanguage: typeof prefixDefaultLanguage === 'boolean' ? prefixDefaultLanguage : true,
    urlLanguages: parseUrlLanguages(urlLanguages),
    urlLanguageAliases: parseUrlLanguageAliases(urlLanguageAliases),
  };
}

export interface ChannelIdentityReader {
  read(channelCode: string | undefined): Promise<ChannelIdentityRead>;
}

export function createChannelIdentityReader(deps: CrawlerPolicyReaderDeps): ChannelIdentityReader {
  const cache = createChannelCache<ChannelIdentity>(deps, {
    path: CHANNEL_IDENTITY_PATH,
    parse: parseChannelIdentity,
  });
  return { read: (channelCode) => cache.read(channelCode) };
}

const reader = createChannelIdentityReader(PROCESS_READER_DEPS);

/** This process's answer for `channelCode`, or for the channel resolved without one. */
export function readChannelIdentity(channelCode: string | undefined): Promise<ChannelIdentityRead> {
  return reader.read(channelCode);
}
