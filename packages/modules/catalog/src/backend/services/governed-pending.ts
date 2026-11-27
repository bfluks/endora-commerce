import type { MemberChannel } from './scoped-values-state.js';

/**
 * Spec 193 T070 — FR-093 (I-4, N6, R-11). Every sales channel a website rule governs, with the
 * channel's own languages, code and name, read through `product_visibility_rules`'
 * `productRuleGovernancePort`. The wiring (`index.ts`) probes the module's presence in front of the
 * port: absent ⇒ `[]` ⇒ nothing is pending and every non-member channel is `SCOPE_INVALID`, as
 * before the feature (FR-073). A call made while present is never caught.
 */
export type GovernedChannelsSource = () => Promise<readonly MemberChannel[]>;

/**
 * The governed channels the product is **not** a member of: a channel the rule has not admitted the
 * product to yet. Values written there are stored (pending admission) and add no membership.
 */
export async function pendingChannelsFor(
  source: GovernedChannelsSource | undefined,
  members: readonly { id: string }[],
): Promise<MemberChannel[]> {
  if (!source) return [];
  const governed = await source();
  if (governed.length === 0) return [];
  const memberIds = new Set(members.map((member) => member.id));
  return governed.filter((channel) => !memberIds.has(channel.id));
}

/** The `governedPending` option of `resolveRequestScope`: channel id → the channel's own languages. */
export function governedPendingOf(channels: readonly MemberChannel[]): ReadonlyMap<string, readonly string[]> {
  return new Map(channels.map((channel) => [channel.id, channel.languages]));
}
