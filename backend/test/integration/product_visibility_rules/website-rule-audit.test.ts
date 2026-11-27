import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { call } from './fixtures.js';
import { clearWebsiteRules, createChannel, createProduct, websiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 FR-070 QA addition — "every create, change and delete of ... a product rule and a rule's
 * attachment to a channel MUST be audited with actor, before and after". `configuration-audit.test.ts`
 * holds categories, role mappings and designations; no test held the website-rule half (the six
 * `product_visibility.product_rule.*` / `product_visibility.website_rule.*` Commands).
 */
describe('website rule audit (spec 193, FR-070)', () => {
  let h: BackendServerHandle;
  const BLUE = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['blue'] }] };
  const RED = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['red'] }] };

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
  }, 5 * 60_000);
  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  async function entries(action: string, objectId: string) {
    return h.em().getConnection().execute<Array<{ actor_admin_user_id: string | null; state_before: unknown; state_after: unknown }>>(
      `select "actor_admin_user_id", "state_before", "state_after" from "audit_log_entries" where "action" = ? and "object_id" = ?`,
      [action, objectId],
    );
  }

  it('audits rule create / rename / delete and attach / change / detach, each with an actor and before / after', async () => {
    const channel = await createChannel(h, 'wr-audit');
    await createProduct(h, { color: 'blue' });
    const created = await call(h, 'POST', '/product-rules', { payload: { name: `Audit ${Date.now()}`, definition: BLUE } });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ruleId = created.body.data.id as string;
    const [create] = await entries('product_visibility.product_rule.create', ruleId);
    expect(create, 'product rule create is not audited').toBeDefined();
    expect(create!.actor_admin_user_id).not.toBeNull();
    expect(create!.state_after).not.toBeNull();

    const preview = async (body: unknown) => {
      const p = await call(h, 'POST', '/website-rules/previews', { payload: body });
      expect(p.status, JSON.stringify(p.body)).toBe(202);
      const id = p.body.data.previewId as string;
      await websiteRules(h).runPreview(id);
      const c = await call(h, 'POST', `/website-rules/previews/${id}/confirm`);
      expect(c.status, JSON.stringify(c.body)).toBe(202);
      await websiteRules(h).applyPreview(id);
      return id;
    };
    const attachId = await preview({ kind: 'attach', productRuleId: ruleId, salesChannelIds: [channel] });
    const [attach] = await entries('product_visibility.website_rule.attach', attachId);
    expect(attach, 'a rule attachment is not audited').toBeDefined();
    expect(attach!.actor_admin_user_id).not.toBeNull();
    expect(attach!.state_after).not.toBeNull();

    const changeId = await preview({ kind: 'change', productRuleId: ruleId, definition: RED });
    const [change] = await entries('product_visibility.website_rule.change', changeId);
    expect(change, 'a rule definition change is not audited').toBeDefined();
    expect(change!.state_before).not.toBeNull();
    expect(change!.state_after).not.toBeNull();

    const renamed = await call(h, 'PATCH', `/product-rules/${ruleId}`, { payload: { name: `Audit renamed ${Date.now()}` } });
    expect(renamed.status).toBe(200);
    const [update] = await entries('product_visibility.product_rule.update', ruleId);
    expect(update, 'a product rule rename is not audited').toBeDefined();
    expect(update!.state_before).not.toBeNull();
    expect(update!.state_after).not.toBeNull();

    expect((await call(h, 'DELETE', `/website-rules/attachments/${channel}`)).status).toBe(204);
    const [detach] = await entries('product_visibility.website_rule.detach', channel);
    expect(detach, 'a rule detach is not audited').toBeDefined();
    expect(detach!.state_before).not.toBeNull();

    expect((await call(h, 'DELETE', `/product-rules/${ruleId}`)).status).toBe(204);
    const [del] = await entries('product_visibility.product_rule.delete', ruleId);
    expect(del, 'a product rule delete is not audited').toBeDefined();
    expect(del!.state_before).not.toBeNull();
  });
});
