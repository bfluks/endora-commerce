import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminPermissionChecker } from '@endora-commerce/platform/kernel';
import { BulkOperationService } from './bulk-operation.service.js';
import type { CatalogBulkUpdateService } from './catalog-bulk-update.service.js';

/**
 * Feature 163, checkpoint F (S-3) — a queued product bulk operation runs later, acting
 * for the admin who queued it. At worker start the requester must still be an active
 * administrator holding `catalog:write`; otherwise the operation fails closed, writing
 * no product, instead of running with a permission the requester no longer has.
 */
const REQUESTER = '00000000-0000-4000-8000-0000000000aa';
const OP = '00000000-0000-4000-8000-0000000000bb';

function harness(checker: AdminPermissionChecker | undefined) {
  const op = {
    id: OP,
    type: 'product_bulk_update',
    status: 'pending',
    requestedByAdminUserId: REQUESTER,
    total: 1,
    payload: { productIds: ['00000000-0000-4000-8000-000000000001'], fields: { archived: true } },
    logs: [],
  };
  const updates: Array<Record<string, unknown>> = [];
  const em = {
    nativeUpdate: vi.fn(async (_e: unknown, _w: unknown, data: Record<string, unknown>) => {
      updates.push(data);
      return 1;
    }),
    findOne: vi.fn(async () => op),
  };
  const bulkUpdate = vi.fn(async () => ({
    summary: { total: 1, succeeded: 1, skipped: 0, failed: 0 },
    results: [{ productId: op.payload.productIds[0], status: 'succeeded' }],
  }));
  const service = new BulkOperationService(
    () => em as unknown as EntityManager,
    { bulkUpdate } as unknown as CatalogBulkUpdateService,
    checker ? { permissionChecker: checker } : {},
  );
  const finalStatus = () => [...updates].reverse().find((u) => u['status'] !== undefined)?.['status'];
  return { service, bulkUpdate, finalStatus, updates };
}

const checker = (active: boolean, mayWrite: boolean): AdminPermissionChecker => ({
  isActiveAdministrator: vi.fn(async () => active),
  hasPermission: vi.fn(async (_id: string, code: string) => mayWrite && code === 'catalog:write'),
});

describe('a queued bulk operation re-checks its requester at worker start (163 S-3)', () => {
  it('runs when the requester is active and holds catalog:write', async () => {
    const h = harness(checker(true, true));
    await h.service.processById(OP);
    expect(h.bulkUpdate).toHaveBeenCalledTimes(1);
    expect(h.finalStatus()).toBe('completed');
  });

  it('fails closed, writing nothing, when the requester lost catalog:write', async () => {
    const h = harness(checker(true, false));
    await h.service.processById(OP);
    expect(h.bulkUpdate).not.toHaveBeenCalled();
    expect(h.finalStatus()).toBe('failed');
  });

  it('fails closed when the requester is no longer an active administrator', async () => {
    const h = harness(checker(false, true));
    await h.service.processById(OP);
    expect(h.bulkUpdate).not.toHaveBeenCalled();
    expect(h.finalStatus()).toBe('failed');
  });

  it('fails closed when the permission check itself cannot answer', async () => {
    const h = harness({
      isActiveAdministrator: vi.fn(async () => {
        throw new Error('admin_roles is off');
      }),
      hasPermission: vi.fn(async () => true),
    });
    await h.service.processById(OP);
    expect(h.bulkUpdate).not.toHaveBeenCalled();
    expect(h.finalStatus()).toBe('failed');
  });
});
