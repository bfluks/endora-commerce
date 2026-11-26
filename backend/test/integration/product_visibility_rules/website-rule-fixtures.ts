import { randomUUID } from 'node:crypto';
import { SALES_CHANNEL_AUDIT_ACTIONS } from '@endora-commerce/contracts';
import { SalesChannel, type SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';

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

// ── Phase 6: products, flags, the website-rule service and its API ─────────────────────────

/** The website-rule service as composed — the shared test server runs no worker, so tests run its jobs. */
export function websiteRules(h: BackendServerHandle): WebsiteRuleServiceForTests {
  return h.container.cradle['productVisibilityWebsiteRules'] as WebsiteRuleServiceForTests;
}

/** The job entry points and limits a test drives; structurally the service's own. */
export interface WebsiteRuleServiceForTests {
  runPreview(previewId: string): Promise<void>;
  applyPreview(previewId: string): Promise<{ applied: number }>;
  evaluateMarked(): Promise<{ evaluated: number; changed: number }>;
  reconcileAll(): Promise<{ changed: number }>;
  readonly limits: Readonly<WebsiteRuleLimitsForTests>;
  /** A sibling service on the same deps with some limits lowered; the singleton is never mutated. */
  withLimits(limits: Partial<WebsiteRuleLimitsForTests>): WebsiteRuleServiceForTests;
  createPreview(adminUserId: string, body: unknown): Promise<{ previewId: string }>;
}

export interface WebsiteRuleLimitsForTests {
  maxConcurrentPreviewsPerAdmin: number;
  maxPreviewChanges: number;
  applyBatch: number;
}

/** A live product with these attribute values; optionally made inactive, archived or deleted. */
export async function createProduct(
  h: BackendServerHandle,
  attributeValues: Record<string, unknown>,
  state: { status?: 'active' | 'inactive'; archived?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  const sku = `PVR-${id.slice(0, 8)}`;
  const em = h.em().fork();
  em.create(Product, {
    id,
    sku,
    slug: sku.toLowerCase(),
    type: 'simple',
    status: state.status ?? 'active',
    name: `Product ${sku}`,
    description: 'Spec 193 website-rule fixture.',
    visibility: 'public',
    attributeValues,
  } as never);
  await em.flush();
  const conn = em.getConnection();
  if (state.archived) await conn.execute(`update "products" set "archived_at" = now() where "id" = ?`, [id]);
  if (state.deleted) await conn.execute(`update "products" set "deleted_at" = now() where "id" = ?`, [id]);
  return id;
}

/** Put a product on a channel straight in the bridge (a fixture: no audit row, no event). */
export async function bridgeProduct(h: BackendServerHandle, channelId: string, productId: string): Promise<void> {
  await h.orm.em
    .fork()
    .getConnection()
    .execute(`insert into "sales_channel_products" ("sales_channel_id", "product_id") values (?, ?) on conflict do nothing`, [channelId, productId]);
}

/** Serve a flag generation for `currency` and set each product's flag (`null` = unpriced). */
export async function setPriceFlags(h: BackendServerHandle, currency: string, flags: Record<string, boolean | null>): Promise<void> {
  const conn = h.orm.em.fork().getConnection();
  await conn.execute(
    `insert into "catalogue_price_generations" ("currency_code", "served_generation") values (?, 1)
     on conflict ("currency_code") do update set "served_generation" = greatest("catalogue_price_generations"."served_generation", 1)`,
    [currency],
  );
  const [row] = await conn.execute<Array<{ g: number }>>(`select "served_generation" as g from "catalogue_price_generations" where "currency_code" = ?`, [currency]);
  for (const [productId, flag] of Object.entries(flags)) {
    await conn.execute(`delete from "product_catalogue_prices" where "currency_code" = ? and "generation" = ? and "product_id" = ?`, [currency, row!.g, productId]);
    if (flag === null) continue;
    await conn.execute(
      `insert into "product_catalogue_prices" ("currency_code", "generation", "product_id", "has_positive", "refreshed_at") values (?, ?, ?, ?, now())`,
      [currency, row!.g, productId, flag],
    );
  }
}

/** The preview's snapshot rows, as `channel:product:op`, sorted. */
export async function previewChanges(h: BackendServerHandle, previewId: string): Promise<string[]> {
  const rows = await h.orm.em
    .fork()
    .getConnection()
    .execute<Array<{ sales_channel_id: string; product_id: string; op: string }>>(
      `select "sales_channel_id", "product_id", "op" from "website_rule_preview_changes" where "preview_id" = ?`,
      [previewId],
    );
  return rows.map((r) => `${r.sales_channel_id}:${r.product_id}:${r.op}`).sort();
}

export async function admissions(h: BackendServerHandle, channelId: string): Promise<string[]> {
  const rows = await h.orm.em
    .fork()
    .getConnection()
    .execute<Array<{ product_id: string }>>(`select "product_id" from "website_rule_admissions" where "sales_channel_id" = ? order by 1`, [channelId]);
  return rows.map((r) => r.product_id);
}

export async function channelMembers(h: BackendServerHandle, channelId: string): Promise<string[]> {
  const rows = await h.orm.em
    .fork()
    .getConnection()
    .execute<Array<{ product_id: string }>>(`select "product_id" from "sales_channel_products" where "sales_channel_id" = ? order by 1`, [channelId]);
  return rows.map((r) => r.product_id);
}
