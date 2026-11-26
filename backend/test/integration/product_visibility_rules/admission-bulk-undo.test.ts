import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CatalogAdminService, type CatalogEventBus } from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { SYSTEM_PRODUCT_SCOPE } from '../../../../packages/modules/catalog/dist/backend/services/admin-product-visibility.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { attachRuleBySql, clearWebsiteRules, isMember, websiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 T068 QA addition — the `product.bulk_update.undo` reactivation hook
 * (`reactivation-bulk-update-undo`, product_visibility_rules/src/backend/index.ts). `admission.test.ts`
 * covers six of the seven hooked Commands but never drives the undo: a bulk edit to inactive, undone,
 * restores the product to active — a reactivation on a governed channel (FR-092) — so the governed
 * membership must be removed in the undo's transaction and the product marked.
 *
 * The services are built over the harness's own command bus and entity manager, so the module's
 * hooks run exactly as in production.
 */
describe('website-rule reactivation through the bulk-edit undo (spec 193, T068, FR-092)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let bulkOps: BulkOperationService;
  let colour: string;
  let governed: string;
  const admin = randomUUID();
  const service = () => websiteRules(h) as unknown as { markProducts(ids: readonly string[]): Promise<void>; evaluateMarked(): Promise<{ changed: number }> };

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    fx = scopedValuesFixture(() => h);
    colour = await fx.attribute({ key: 'undo_colour', valueType: 'select', options: ['red', 'blue'] });
    governed = await fx.channel(['pl-PL']);
    await attachRuleBySql(h, [governed], `Undo ${fx.run}`, {
      match: 'all',
      conditions: [{ kind: 'attribute_choice', attributeKey: colour, optionKeys: ['red'] }],
    });
    const em = (): EntityManager => h.orm.em.fork();
    const cradle = h.container.cradle as unknown as Record<string, never>;
    const commandBus = cradle['commandBus'];
    const audit = cradle['auditLogService'];
    const catalogAdmin = new CatalogAdminService(em, h.eventBus as unknown as CatalogEventBus, audit, undefined, commandBus);
    const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
    bulkOps = new BulkOperationService(em, bulkUpdate, { events: h.eventBus as unknown as CatalogEventBus }, commandBus);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await fx?.cleanup();
    await teardownBackendServer(h);
  });

  const statusOf = async (id: string) => (await fx.sql<{ status: string }>(`select status from products where id = ?`, [id]))[0]!.status;
  const markedFor = async (id: string) => (await fx.sql(`select 1 from website_rule_stale_products where product_id = ?`, [id])).length > 0;

  it('undoing a bulk status edit to inactive reactivates the product: governed membership removed, admission deleted, product marked', async () => {
    const id = await fx.product({ attributeValues: { [colour]: 'red' } });
    await service().markProducts([id]);
    await service().evaluateMarked();
    expect(await isMember(h, governed, id)).toBe(true);
    await fx.sql(`delete from website_rule_stale_products where product_id = ?`, [id]);

    const op = await bulkOps.create({ requestedByAdminUserId: admin, payload: { productIds: [id], fields: { status: 'inactive' } } });
    await bulkOps.processById(op.id);
    expect(await statusOf(id)).toBe('inactive');
    expect(await isMember(h, governed, id)).toBe(true); // going inactive is not a reactivation
    await fx.sql(`delete from website_rule_stale_products where product_id = ?`, [id]);

    const res = await withSystemScope('qa undo', () => bulkOps.undo(SYSTEM_PRODUCT_SCOPE, op.id));
    expect(res.ok).toBe(true);
    expect(await statusOf(id)).toBe('active');
    expect(await isMember(h, governed, id), 'the undo restored active but left the governed membership').toBe(false);
    expect((await fx.sql(`select 1 from website_rule_admissions where sales_channel_id = ? and product_id = ?`, [governed, id])).length).toBe(0);
    expect(await markedFor(id)).toBe(true);
  });
});
