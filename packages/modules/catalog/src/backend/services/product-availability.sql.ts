import type { ProductAudience } from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/product-scopes.md` §4) —
 * effective availability restated as SQL, for the statements a page is cut from
 * (issue #151).
 *
 * The rule itself is `isProductEffectivelyAvailable` in
 * `@endora-commerce/contracts`; this file is its SQL twin, and
 * `backend/test/integration/catalog/availability-parity.test.ts` holds the two
 * equal over a generated grid of status × window × audience × buyer.
 *
 * **Descriptions, never `raw()` fragments.** MikroORM registers a fragment in a
 * process-wide cache the moment it is used as a key and releases it only when a
 * statement consumes it, so the caller turns these into keys in the very
 * expression that executes them (`catalog-query.service.ts`' own rule).
 */

/**
 * One condition of a statement over `products`: SQL over the alias the ORM (or
 * the caller's own `from products <alias>`) settles on, and the values its `?`
 * placeholders bind, in order.
 */
export interface ListingCondition {
  sql: (alias: string) => string;
  params: unknown[];
}

/** Where an availability question is asked, with the channel's languages already known. */
export interface AvailabilitySqlScope {
  channelId: string;
  /** Already resolved by `resolveScopeLanguage` (or the channel default for an operator). */
  languageCode: string;
  /** The channel's current content languages — read from the channel record, never from the client. */
  channelLanguages: readonly string[];
  audience: ProductAudience;
  now: Date;
}

/**
 * `isProductVisibleTo`, as SQL, over two expressions — the visibility and the
 * allow-list in force. The `case` follows the predicate branch for branch: a
 * non-empty allow-list decides on its own, then `organization_restricted`,
 * then `logged_in_only`, so a fourth visibility value falls to `else true`
 * exactly as it falls to the predicate's last `return`. `@>` containment over
 * the JSONB array, so the organisation has to be one of its elements rather
 * than a substring of the serialised bag. An allow-list that is not an array
 * reads as "no allow-list".
 *
 * The one statement of the audience rule in this module's listing reads, over
 * the channel-effective columns {@link availabilityCondition} hands it.
 */
export function audienceCaseSql(
  visibilityExpr: string,
  allowedExpr: string,
  audience: ProductAudience,
): { sql: string; params: unknown[] } {
  const onAllowList = audience.organizationId !== null;
  return {
    sql:
      `(case ` +
      `when (case when jsonb_typeof(${allowedExpr}) = 'array' ` +
      `then jsonb_array_length(${allowedExpr}) else 0 end) > 0 ` +
      `then ${onAllowList ? `${allowedExpr} @> ?::jsonb` : 'false'} ` +
      `when ${visibilityExpr} = 'organization_restricted' then false ` +
      `when ${visibilityExpr} = 'logged_in_only' then ${audience.authenticated ? 'true' : 'false'} ` +
      `else true end)`,
    params: onAllowList ? [JSON.stringify([audience.organizationId])] : [],
  };
}

/** A condition no row satisfies — an answer, not an error. */
const NOTHING: ListingCondition = { sql: () => 'false', params: [] };

/**
 * FR-001 as one condition over the `products` alias: not deleted, not archived,
 * a member of the channel (the kernel's membership subquery — Constitution XII),
 * the language offered by the channel, effectively on at (C, L), inside the
 * effective window at `now` (inclusive at both ends, K4), and admitted by the
 * effective audience rule.
 *
 * Whether the channel offers L is constant for the request, so it is decided
 * here rather than in SQL: a language the channel does not offer matches
 * nothing. That is also how an orphaned channel × language row is ignored — it
 * is never read for a pair that fails the test (FR-015).
 *
 * The channel and channel × language rows are read by keyed left joins inside
 * one correlated `exists`, so the statement stays a filter over the caller's own
 * `from products` and adds no row multiplication.
 */
export function availabilityCondition(
  scope: AvailabilitySqlScope,
  membership: Pick<SalesChannelMembershipPort, 'entityIdsInChannelSubquery'>,
): ListingCondition {
  if (!scope.channelLanguages.includes(scope.languageCode)) return NOTHING;
  const inChannel = membership.entityIdsInChannelSubquery(scope.channelId, 'product');
  const now = scope.now.toISOString();
  const audience = audienceCaseSql(
    `(case when c.visibility is not null then c.visibility else ap.visibility end)`,
    `(case when c.visibility is not null then c.allowed_organization_ids else ap.allowed_organization_ids end)`,
    scope.audience,
  );
  const windowFrom = `(case when c.window_overridden then c.publish_from else ap.publish_from end)`;
  const windowUntil = `(case when c.window_overridden then c.publish_until else ap.publish_until end)`;
  return {
    sql: (alias) =>
      `(${alias}.deleted_at is null and ${alias}.archived_at is null ` +
      `and ${alias}.id in (${inChannel.sql}) ` +
      `and exists (select 1 from products ap ` +
      `left join product_channel_scopes c ` +
      `on c.product_id = ap.id and c.sales_channel_id = ? ` +
      `left join product_channel_language_scopes cl ` +
      `on cl.product_id = ap.id and cl.sales_channel_id = ? and cl.language_code = ? ` +
      `where ap.id = ${alias}.id ` +
      `and coalesce(cl.status, c.status, ap.status) = 'active' ` +
      `and (${windowFrom} is null or ${windowFrom} <= ?::timestamptz) ` +
      `and (${windowUntil} is null or ?::timestamptz <= ${windowUntil}) ` +
      `and ${audience.sql}))`,
    params: [
      ...inChannel.params,
      scope.channelId,
      scope.channelId,
      scope.languageCode,
      now,
      now,
      ...audience.params,
    ],
  };
}
