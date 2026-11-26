import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { ADMIN, BASE, call } from './fixtures.js';
import {
  clearWebsiteRules,
  channelMembers,
  createChannel,
  createProduct,
  websiteRules,
} from './website-rule-fixtures.js';

/**
 * `product_visibility_rules` off-state — the website rule (spec 193 T061; FR-073, R-15). While
 * the module is off, on either axis:
 *
 *  * every rule and website-rule route answers `MODULE_DISABLED` (`ctx.routes`);
 *  * `productRuleGovernancePort` refuses with `MODULE_DISABLED` (`providePort`);
 *  * the catalogue-event subscriber does not run (`ctx.subscribe`): a product change marks nothing,
 *    so nothing is evaluated, and memberships stay as last computed;
 *  * the worker is attached with `ctx.worker`, so its jobs wait (the platform's worker gate, held
 *    by its own tests; the shared harness runs no worker) — and the first evaluation poll after
 *    the module is back reconciles every governed channel (`website-rule-worker.test.ts`);
 *  * rules, attachments and admissions are kept, and govern again once back.
 */
const UNKNOWN = '00000000-0000-4000-8000-000000000193';

describe('product_visibility_rules off-state — website rule (spec 193, T061)', () => {
  let h: BackendServerHandle;
  let channel: string;
  let ruleId: string;
  const sql = <T = Record<string, unknown>>(s: string, params: unknown[] = []) => h.orm.em.fork().getConnection().execute<T[]>(s, params);
  const count = async (table: string) => (await sql<{ n: number }>(`select count(*)::int as n from "${table}"`))[0]!.n;
  const port = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ governedChannels(): Promise<unknown> }>('productRuleGovernancePort');

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    channel = await createChannel(h, 'off-wr');
    await createProduct(h, { color: 'blue' });
    const rule = await call(h, 'POST', '/product-rules', {
      payload: { name: `Off ${Date.now()}`, definition: { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['blue'] }] } },
    });
    ruleId = rule.body.data.id;
    const preview = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: ruleId, salesChannelIds: [channel] } });
    await websiteRules(h).runPreview(preview.body.data.previewId);
    expect((await call(h, 'POST', `/website-rules/previews/${preview.body.data.previewId}/confirm`)).status).toBe(202);
    await websiteRules(h).applyPreview(preview.body.data.previewId);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  it('is absent from every rule route while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'product_visibility_rules', {
      // Every write probe is one the module refuses while on (unknown ids, an empty name), so the
      // harness's before / restored passes change nothing.
      routes: [
        { url: `${BASE}/attributes`, cookies: ADMIN },
        { method: 'POST', url: `${BASE}/product-rules`, cookies: ADMIN, payload: { name: '', definition: {} } },
        { method: 'PATCH', url: `${BASE}/product-rules/${UNKNOWN}`, cookies: ADMIN, payload: { name: 'Renamed while off' } },
        { method: 'DELETE', url: `${BASE}/product-rules/${UNKNOWN}`, cookies: ADMIN },
        { method: 'POST', url: `${BASE}/website-rules/previews`, cookies: ADMIN, payload: { kind: 'attach', productRuleId: UNKNOWN, salesChannelIds: [UNKNOWN] } },
        { url: `${BASE}/website-rules/previews/${UNKNOWN}`, cookies: ADMIN },
        { method: 'POST', url: `${BASE}/website-rules/previews/${UNKNOWN}/confirm`, cookies: ADMIN },
        { method: 'DELETE', url: `${BASE}/website-rules/attachments/${UNKNOWN}`, cookies: ADMIN },
      ],
      adminPresence: { cookies: ADMIN },
    });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)(
    'while %s: no mark, no evaluation, the port refuses, memberships and rows kept',
    async (axis) => {
      const members = await channelMembers(h, channel);
      expect(members.length).toBeGreaterThan(0);
      const rows = { rules: await count('product_rules'), attachments: await count('website_rule_attachments'), admissions: await count('website_rule_admissions') };
      const joiner = await createProduct(h, { color: 'blue' });
      await sql(`delete from "website_rule_stale_products"`);

      await withModuleOff('product_visibility_rules', axis, async () => {
        h.eventBus.emit('product.created.v1' as never, { eventId: 'x', occurredAt: new Date().toISOString(), productId: joiner } as never);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await count('website_rule_stale_products')).toBe(0);
        expect(() => port().governedChannels()).toThrow(/disabled|MODULE_DISABLED/i);
        expect(await channelMembers(h, channel)).toEqual(members);
      });

      expect(await channelMembers(h, channel)).toEqual(members);
      expect({ rules: await count('product_rules'), attachments: await count('website_rule_attachments'), admissions: await count('website_rule_admissions') }).toEqual(rows);
      // Back on: the rule governs again, and the reconcile the first poll runs admits the product
      // whose creation went unmarked while off.
      expect(await port().governedChannels()).toEqual([expect.objectContaining({ salesChannelId: channel, productRuleId: ruleId })]);
      await websiteRules(h).reconcileAll();
      expect(await channelMembers(h, channel)).toContain(joiner);
    },
  );
});
