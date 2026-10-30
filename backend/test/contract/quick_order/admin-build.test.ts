import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, QUICK_ORDER_BUILD_MAX_ITEMS } from '@endora-commerce/contracts';
import { Cart, CartItem } from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 039 (US1 / FR-008) — admin quick-order import + build on behalf of
 * a customer. Guarded by `orders:write`; the stub admin session holds
 * wildcard permissions.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const SIMPLE_SKU = 'EXAMPLE-SIMPLE-001';

describe('Admin quick-order on behalf', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects an unauthenticated import', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/import',
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},1` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('imports and builds a quote request on behalf of a customer', async () => {
    const importRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/import',
      cookies: ADMIN_COOKIE,
      payload: { csv: `sku,quantity\n${SIMPLE_SKU},3` },
    });
    expect(importRes.statusCode).toBe(200);
    const recognized = (
      importRes.json() as {
        data: { recognized: Array<{ productId: string; variantId: string | null; quantity: number }> };
      }
    ).data.recognized;
    expect(recognized.length).toBe(1);

    const buildRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/build',
      cookies: ADMIN_COOKIE,
      payload: {
        target: 'quote_request',
        onBehalfOf: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID },
        items: recognized.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
        })),
      },
    });
    expect(buildRes.statusCode).toBe(200);
    const body = buildRes.json() as { data: { target: string; quoteRequestId: string } };
    expect(body.data.target).toBe('quote_request');
    expect(body.data.quoteRequestId).toBeTruthy();
  });

  it('requires onBehalfOf for an admin build', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quick-order/build',
      cookies: ADMIN_COOKIE,
      payload: {
        target: 'cart',
        items: [{ productId: '00000000-0000-4000-8000-000000000101', quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  /**
   * Feature 155, Phase 9 (T067) — US4 #1d: the operator's preview keeps a row
   * below the minimum buildable and warns; the operator's build into the
   * customer's cart still rejects it (FR-011 (b)). The quote half (Phase 11,
   * T084): the build to a quote request creates it and the admin read warns.
   * Plus the item bound on the admin build (FR-038).
   */
  describe('155 — order minimums', () => {
    const RUN = minimumFixtureRun();
    let A: MinimumProductFixture;
    let D: MinimumProductFixture;
    const ON_BEHALF = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };

    beforeAll(async () => {
      const em = h.em();
      const channels = await buyerChannelIds(em);
      A = await createMinimumProduct(em, {
        sku: `QOA-A-${RUN}`,
        nameEn: `Anchor ${RUN}`,
        namePl: `Kotwa ${RUN}`,
        minOrderQuantity: 10,
        channelIds: channels,
      });
      D = await createMinimumProduct(em, {
        sku: `QOA-D-${RUN}`,
        nameEn: `Dowel ${RUN}`,
        namePl: `Kolek ${RUN}`,
        channelIds: channels,
      });
      await em
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
    }, 60_000);

    it('US4 #1d — the operator import keeps A × 5 recognised with a warning and counts warningCount', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quick-order/import',
        cookies: ADMIN_COOKIE,
        payload: { csv: `sku,quantity\n${A.sku},5\n${D.sku},1` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (
        res.json() as {
          data: {
            recognized: Array<{ productId: string; quantity: number; warning?: unknown }>;
            rejected: unknown[];
            summary: { recognizedCount: number; rejectedCount: number; warningCount?: number };
          };
        }
      ).data;
      expect(data.rejected).toEqual([]);
      expect(data.recognized.map((r) => [r.productId, r.quantity, r.warning ?? null])).toEqual([
        [A.id, 5, { reason: 'below_minimum', minimum: 10, productTotal: 5 }],
        [D.id, 1, null],
      ]);
      expect(data.summary).toMatchObject({ recognizedCount: 2, rejectedCount: 0, warningCount: 1 });
    });

    it("US4 #1d — the operator's build into the customer's cart rejects A × 5 and adds D", async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quick-order/build',
        cookies: ADMIN_COOKIE,
        headers: { 'accept-language': 'en' },
        payload: {
          target: 'cart',
          onBehalfOf: ON_BEHALF,
          items: [
            { productId: A.id, quantity: 5 },
            { productId: D.id, quantity: 1 },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: { rejected?: unknown[] } }).data;
      expect(data.rejected).toEqual([
        {
          productId: A.id,
          variantId: null,
          quantity: 5,
          productName: A.nameEn,
          reason: 'below_minimum',
          kind: 'pieces',
          minimum: 10,
        },
      ]);
      const em = h.em();
      em.clear();
      const cart = await em.findOneOrFail(Cart, { customerAccountId: TEST_CUSTOMER_ID, status: 'active' }, { filters: false });
      const lines = (await em.find(CartItem, { cartId: cart.id }, { filters: false }))
        .filter((l) => l.productId === A.id || l.productId === D.id)
        .map((l) => [l.productId, l.quantity]);
      expect(lines).toEqual([[D.id, 1]]);
    });

    it('US4 #1d, #15 — the operator build of A × 5 into a quote request creates it and the admin read warns', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quick-order/build',
        cookies: ADMIN_COOKIE,
        payload: {
          target: 'quote_request',
          onBehalfOf: ON_BEHALF,
          items: [
            { productId: A.id, quantity: 5 },
            { productId: D.id, quantity: 1 },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const { quoteRequestId } = (res.json() as { data: { quoteRequestId: string } }).data;
      const read = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/quote-requests/${quoteRequestId}`,
        cookies: ADMIN_COOKIE,
      });
      expect(read.statusCode, read.body).toBe(200);
      const items = (
        read.json() as { data: { items: Array<{ productId: string; quantity: number; minimumWarning?: unknown }> } }
      ).data.items;
      const byProduct = new Map(items.map((i) => [i.productId, i]));
      expect(byProduct.get(A.id)?.minimumWarning).toEqual({ kind: 'pieces', minimum: 10 });
      expect(byProduct.get(D.id)).toHaveProperty('minimumWarning', null);
    });

    it('US4 #17 — an admin build of 201 items is refused 422 too_many_items', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quick-order/build',
        cookies: ADMIN_COOKIE,
        payload: {
          target: 'quote_request',
          onBehalfOf: ON_BEHALF,
          items: Array.from({ length: QUICK_ORDER_BUILD_MAX_ITEMS + 1 }, () => ({ productId: D.id, quantity: 1 })),
        },
      });
      expect(res.statusCode, res.body).toBe(422);
      const error = (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
      expect(error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(error.details).toMatchObject({ code: 'too_many_items', maximum: QUICK_ORDER_BUILD_MAX_ITEMS });
    });
  });
});
