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
}

export type ChannelIdentityRead = CrawlerRead<ChannelIdentity>;

/** The backend route the identity is read from. */
export const CHANNEL_IDENTITY_PATH = '/api/v1/storefront/sales-channel';

/**
 * The two members this storefront reads, from a `200` body, or `null`.
 *
 * A backend that predates the flag answers no `anonymousAccess`; that channel
 * is open, as every channel was before the flag existed.
 */
export function parseChannelIdentity(body: unknown): ChannelIdentity | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { code, anonymousAccess } = data as { code?: unknown; anonymousAccess?: unknown };
  if (typeof code !== 'string' || code === '') return null;
  if (anonymousAccess !== undefined && typeof anonymousAccess !== 'boolean') return null;
  return { code, anonymousAccess: anonymousAccess ?? true };
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
