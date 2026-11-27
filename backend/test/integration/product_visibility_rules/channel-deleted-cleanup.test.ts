import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { attachRuleBySql, clearWebsiteRules, createChannel, createProduct, websiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 T101 [real DB] — a sales channel deleted while a website rule governs it leaves its
 * `website_rule_attachments` and `website_rule_admissions` rows behind (no foreign key leaves the
 * module, data-model §0). `product_visibility_rules` sweeps them: on every
 * `sales_channels.lifecycle_changed` (which a delete emits; there is no dedicated delete event)
 * and at the start of the hourly reconcile, the rows of channels that no longer resolve go.
 * A deactivated channel still exists and keeps its rows; while the module is off nothing
 * subscribes, and the reconcile after it is back sweeps what was missed.
 */
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('website rule rows of a deleted channel are swept (spec 193, T101)', () => {
  let h: BackendServerHandle;
  let keptChannel: string;
  let ruleId: string;
  const sql = <T = Record<string, unknown>>(s: string, params: unknown[] = []) => h.orm.em.fork().getConnection().execute<T[]>(s, params);
  const rowsOf = async (channelId: string) => ({
    attachments: (await sql<{ n: number }>(`select count(*)::int as n from "website_rule_attachments" where "sales_channel_id" = ?`, [channelId]))[0]!.n,
    admissions: (await sql<{ n: number }>(`select count(*)::int as n from "website_rule_admissions" where "sales_channel_id" = ?`, [channelId]))[0]!.n,
  });
  const codeOf = async (id: string) => (await sql<{ code: string }>(`select "code" from "sales_channels" where "id" = ?`, [id]))[0]!.code;

  /** A channel governed by the test rule, with one admissions row; no bridge row, so it deletes freely. */
  async function governedChannel(prefix: string): Promise<string> {
    const channel = await createChannel(h, prefix);
    await sql(`insert into "website_rule_attachments" ("sales_channel_id", "product_rule_id", "attached_at", "applied_rule_version") values (?, ?, now(), 1)`, [channel, ruleId]);
    const product = await createProduct(h, { color: 'blue' });
    await sql(`insert into "website_rule_admissions" ("sales_channel_id", "product_id", "admitted_at") values (?, ?, now())`, [channel, product]);
    return channel;
  }

  async function deleteChannel(channelId: string): Promise<void> {
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${await codeOf(channelId)}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(204);
  }

  async function eventually(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('condition not met within 5 s');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    ruleId = (await attachRuleBySql(h, [])).ruleId;
    keptChannel = await governedChannel('cl-kept');
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  it('deleting a governed channel removes its attachment and admissions; other channels keep theirs', async () => {
    const doomed = await governedChannel('cl-doomed');
    expect(await rowsOf(doomed)).toEqual({ attachments: 1, admissions: 1 });
    await deleteChannel(doomed);
    await eventually(async () => JSON.stringify(await rowsOf(doomed)) === JSON.stringify({ attachments: 0, admissions: 0 }));
    expect(await rowsOf(keptChannel)).toEqual({ attachments: 1, admissions: 1 });
  });

  it('a second delivery of the event changes nothing', async () => {
    const before = { kept: await rowsOf(keptChannel), all: await sql(`select count(*)::int as n from "website_rule_attachments"`) };
    h.eventBus.emit('sales_channels.lifecycle_changed' as never, { eventId: 'again', occurredAt: new Date().toISOString(), channelCode: 'gone', invalidateAll: true } as never);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect({ kept: await rowsOf(keptChannel), all: await sql(`select count(*)::int as n from "website_rule_attachments"`) }).toEqual(before);
  });

  it('a deactivated channel still exists and keeps its rows', async () => {
    const paused = await governedChannel('cl-paused');
    const res = await h.app.inject({ method: 'POST', url: `/api/v1/admin/sales-channels/${await codeOf(paused)}/deactivate`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBeLessThan(300);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await rowsOf(paused)).toEqual({ attachments: 1, admissions: 1 });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s nothing subscribes; the reconcile once back sweeps the rows', async (axis) => {
    const doomed = await governedChannel(`cl-off-${axis.slice(0, 4)}`);
    await withModuleOff('product_visibility_rules', axis, async () => {
      await deleteChannel(doomed);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await rowsOf(doomed)).toEqual({ attachments: 1, admissions: 1 });
    });
    expect(await rowsOf(doomed)).toEqual({ attachments: 1, admissions: 1 });
    await websiteRules(h).reconcileAll();
    expect(await rowsOf(doomed)).toEqual({ attachments: 0, admissions: 0 });
    expect(await rowsOf(keptChannel)).toEqual({ attachments: 1, admissions: 1 });
  });
});
