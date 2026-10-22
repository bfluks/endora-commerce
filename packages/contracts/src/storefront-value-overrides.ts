import { SYSTEM_ATTRIBUTE_SCOPES } from './catalog.js';
import {
  isNonEmpty,
  resolveAttribute,
  type AttributeScope,
  type OverrideRow,
} from './product-value-resolver.js';

/**
 * Issue #384 — which per-(sales channel, language) override (features 022/023)
 * a storefront read shows, given the override rows it already holds.
 *
 * Shared by every storefront read that shows a product's name — `catalog`'s
 * product page and listing cards, and `search`'s result cards — so one product
 * cannot show two names depending on which module answered the page.
 *
 * **Only the override slots are taken from the resolver.** The fallback chain
 * is {@link resolveAttribute}, and this file adds no second implementation of
 * it. What it deliberately does *not* take from the resolver is the baseline
 * leg: the storefront reads have always walked their own language fallback
 * over the baseline JSONB (`preferred` → the channel's default language →
 * `en-US` → `en` → first key), which differs from the resolver's
 * (`languageCode` → primary language → first sorted key) in its edges.
 * Replacing it would change what every product *without* an override shows,
 * so an override answers here only when the resolver says a channel slot
 * produced the value, and the caller's existing baseline pick answers
 * otherwise. The baseline is still read for one thing — where that pick
 * stops — so an override never answers for a later language than the one
 * whose baseline text the page would show.
 */

/** The request's resolution context, as the storefront reads hold it. */
export interface StorefrontOverrideContext {
  channelId: string;
  /**
   * The language chain the caller's baseline pick walks, in order — see
   * {@link overrideLanguages}. A (channel, language) override is looked up at
   * each leg until the baseline has a value for one; the pick's first-key tail
   * is derived from the baseline itself. Empty when nothing is known: only the
   * baseline's first key and the channel-only slot can answer.
   */
  languages: readonly string[];
}

/**
 * The ordered, de-duplicated language chain the storefront's baseline pick
 * walks: the `Accept-Language` pick, the channel's default language, `en-US`,
 * `en`. A caller whose pick has no channel-default leg passes `undefined` for
 * it, so the override walk mirrors exactly the pick it sits on.
 */
export function overrideLanguages(
  preferredLanguage: string | undefined,
  channelDefaultLanguage: string | undefined,
): string[] {
  return [...new Set([preferredLanguage, channelDefaultLanguage, 'en-US', 'en'])].filter(
    (l): l is string => typeof l === 'string' && l.length > 0,
  );
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Whether the baseline answers at `language` — where the caller's pick stops.
 * A per-language record answers where it holds a value (an empty string does
 * not stop the pick, as in the callers' `if (hit)`); a language-agnostic scalar
 * answers at every leg; an absent baseline answers at none.
 */
function baselineAnswersAt(baseline: unknown, language: string): boolean {
  if (isPlainRecord(baseline)) return isNonEmpty(baseline[language]);
  return isNonEmpty(baseline);
}

/**
 * The override value for one attribute in this context, or `undefined` when no
 * channel slot applies and the caller's baseline should stand.
 *
 * The walk is the baseline pick's own, with the override slot looked at first
 * at every leg: for each language L of `ctx.languages`, a (channel, L)
 * override answers; else, if the baseline has a value for L, the walk stops
 * there. When no leg stopped it and the baseline is a per-language record, its
 * first key — the pick's tail — is the last leg. So an override for a later
 * language never beats a baseline value for an earlier one. Whatever the walk
 * stopped on, the channel-only slot is asked last, exactly as it always was.
 *
 * `baseline` is the raw value the caller's pick reads: `products.name` /
 * `products.description` for the system text, `attributeValues[key]` for a
 * user attribute.
 */
export function channelOverrideFor(
  overrides: readonly OverrideRow[] | undefined,
  attributeKey: string,
  scope: AttributeScope,
  ctx: StorefrontOverrideContext,
  baseline: unknown,
): unknown {
  if (!overrides || overrides.length === 0) return undefined;
  const resolve = (languageCode: string | null) =>
    resolveAttribute({
      attributeKey,
      // No baseline: the baseline leg is the caller's (see the file comment).
      baseline: undefined,
      overrides,
      scope,
      ctx: {
        channelId: ctx.channelId,
        languageCode,
        // Unused: with no baseline, the resolver's primary-language leg cannot answer.
        primaryLanguage: languageCode ?? '',
      },
    });
  const languageSlot = (languageCode: string): unknown => {
    const resolved = resolve(languageCode);
    return resolved.source === 'channel+language' ? resolved.value : undefined;
  };
  let stopped = false;
  for (const languageCode of ctx.languages) {
    const v = languageSlot(languageCode);
    if (v !== undefined) return v;
    if (baselineAnswersAt(baseline, languageCode)) {
      stopped = true;
      break;
    }
  }
  if (!stopped && isPlainRecord(baseline)) {
    const firstKey = Object.keys(baseline)[0];
    if (firstKey !== undefined) {
      const v = languageSlot(firstKey);
      if (v !== undefined) return v;
    }
  }
  const channelOnly = resolve(null);
  return channelOnly.source === 'channel' ? channelOnly.value : undefined;
}

/**
 * The effective Name or Description: the channel override when one applies
 * and is a non-empty string, else `baselineText` — the caller's existing
 * language pick over `baseline`, the JSONB it picked from. The pick is kept
 * the caller's so a product without overrides shows byte-identical text.
 */
export function effectiveSystemText(
  overrides: readonly OverrideRow[] | undefined,
  attributeKey: 'name' | 'description',
  ctx: StorefrontOverrideContext,
  baseline: Readonly<Record<string, string>>,
  baselineText: string,
): string {
  const v = channelOverrideFor(
    overrides,
    attributeKey,
    SYSTEM_ATTRIBUTE_SCOPES[attributeKey]!,
    ctx,
    baseline,
  );
  return typeof v === 'string' && v.length > 0 ? v : baselineText;
}
