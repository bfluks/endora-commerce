import { randomUUID } from 'node:crypto';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Spec 193, stream B — helpers of the website-rule integration tests (Phases 6 – 7): channels,
 * rules attached by SQL where a test is about the kernel rather than the attach flow, and reads
 * of the bridge, the membership audit rows and the work tables on a connection of their own
 * (which sees only what has committed).
 */

export function membershipPort(h: BackendServerHandle): SalesChannelMembershipPort {
  return h.container.cradle['salesChannelMembershipPort'] as SalesChannelMembershipPort;
}

export async function createChannel(h: BackendServerHandle, prefix: string): Promise<string> {
  const em = h.em().fork();
  const code = `${prefix}-${randomUUID().slice(0, 8)}`;
  const channel = em.create(SalesChannel, {
    code,
    name: { 'en-US': code, 'pl-PL': code },
    defaultLanguage: 'pl-PL',
    languages: ['pl-PL'],
    defaultCurrency: 'PLN',
    currencies: ['PLN'],
  });
  await em.persist(channel).flush();
  return channel.id;
}

/** A saved rule attached to `channelIds` straight in the tables — the kernel's view of "governed". */
export async function attachRuleBySql(
  h: BackendServerHandle,
  channelIds: readonly string[],
  name = `Rule ${randomUUID().slice(0, 8)}`,
  definition: unknown = { match: 'all', conditions: [{ kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gt_zero' }] },
): Promise<{ ruleId: string; name: string }> {
  const ruleId = randomUUID();
  const conn = h.orm.em.fork().getConnection();
  await conn.execute(
    `insert into "product_rules" ("id", "name", "definition", "version", "created_at", "updated_at") values (?, ?, ?::jsonb, 1, now(), now())`,
    [ruleId, name, JSON.stringify(definition)],
  );
  for (const channelId of channelIds) {
    await conn.execute(
      `insert into "website_rule_attachments" ("sales_channel_id", "product_rule_id", "attached_at", "applied_rule_version") values (?, ?, now(), 1)`,
      [channelId, ruleId],
    );
  }
  return { ruleId, name };
}

/** Delete every rule, attachment and website-rule work row — between files sharing a database. */
export async function clearWebsiteRules(h: BackendServerHandle): Promise<void> {
  const conn = h.orm.em.fork().getConnection();
  for (const table of [
    'website_rule_preview_changes',
    'website_rule_previews',
    'website_rule_admissions',
    'website_rule_stale_products',
    'website_rule_attachments',
    'product_rules',
  ]) {
    await conn.execute(`delete from "${table}"`);
  }
}

export async function isMember(h: BackendServerHandle, channelId: string, productId: string): Promise<boolean> {
  const rows = await h.orm.em
    .fork()
    .getConnection()
    .execute<Array<{ n: number }>>(
      `select count(*)::int as n from "sales_channel_products" where "sales_channel_id" = ? and "product_id" = ?`,
      [channelId, productId],
    );
  return rows[0]!.n > 0;
}

export interface MembershipAuditRow {
  objectId: string;
  stateAfter: Record<string, unknown> | null;
}

/** Committed membership audit rows of one (channel, product) pair. */
export async function membershipAudit(h: BackendServerHandle, channelId: string, productId: string): Promise<MembershipAuditRow[]> {
  const rows = await h.orm.em
    .fork()
    .getConnection()
    .execute<Array<{ object_id: string; state_after: Record<string, unknown> | null }>>(
      `select "object_id", "state_after" from "audit_log_entries" where "action" = ? and "object_id" = ? order by "acted_at" asc`,
      [SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED, `${channelId}:product:${productId}`],
    );
  return rows.map((r) => ({ objectId: r.object_id, stateAfter: r.state_after }));
}

/** Record every `sales_channels.membership_changed` of a product; returns the list and a stop function. */
export function recordMembershipEvents(h: BackendServerHandle): {
  events: Array<{ channelId: string; entityId: string; op: 'add' | 'remove' }>;
  stop: () => void;
} {
  const events: Array<{ channelId: string; entityId: string; op: 'add' | 'remove' }> = [];
  const stop = h.eventBus.on('sales_channels.membership_changed', (payload) => {
    const p = payload as unknown as { channelId: string; entityType: string; entityId: string; op: 'add' | 'remove' };
    if (p.entityType === 'product') events.push({ channelId: p.channelId, entityId: p.entityId, op: p.op });
  });
  return { events, stop };
}
