import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogService } from '@endora-commerce/platform/composition';
import {
  CatalogAdminService,
  type CatalogEventBus,
} from '../../../../packages/modules/catalog/dist/backend/services/catalog-admin.service.js';
import { CatalogBulkUpdateService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-bulk-update.service.js';
import { BulkOperationService } from '../../../../packages/modules/catalog/dist/backend/services/bulk-operation.service.js';
import { createCatalogAdminProductVisibility } from '../../../../packages/modules/catalog/dist/backend/services/admin-product-visibility.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  productFingerprint,
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, scopePort } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T042 — bulk operations for a restricted administrator (FR-033; threat model TM-1,
 * TM-3 (2)).
 *
 *  - A bulk update names a hidden product exactly as it names a missing one: neither is written
 *    nor reported, and the selection is narrowed before it is applied or queued.
 *  - The bulk-operation list and detail show a restricted caller only operations whose selection
 *    holds no product hidden from them; undoing one that does answers as an unknown operation.
 *  - A queued operation resolves its requester's scope **at execution** and re-checks each
 *    product at its write: a product hidden from the requester by then is not written.
 */
const BULK = '/api/v1/admin/catalog/products/bulk-update';
const OPS = '/api/v1/admin/catalog/bulk-operations';

describe('catalog bulk operations — narrowed by the visibility category (spec 193, T042)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let opWithHidden: string;
  let opClean: string;

  const randoms = (n: number) => Array.from({ length: n }, () => randomUUID());
  const inject = async (method: 'GET' | 'POST', url: string, cookies: Record<string, string>, payload?: unknown) => {
    const res = await h.app.inject({ method, url, cookies, ...(payload !== undefined ? { payload: payload as never } : {}) });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };
  /** Queue an operation as the platform administrator (51 ids: above the inline threshold). */
  const queue = async (ids: string[]): Promise<string> => {
    const res = await inject('POST', BULK, ADMIN, { productIds: ids, fields: { status: 'active' } });
    expect(res.status, res.raw).toBe(202);
    return res.body.data.bulkOperationId as string;
  };
  /** The envelope with the asked id masked: a route echoing the id it was given tells nothing. */
  const masked = (raw: string, id: string) => raw.split(id).join('<id>').replace(/"requestId":"[^"]+"/, '');

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    opWithHidden = await queue([fx.hidden.id, fx.visible.id, ...randoms(49)]);
    opClean = await queue([fx.visible.id, ...randoms(50)]);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('inline: a hidden id is treated as a missing one — not written, not reported', async () => {
    const before = await productFingerprint(h, fx.hidden.id);
    const asHidden = await inject('POST', BULK, fx.restricted.cookies, {
      productIds: [fx.visible.id, fx.hidden.id],
      fields: { visibility: 'public' },
    });
    const asMissing = await inject('POST', BULK, fx.restricted.cookies, {
      productIds: [fx.visible.id, randomUUID()],
      fields: { visibility: 'public' },
    });
    expect(asHidden.status, asHidden.raw).toBe(200);
    expect(asHidden.body.data.results.map((r: { productId: string }) => r.productId)).toEqual([fx.visible.id]);
    expect(asHidden.body.data.summary).toEqual(asMissing.body.data.summary);
    expect(asHidden.raw).not.toContain(fx.hidden.id);
    expect(await productFingerprint(h, fx.hidden.id)).toEqual(before);
  });

  it('the list shows a restricted caller only operations whose selection holds no hidden product', async () => {
    const restricted = await inject('GET', `${OPS}?limit=100`, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    const ids = restricted.body.data.map((op: { id: string }) => op.id);
    expect(ids).toContain(opClean);
    expect(ids).not.toContain(opWithHidden);
    expect(restricted.raw).not.toContain(fx.hidden.id);
    const admin = await inject('GET', `${OPS}?limit=100`, ADMIN);
    expect(admin.body.data.map((op: { id: string }) => op.id)).toEqual(expect.arrayContaining([opClean, opWithHidden]));
    expect(restricted.body.pagination.total).toBeLessThan(admin.body.pagination.total);
    // The visible product is hidden from a role with no category: neither operation is shown.
    const none = await inject('GET', `${OPS}?limit=100`, fx.noCategory.cookies);
    expect(none.body.data.map((op: { id: string }) => op.id)).not.toContain(opClean);
  });

  it('the detail of an operation touching a hidden product answers as an unknown operation', async () => {
    const unknown = randomUUID();
    const hidden = await inject('GET', `${OPS}/${opWithHidden}`, fx.restricted.cookies);
    const absent = await inject('GET', `${OPS}/${unknown}`, fx.restricted.cookies);
    expect(hidden.status).toBe(404);
    expect(masked(hidden.raw, opWithHidden)).toEqual(masked(absent.raw, unknown));
    expect((await inject('GET', `${OPS}/${opClean}`, fx.restricted.cookies)).status).toBe(200);
    expect((await inject('GET', `${OPS}/${opWithHidden}`, ADMIN)).status).toBe(200);
  });

  it('undo of an operation touching a hidden product answers as an unknown operation and changes nothing', async () => {
    const row = async () =>
      (
        await h
          .em()
          .getConnection()
          .execute<Array<{ row: unknown }>>(`select row_to_json(o) as "row" from "catalog_bulk_operations" o where o."id" = ?`, [
            opWithHidden,
          ])
      )[0]?.row;
    const before = await row();
    const unknown = randomUUID();
    const hidden = await inject('POST', `${OPS}/${opWithHidden}/undo`, fx.restricted.cookies);
    const absent = await inject('POST', `${OPS}/${unknown}/undo`, fx.restricted.cookies);
    expect(hidden.status).toBe(404);
    expect(masked(hidden.raw, opWithHidden)).toEqual(masked(absent.raw, unknown));
    expect(await row()).toEqual(before);
  });

  it('TM-3 (2): the worker resolves the requester\'s scope at execution and re-checks each product at its write', async () => {
    const em = (): EntityManager => h.orm.em.fork();
    const events = new EventBus();
    const audit = new AuditLogService(em);
    const commandBus = new CommandBus(h.orm, audit, events);
    const visibility = createCatalogAdminProductVisibility({ isPresent: () => true, port: () => scopePort(h) });
    const catalogAdmin = new CatalogAdminService(
      em,
      events as CatalogEventBus,
      audit,
      undefined,
      commandBus,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      visibility,
    );
    const bulkUpdate = new CatalogBulkUpdateService(em, catalogAdmin, undefined, audit);
    const ops = new BulkOperationService(em, bulkUpdate, { events: events as CatalogEventBus, visibility }, commandBus);
    // Queued before the product left the requester's category — the payload still names it.
    const op = await ops.create({
      requestedByAdminUserId: fx.restricted.adminUserId,
      payload: { productIds: [fx.visible.id, fx.hidden.id], fields: { visibility: 'public' } },
    });
    const before = await productFingerprint(h, fx.hidden.id);
    await ops.processById(op.id);
    const done = await ops.get({ kind: 'system' }, op.id);
    expect(done?.status, JSON.stringify(done)).toBe('completed');
    expect(await productFingerprint(h, fx.hidden.id)).toEqual(before);
  });
});
