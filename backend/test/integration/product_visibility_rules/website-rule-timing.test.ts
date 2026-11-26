import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueReferencePricePort, DesignationStatus } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import { WebsiteRuleService } from '../../../../packages/modules/product_visibility_rules/src/backend/services/website-rule.service.js';
import { ADMIN, call, clearFlags, flagsOf, settleFlags } from './fixtures.js';
import {
  admissions,
  clearWebsiteRules,
  createChannel,
  createProduct,
  isMember,
  recordMembershipEvents,
  websiteRules,
} from './website-rule-fixtures.js';

/**
 * Spec 193 T059 [real DB] — the website rule's steady state (R-11; US4-2, US4-6, US4-11,
 * SC-005, Q2 A, LOW 12): products marked by catalogue events and by flag refreshes that changed
 * their row are re-evaluated on every governed channel; a designation rebuild moves nothing (the
 * rule reads the served generation until the swap, and the swap marks only products whose flags
 * changed); a designated book's window boundaries schedule a reconcile at that instant.
 *
 * The shared harness runs no worker: each case runs the job the worker would.
 */
describe('website rule steady state (spec 193, T059)', () => {
  let h: BackendServerHandle;
  const sql = <T = Record<string, unknown>>(s: string, params: unknown[] = []) => h.orm.em.fork().getConnection().execute<T[]>(s, params);

  async function attach(definition: unknown, channelIds: string[]): Promise<string> {
    const rule = await call(h, 'POST', '/product-rules', { payload: { name: `Timing ${Date.now()}-${Math.random()}`, definition } });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const preview = await call(h, 'POST', '/website-rules/previews', { payload: { kind: 'attach', productRuleId: rule.body.data.id, salesChannelIds: channelIds } });
    await websiteRules(h).runPreview(preview.body.data.previewId);
    const confirmed = await call(h, 'POST', `/website-rules/previews/${preview.body.data.previewId}/confirm`, { cookies: ADMIN });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(202);
    await websiteRules(h).applyPreview(preview.body.data.previewId);
    return rule.body.data.id as string;
  }

  /** What the subscriber does on a catalogue event — the event the catalog's write emits. */
  async function announce(event: string, productId: string): Promise<void> {
    h.eventBus.emit(event as never, { eventId: `t-${Date.now()}`, occurredAt: new Date().toISOString(), productId } as never);
    for (let i = 0; i < 100; i += 1) {
      const [row] = await sql<{ n: number }>(`select count(*)::int as n from "website_rule_stale_products" where "product_id" = ?`, [productId]);
      if (row!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no website-rule mark for ${productId}`);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    await clearFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await clearFlags(h);
    await teardownBackendServer(h);
  });

  describe('marks from catalogue events (US4-2, US4-6, FR-079)', () => {
    let channel: string;
    let product: string;

    beforeAll(async () => {
      channel = await createChannel(h, 'wt-events');
      product = await createProduct(h, { color: 'green' });
      await attach({ match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'color', optionKeys: ['red'] }] }, [channel]);
    });

    it('a product that starts to meet the rule is admitted on the next evaluation (US4-6)', async () => {
      expect(await isMember(h, channel, product)).toBe(false);
      await sql(`update "products" set "attribute_values" = '{"color":"red"}'::jsonb where "id" = ?`, [product]);
      await announce('product.updated.v1', product);
      const recorder = recordMembershipEvents(h);
      try {
        expect((await websiteRules(h).evaluateMarked()).changed).toBe(1);
      } finally {
        recorder.stop();
      }
      expect(await isMember(h, channel, product)).toBe(true);
      expect(await admissions(h, channel)).toContain(product);
      expect(recorder.events).toEqual([{ channelId: channel, entityId: product, op: 'add' }]);
    });

    it('re-evaluating an unchanged product moves nothing', async () => {
      await announce('product.updated.v1', product);
      expect(await websiteRules(h).evaluateMarked()).toMatchObject({ changed: 0 });
      expect(await isMember(h, channel, product)).toBe(true);
    });

    it('a product that stops meeting the rule leaves, and its admission goes (US4-2, N2)', async () => {
      await sql(`update "products" set "attribute_values" = '{"color":"blue"}'::jsonb where "id" = ?`, [product]);
      await announce('product.updated.v1', product);
      expect((await websiteRules(h).evaluateMarked()).changed).toBe(1);
      expect(await isMember(h, channel, product)).toBe(false);
      expect(await admissions(h, channel)).not.toContain(product);
    });

    it('an archived product leaves although it meets the rule (FR-079)', async () => {
      const archived = await createProduct(h, { color: 'red' });
      await announce('product.created.v1', archived);
      await websiteRules(h).evaluateMarked();
      expect(await isMember(h, channel, archived)).toBe(true);
      await sql(`update "products" set "archived_at" = now() where "id" = ?`, [archived]);
      await announce('product.archived.v1', archived);
      await websiteRules(h).evaluateMarked();
      expect(await isMember(h, channel, archived)).toBe(false);
    });

    it('a mark taken while no channel is governed is cleared and moves nothing', async () => {
      const other = await createProduct(h, { color: 'red' });
      await sql(`delete from "website_rule_attachments" where "sales_channel_id" = ?`, [channel]);
      await announce('product.created.v1', other);
      expect(await websiteRules(h).evaluateMarked()).toEqual({ evaluated: 0, changed: 0 });
      const [row] = await sql<{ n: number }>(`select count(*)::int as n from "website_rule_stale_products"`);
      expect(row!.n).toBe(0);
      expect(await isMember(h, channel, other)).toBe(false);
    });
  });

  describe('catalogue-price flags and a designation rebuild (Q2 A, R-11)', () => {
    let channel: string;
    const seeded = [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID];

    beforeAll(async () => {
      await clearWebsiteRules(h);
      await flagsOf(h).requestRebuild(['PLN']);
      await settleFlags(h);
      await sql(`delete from "website_rule_stale_products"`);
      channel = await createChannel(h, 'wt-flags');
      await attach({ match: 'all', conditions: [{ kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gt_zero' }] }, [channel]);
      for (const id of seeded) expect(await isMember(h, channel, id)).toBe(true);
    });

    it('a whole rebuild that changes no flag marks nothing and moves no product (zero transient leave / join)', async () => {
      const recorder = recordMembershipEvents(h);
      try {
        await flagsOf(h).requestRebuild(['PLN']);
        // Mid-rebuild the served generation is unchanged; a reconcile now reads it.
        await websiteRules(h).reconcileAll();
        await settleFlags(h);
        const [marks] = await sql<{ n: number }>(`select count(*)::int as n from "website_rule_stale_products" where "product_id" = any(?::uuid[])`, [`{${seeded.join(',')}}`]);
        expect(marks!.n).toBe(0);
        await websiteRules(h).evaluateMarked();
        await websiteRules(h).reconcileAll();
      } finally {
        recorder.stop();
      }
      expect(recorder.events.filter((e) => e.channelId === channel)).toEqual([]);
      for (const id of seeded) expect(await isMember(h, channel, id)).toBe(true);
    });

    it('while a rebuild is in progress the rule reads the served generation (Q2 A)', async () => {
      const [gen] = await sql<{ served_generation: number }>(`select "served_generation" from "catalogue_price_generations" where "currency_code" = 'PLN'`);
      // A build of n + 1 in which product 101 is unpriced, not yet swapped.
      await sql(`update "catalogue_price_generations" set "building_generation" = ? where "currency_code" = 'PLN'`, [gen!.served_generation + 1]);
      const recorder = recordMembershipEvents(h);
      try {
        expect(await websiteRules(h).reconcileAll()).toEqual({ changed: 0 });
      } finally {
        recorder.stop();
        await sql(`update "catalogue_price_generations" set "building_generation" = null where "currency_code" = 'PLN'`);
      }
      expect(recorder.events).toEqual([]);
    });

    it('a refresh that changes a product’s flag row marks that product only', async () => {
      const [gen] = await sql<{ served_generation: number }>(`select "served_generation" from "catalogue_price_generations" where "currency_code" = 'PLN'`);
      // The served row of 101 says "priced at zero": the refresh rewrites it positive (a change).
      await sql(`update "product_catalogue_prices" set "has_positive" = false where "currency_code" = 'PLN' and "generation" = ? and "product_id" = ?`, [
        gen!.served_generation,
        SEED_PRODUCT_101_ID,
      ]);
      await flagsOf(h).markProducts(['PLN'], [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID]);
      await settleFlags(h);
      const marks = await sql<{ product_id: string }>(`select "product_id" from "website_rule_stale_products" order by 1`);
      expect(marks.map((m) => m.product_id)).toEqual([SEED_PRODUCT_101_ID]);
      await websiteRules(h).evaluateMarked();
      expect(await isMember(h, channel, SEED_PRODUCT_101_ID)).toBe(true);
    });
  });

  describe('window boundaries of a designated book (R-11, controllable clock)', () => {
    it('schedules a reconcile at each future boundary of a currency an attached rule names, once per boundary', async () => {
      await clearWebsiteRules(h);
      const channel = await createChannel(h, 'wt-window');
      await attach({ match: 'all', conditions: [{ kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gt_zero' }] }, [channel]);
      const [book] = await sql<{ id: string }>(`select "id" from "price_lists" limit 1`);
      await sql(
        `insert into "catalogue_price_designations" ("currency_code", "price_list_id", "sales_channel_id", "updated_at") values ('PLN', ?, ?, now())
         on conflict ("currency_code") do update set "price_list_id" = excluded."price_list_id", "sales_channel_id" = excluded."sales_channel_id"`,
        [book!.id, channel],
      );
      const now = new Date('2026-12-01T10:00:00.000Z');
      const window = { startsAt: '2026-11-30T00:00:00.000Z', endsAt: '2026-12-24T18:00:00.000Z' };
      const scheduled: Array<{ at: string; key: string }> = [];
      const cradle = h.container.cradle as Record<string, unknown>;
      const service = new WebsiteRuleService({
        emFactory: () => h.em(),
        commandBus: cradle['commandBus'] as never,
        eventBus: h.eventBus,
        membership: () => cradle['salesChannelMembershipPort'] as never,
        channels: () => cradle['salesChannelResolutionPort'] as never,
        products: () => cradle['catalogProductReadPort'] as never,
        attributes: () => cradle['catalogAttributeReadPort'] as never,
        prices: () =>
          ({
            designationStatuses: async (input: unknown[]) => input.map((): DesignationStatus => ({ inForce: true, window })),
          }) as unknown as CatalogueReferencePricePort,
        governor: { token: () => { throw new Error('no writes here'); } } as never,
        jobs: {
          enqueuePreview: async () => undefined,
          enqueueApply: async () => undefined,
          enqueueEvaluate: async () => undefined,
          enqueueReconcileAt: async (at, key) => void scheduled.push({ at: at.toISOString(), key }),
        },
        now: () => now,
      });
      try {
        expect(await service.scheduleWindowBoundaries()).toBe(1);
        expect(scheduled).toEqual([{ at: window.endsAt, key: `PLN:${window.endsAt}` }]);
      } finally {
        await sql(`delete from "catalogue_price_designations" where "currency_code" = 'PLN'`);
      }
    });
  });
});
