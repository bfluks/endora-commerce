import type { EntityManager } from '@mikro-orm/postgresql';
import {
  SYSTEM_ATTRIBUTE_SCOPES,
  channelOverrideFor,
  type AttributeScope,
  type OverrideRow,
  type StorefrontOverrideContext,
} from '@endora-commerce/contracts';

import { loadOverridesByProduct } from './product-value-resolver.service.js';

/**
 * Issue #384 — what a storefront read needs to show a product's
 * per-(sales channel, language) overrides (features 022/023).
 *
 * The slot choice itself — the language walk, and which override answers —
 * is `@endora-commerce/contracts`' `storefront-value-overrides`, shared with
 * `search`'s result cards so the two modules cannot show one product under two
 * names. Re-exported here so this module's reads name one import. What stays
 * in this file is what only `catalog` can do: read the rows, and map a
 * product's user attributes through their scopes.
 */
export {
  channelOverrideFor,
  effectiveSystemText,
  overrideLanguages,
  type StorefrontOverrideContext,
} from '@endora-commerce/contracts';

/**
 * Every override row the request's sales channel holds for a set of products,
 * in one statement, bucketed by product id. Rows are independent of the
 * viewer, so one fetch serves a whole read section. The one read of the table
 * is `loadOverridesByProduct` in the resolver service; this narrows it to the
 * channel.
 */
export function loadChannelOverridesByProduct(
  em: EntityManager,
  productIds: readonly string[],
  channelId: string,
): Promise<Map<string, OverrideRow[]>> {
  return loadOverridesByProduct(em, { productIds, channelId });
}

/**
 * The product's `attributeValues` with every channel-scoped user attribute
 * replaced by its override for this context — walked over the attribute's own
 * baseline value, so a per-language value stops the walk where it answers. Returns the input record itself
 * when no user-attribute override row exists, so a product without overrides
 * costs no attribute-metadata read and no copy.
 */
export async function effectiveAttributeValues(
  values: Record<string, unknown>,
  overrides: readonly OverrideRow[] | undefined,
  ctx: StorefrontOverrideContext,
  scopeOf: () => Promise<Map<string, AttributeScope>>,
): Promise<Record<string, unknown>> {
  const userRows = (overrides ?? []).filter(
    (o) => !Object.prototype.hasOwnProperty.call(SYSTEM_ATTRIBUTE_SCOPES, o.attributeKey),
  );
  if (userRows.length === 0) return values;
  const scopes = await scopeOf();
  const out: Record<string, unknown> = { ...values };
  for (const key of new Set(userRows.map((o) => o.attributeKey))) {
    const scope = scopes.get(key);
    if (!scope) continue;
    const v = channelOverrideFor(userRows, key, scope, ctx, values[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}
