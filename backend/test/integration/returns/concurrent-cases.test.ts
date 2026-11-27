import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnCaseItem } from '../../helpers/package-entities.js';
import { CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #417, review of PR #423 — case creation is serialised per order. The
 * quantity check and the cumulative default refunds both read the order's
 * earlier cases; two cases created at once on one order both read none, so
 * both could return the last unit and both refund it. The second must wait for
 * the first and see it.
 */
describe('returns — concurrent cases on one order', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lets one of two simultaneous cases return the last unit, and refuses the other', async () => {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    // The second seeded line has a quantity of 1.
    const create = () =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/returns',
        cookies: CUSTOMER_COOKIE,
        payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[1], quantity: 1, reasonId }] },
      });
    const results = await Promise.all([create(), create(), create()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422, 422]);
    const items = await withSystemScope('test: count the cases', () =>
      h.em().fork().find(ReturnCaseItem, { orderItemId: itemIds[1]! }),
    );
    expect(items, 'one case holds the last unit').toHaveLength(1);
  });
});
