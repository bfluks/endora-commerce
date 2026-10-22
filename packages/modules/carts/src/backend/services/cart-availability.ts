import {
  resolveScopeLanguage,
  type CatalogProductAvailabilityPort,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 163 — the basket's questions to `catalogProductAvailabilityPort`
 * (`specs/163-product-data-scopes/contracts/consumers.md` rows 13–14).
 *
 * The availability rule is `catalog`'s; nothing here tests a status, a window
 * or an audience. What this file owns is which (channel, language, audience)
 * a basket asks about.
 */

/**
 * The scope language L of a basket seam: the request's language tag resolved
 * against the request channel's own languages when the basket is on that
 * channel, else `null` — the channel's default language (an operator naming a
 * customer's channel, or a seam outside a request). The channel record is the
 * resolver's (Constitution XII), never the client's.
 */
export function basketScopeLanguage(channelId: string, languageTag: string | undefined): string | null {
  const channel = currentSalesChannel();
  if (!channel || channel.id !== channelId) return null;
  const languages = channel.languages.includes(channel.defaultLanguage)
    ? channel.languages
    : [channel.defaultLanguage, ...channel.languages];
  return resolveScopeLanguage({ id: channel.id, languages, defaultLanguage: channel.defaultLanguage }, languageTag);
}

/**
 * The records among `records` whose product is available at the basket's
 * (channel, L) to `audience` now. A record left out reads as a product with no
 * record — `product_unavailable` to the minimums rule, the unknown-id answer to
 * a buyer — so "switched off", "outside its window", "restricted" and "gone"
 * stay one answer (FR-006).
 *
 * A basket with no channel is not asked about (FR-007: the port never answers
 * for an unresolved channel); its records are returned as they are.
 */
export async function availableRecords<T extends { id: string }>(
  availability: Pick<CatalogProductAvailabilityPort, 'filterAvailable'>,
  records: readonly T[],
  scope: { channelId: string | null | undefined; languageCode: string | null; audience: ProductAudience },
): Promise<T[]> {
  if (records.length === 0 || !scope.channelId) return [...records];
  const available = await availability.filterAvailable(
    records.map((r) => r.id),
    { channelId: scope.channelId, languageCode: scope.languageCode, audience: scope.audience },
  );
  return records.filter((r) => available.has(r.id));
}

/** The first `Accept-Language` tag without its quality parameter, or `undefined`. */
export function firstLanguageTag(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const first = value.split(',')[0]?.split(';')[0]?.trim();
  return first === '' ? undefined : first;
}
