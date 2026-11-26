import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, PRODUCT_VISIBILITY_ERROR_CODES as E } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, call, forgetTestRoles, roleWith, type TestRole } from './fixtures.js';
import {
  admissions,
  bridgeProduct,
  channelMembers,
  clearWebsiteRules,
  createChannel,
  createProduct,
  isMember,
  membershipAudit,
  membershipPort,
  previewChanges,
  recordMembershipEvents,
  websiteRules,
} from './website-rule-fixtures.js';

/**
 * Spec 193 T056 [real DB] — the website rule: named rules (FR-050, FR-056), attach and change only
 * through a preview whose snapshot the apply job writes exactly (FR-053, SC-004), one rule per
 * channel (FR-051, US4-7), detach (FR-058), no rule ⇒ nothing moves (US4-1, FR-052), attribution
 * (FR-072), live products only (FR-079), and the preview's abuse bounds (TM-11).
 *
 * The rule here tests the seeded `color` attribute, so the seeded products take part too: the
 * assertions read the snapshot rows rather than assume a product count.
 */
const BLUE = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['blue'] }] };
const RED = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['red'] }] };

describe('website rule (spec 193, T056)', () => {
  let h: BackendServerHandle;
  let manager: TestRole;
  let stamp = 0;

  const name = (label: string) => `${label} ${Date.now()}-${(stamp += 1)}`;

  async function createRule(definition: unknown = BLUE, label = 'Blue products'): Promise<{ id: string; name: string }> {
    const res = await call(h, 'POST', '/product-rules', { payload: { name: name(label), definition } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { id: res.body.data.id, name: res.body.data.name };
  }

  async function preview(body: unknown, cookies = ADMIN): Promise<string> {
    const res = await call(h, 'POST', '/website-rules/previews', { payload: body, cookies });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    return res.body.data.previewId as string;
  }

  async function readyPreview(body: unknown): Promise<string> {
    const id = await preview(body);
    await websiteRules(h).runPreview(id);
    return id;
  }

  async function confirm(previewId: string, cookies = ADMIN) {
    return call(h, 'POST', `/website-rules/previews/${previewId}/confirm`, { cookies });
  }

  async function confirmAndApply(previewId: string): Promise<void> {
    const res = await confirm(previewId);
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    await websiteRules(h).applyPreview(previewId);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    manager = await roleWith(h, ['product_visibility:read', 'product_visibility:manage'], 'pvr_mgr');
  }, 5 * 60_000);

  beforeEach(() => {
    const limits = websiteRules(h).limits;
    // The stub admin leaves previews standing across cases; the cap is asserted on its own.
    limits.maxConcurrentPreviewsPerAdmin = 1_000;
    limits.maxPreviewChanges = 2_000_000;
  });

  afterAll(async () => {
    await clearWebsiteRules(h);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  describe('product rules (FR-050, FR-056)', () => {
    it('saves a named rule and lists the attributes a rule may name', async () => {
      const rule = await createRule();
      const attributes = await call(h, 'GET', '/attributes');
      expect(attributes.status).toBe(200);
      const color = (attributes.body.data.items as Array<{ key: string; kind: string; options: string[] }>).find((a) => a.key === 'color');
      expect(color).toMatchObject({ kind: 'choice' });
      expect(color!.options).toEqual(expect.arrayContaining(['red', 'green', 'blue']));
      expect((attributes.body.data.items as Array<{ key: string }>).some((a) => a.key === 'internal_sku_notes')).toBe(false);
      const overview = await call(h, 'GET', '/overview');
      expect(overview.body.data.productRules).toEqual(expect.arrayContaining([expect.objectContaining({ id: rule.id, version: 1 })]));
    });

    it('refuses an attribute that is not a global boolean / choice attribute, or an unknown option', async () => {
      const res = await call(h, 'POST', '/product-rules', {
        payload: {
          name: name('Bad'),
          definition: {
            match: 'any',
            conditions: [
              { kind: 'attribute_choice', attributeKey: 'internal_sku_notes', optionKeys: ['x'] },
              { kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['purple'] },
            ],
          },
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(res.body.error.details).toEqual([
        { path: 'definition.conditions.0.attributeKey', issue: 'unknown_attribute' },
        { path: 'definition.conditions.1.optionKeys', issue: 'unknown_option' },
      ]);
    });

    it('refuses a duplicate name', async () => {
      const rule = await createRule();
      const res = await call(h, 'POST', '/product-rules', { payload: { name: rule.name, definition: BLUE } });
      expect(res.status).toBe(422);
    });

    it('TM-11: bounds the definition and the preview body (Zod)', async () => {
      const tooMany = { match: 'any', conditions: Array.from({ length: 21 }, () => BLUE.conditions[0]) };
      expect((await call(h, 'POST', '/product-rules', { payload: { name: name('Big'), definition: tooMany } })).status).toBe(400);
      const manyOptions = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: Array.from({ length: 101 }, (_, i) => `o${i}`) }] };
      expect((await call(h, 'POST', '/product-rules', { payload: { name: name('Opts'), definition: manyOptions } })).status).toBe(400);
      expect((await call(h, 'POST', '/product-rules', { payload: { name: 'x'.repeat(121), definition: BLUE } })).status).toBe(400);
      const longKey = { match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'k'.repeat(101), value: true }] };
      expect((await call(h, 'POST', '/product-rules', { payload: { name: name('Key'), definition: longKey } })).status).toBe(400);
      const rule = await createRule();
      const ids = Array.from({ length: 51 }, () => '00000000-0000-4000-8000-000000000001');
      const res = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: rule.id, salesChannelIds: ids } });
      expect(res.status).toBe(400);
    });
  });

  describe('attach through a preview (FR-053, SC-004, FR-079)', () => {
    it('counts per channel, then applies exactly the snapshot', async () => {
      const channel = await createChannel(h, 'wr-attach');
      const stays = await createProduct(h, { color: 'blue' });
      const leaves = await createProduct(h, { color: 'green' });
      const joins = await createProduct(h, { color: 'blue' });
      const inactive = await createProduct(h, { color: 'blue' }, { status: 'inactive' });
      const archived = await createProduct(h, { color: 'blue' }, { archived: true });
      const deleted = await createProduct(h, { color: 'blue' }, { deleted: true });
      const joinsThenDeactivated = await createProduct(h, { color: 'blue' });
      for (const p of [stays, leaves]) await bridgeProduct(h, channel, p);
      const rule = await createRule();

      const previewId = await preview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      expect((await call(h, 'GET', `/website-rules/previews/${previewId}`)).body.data.status).toBe('pending');
      await websiteRules(h).runPreview(previewId);
      const ready = await call(h, 'GET', `/website-rules/previews/${previewId}`);
      expect(ready.body.data.status).toBe('ready');

      const snapshot = await previewChanges(h, previewId);
      expect(snapshot).toContain(`${channel}:${joins}:join`);
      expect(snapshot).toContain(`${channel}:${leaves}:leave`);
      for (const p of [stays, inactive, archived, deleted]) expect(snapshot.some((s) => s.includes(p))).toBe(false);
      const joinCount = snapshot.filter((s) => s.endsWith(':join')).length;
      const leaveCount = snapshot.filter((s) => s.endsWith(':leave')).length;
      expect(ready.body.data.counts).toEqual({ [channel]: { join: joinCount, leave: leaveCount } });

      // Changes after the preview are not applied by the confirm (SC-004): a product that
      // starts to meet the rule is left for the steady state; one deactivated is never added (FR-079).
      const lateJoiner = await createProduct(h, { color: 'blue' });
      await h.orm.em.fork().getConnection().execute(`update "products" set "status" = 'inactive' where "id" = ?`, [joinsThenDeactivated]);

      const recorder = recordMembershipEvents(h);
      try {
        await confirmAndApply(previewId);
      } finally {
        recorder.stop();
      }
      const members = await channelMembers(h, channel);
      expect(members).toContain(stays);
      expect(members).toContain(joins);
      expect(members).not.toContain(leaves);
      expect(members).not.toContain(lateJoiner);
      expect(members).not.toContain(joinsThenDeactivated);
      for (const p of [inactive, archived, deleted]) expect(members).not.toContain(p);
      // One event per product that joined or left (LOW 12).
      const mine = recorder.events.filter((e) => e.channelId === channel);
      expect(mine.length).toBe(joinCount - 1 + leaveCount);
      expect(new Set(mine.map((e) => e.entityId)).size).toBe(mine.length);
      // FR-072: the membership audit row names the rule.
      const [audit] = await membershipAudit(h, channel, joins);
      expect(audit!.stateAfter).toMatchObject({ source: `website_rule:${rule.id}` });
      // The admissions ledger has a row per token add (N2).
      expect(await admissions(h, channel)).toContain(joins);
      expect(await admissions(h, channel)).not.toContain(stays);
      // The snapshot is consumed.
      expect(await previewChanges(h, previewId)).toEqual([]);
      expect((await call(h, 'GET', `/website-rules/previews/${previewId}`)).body.data.status).toBe('applied');
    });

    it('refuses a stale preview: expired, or the rule moved since', async () => {
      const channel = await createChannel(h, 'wr-stale');
      const rule = await createRule();
      const expired = await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      await h.orm.em.fork().getConnection().execute(`update "website_rule_previews" set "expires_at" = now() - interval '1 minute' where "id" = ?`, [expired]);
      const res1 = await confirm(expired);
      expect(res1.status).toBe(409);
      expect(res1.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_STALE);

      const moved = await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      const patched = await call(h, 'PATCH', `/product-rules/${rule.id}`, { payload: { definition: RED } });
      expect(patched.status).toBe(200);
      expect(patched.body.data.version).toBe(2);
      const res2 = await confirm(moved);
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_STALE);
      expect(await isMember(h, channel, '00000000-0000-4000-8000-000000000102')).toBe(false);
    });

    it('a preview not yet ready cannot be confirmed', async () => {
      const channel = await createChannel(h, 'wr-pending');
      const rule = await createRule();
      const pending = await preview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      const res = await confirm(pending);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_STALE);
    });

    it('one rule per channel; one rule may govern two channels (FR-051, US4-7)', async () => {
      const a = await createChannel(h, 'wr-a');
      const b = await createChannel(h, 'wr-b');
      const rule = await createRule();
      await confirmAndApply(await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [a, b] }));
      const overview = await call(h, 'GET', '/overview');
      const attached = (overview.body.data.websiteRuleAttachments as Array<{ salesChannelId: string; productRuleId: string }>).filter((x) => x.productRuleId === rule.id);
      expect(attached.map((x) => x.salesChannelId).sort()).toEqual([a, b].sort());

      const other = await createRule(RED, 'Red products');
      const second = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: other.id, salesChannelIds: [a] } });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe(E.CHANNEL_ALREADY_GOVERNED);
    });

    it('a channel taken by another rule between preview and confirm is refused at confirm', async () => {
      const channel = await createChannel(h, 'wr-race');
      const first = await createRule();
      const second = await createRule(RED, 'Red products');
      const p1 = await readyPreview({ kind: 'attach', productRuleId: first.id, salesChannelIds: [channel] });
      const p2 = await readyPreview({ kind: 'attach', productRuleId: second.id, salesChannelIds: [channel] });
      await confirmAndApply(p1);
      const res = await confirm(p2);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(E.CHANNEL_ALREADY_GOVERNED);
    });

    it('ignores a channel deleted before the preview ran or before the confirm', async () => {
      const kept = await createChannel(h, 'wr-kept');
      const gone = await createChannel(h, 'wr-gone');
      const rule = await createRule();
      const id = await preview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [kept, gone] });
      const code = (await h.orm.em.fork().getConnection().execute<Array<{ code: string }>>(`select "code" from "sales_channels" where "id" = ?`, [gone]))[0]!.code;
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${code}`, cookies: ADMIN });
      expect(del.statusCode, del.body).toBe(204);
      await websiteRules(h).runPreview(id);
      const ready = await call(h, 'GET', `/website-rules/previews/${id}`);
      expect(Object.keys(ready.body.data.counts)).toEqual([kept]);
      await confirmAndApply(id);
      const overview = await call(h, 'GET', '/overview');
      const attached = (overview.body.data.websiteRuleAttachments as Array<{ salesChannelId: string; productRuleId: string }>).filter((x) => x.productRuleId === rule.id);
      expect(attached.map((x) => x.salesChannelId)).toEqual([kept]);
    });
  });

  describe('change and detach', () => {
    it('a definition change of an attached rule needs a preview, then applies its snapshot (FR-053)', async () => {
      const channel = await createChannel(h, 'wr-change');
      const red = await createProduct(h, { color: 'red' });
      const blue = await createProduct(h, { color: 'blue' });
      const rule = await createRule();
      await confirmAndApply(await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] }));
      expect(await isMember(h, channel, blue)).toBe(true);

      const direct = await call(h, 'PATCH', `/product-rules/${rule.id}`, { payload: { definition: RED } });
      expect(direct.status).toBe(409);
      expect(direct.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_REQUIRED);
      const renamed = await call(h, 'PATCH', `/product-rules/${rule.id}`, { payload: { name: name('Renamed') } });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.version).toBe(1);

      const change = await readyPreview({ kind: 'change', productRuleId: rule.id, definition: RED });
      await confirmAndApply(change);
      expect(await isMember(h, channel, red)).toBe(true);
      expect(await isMember(h, channel, blue)).toBe(false);
      expect(await admissions(h, channel)).not.toContain(blue);
      const overview = await call(h, 'GET', '/overview');
      expect(overview.body.data.productRules.find((r: { id: string }) => r.id === rule.id).version).toBe(2);
    });

    it('detach keeps the membership, clears the channel’s admissions and ungoverns the channel (FR-058)', async () => {
      const channel = await createChannel(h, 'wr-detach');
      const blue = await createProduct(h, { color: 'blue' });
      const rule = await createRule();
      await confirmAndApply(await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] }));
      expect(await admissions(h, channel)).toContain(blue);
      const before = await channelMembers(h, channel);

      const res = await call(h, 'DELETE', `/website-rules/attachments/${channel}`);
      expect(res.status).toBe(204);
      expect(await channelMembers(h, channel)).toEqual(before);
      expect(await admissions(h, channel)).toEqual([]);
      const green = await createProduct(h, { color: 'green' });
      expect(await membershipPort(h).addToChannel(channel, 'product', green, { onGoverned: 'refuse' })).toEqual({ changed: true });
      expect((await call(h, 'DELETE', `/website-rules/attachments/${channel}`)).status).toBe(404);
    });

    it('an attached rule cannot be deleted; a detached one can', async () => {
      const channel = await createChannel(h, 'wr-del');
      const rule = await createRule();
      await confirmAndApply(await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] }));
      const refused = await call(h, 'DELETE', `/product-rules/${rule.id}`);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe(E.PRODUCT_RULE_ATTACHED);
      expect((await call(h, 'DELETE', `/website-rules/attachments/${channel}`)).status).toBe(204);
      expect((await call(h, 'DELETE', `/product-rules/${rule.id}`)).status).toBe(204);
    });
  });

  it('no rule ⇒ nothing moves (US4-1, FR-052)', async () => {
    await clearWebsiteRules(h);
    const snapshot = async () =>
      (await h.orm.em.fork().getConnection().execute<Array<{ n: number }>>(`select count(*)::int as n from "sales_channel_products"`))[0]!.n;
    const before = await snapshot();
    expect(await websiteRules(h).reconcileAll()).toEqual({ changed: 0 });
    expect(await websiteRules(h).evaluateMarked()).toEqual({ evaluated: 0, changed: 0 });
    expect(await snapshot()).toBe(before);
  });

  describe('TM-11 — who may confirm, and the preview bounds', () => {
    it('only the administrator who created the preview may read or confirm it', async () => {
      const channel = await createChannel(h, 'wr-owner');
      const rule = await createRule();
      const id = await readyPreview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      expect((await call(h, 'GET', `/website-rules/previews/${id}`, { cookies: manager.cookies })).status).toBe(404);
      const res = await confirm(id, manager.cookies);
      expect(res.status).toBe(404);
      expect((await call(h, 'GET', '/overview')).body.data.websiteRuleAttachments.some((a: { salesChannelId: string }) => a.salesChannelId === channel)).toBe(false);
    });

    it('caps concurrent previews per administrator, and the snapshot table', async () => {
      const channel = await createChannel(h, 'wr-cap');
      const rule = await createRule();
      websiteRules(h).limits.maxConcurrentPreviewsPerAdmin = 3;
      for (let i = 0; i < 3; i += 1) await preview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] }, manager.cookies);
      const fourth = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] }, cookies: manager.cookies });
      expect(fourth.status).toBe(409);
      expect(fourth.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_LIMIT);

      websiteRules(h).limits.maxConcurrentPreviewsPerAdmin = 1_000;
      websiteRules(h).limits.maxPreviewChanges = 0;
      const full = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] } });
      expect(full.status).toBe(409);
      expect(full.body.error.code).toBe(E.WEBSITE_RULE_PREVIEW_LIMIT);
    });

    it('a preview whose snapshot would pass the cap fails rather than writing past it', async () => {
      const channel = await createChannel(h, 'wr-cap2');
      await createProduct(h, { color: 'blue' });
      const rule = await createRule();
      const id = await preview({ kind: 'attach', productRuleId: rule.id, salesChannelIds: [channel] });
      const [row] = await h.orm.em.fork().getConnection().execute<Array<{ n: number }>>(`select count(*)::int as n from "website_rule_preview_changes"`);
      websiteRules(h).limits.maxPreviewChanges = row!.n;
      await websiteRules(h).runPreview(id);
      expect((await call(h, 'GET', `/website-rules/previews/${id}`)).body.data.status).toBe('failed');
      expect(await previewChanges(h, id)).toEqual([]);
    });
  });
});
