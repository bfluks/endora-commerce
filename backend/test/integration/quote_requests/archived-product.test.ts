import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { errorBodyOf } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, owner decision P-3 = A (2026-10-26) — a quote request refuses an
 * archived product on every path that names one (`contracts/consumers.md` row
 * 26). Each refusal is the answer the path already gave an unknown product:
 *
 *  - the buyer's create, draft edit and resubmit, cart conversion and the quick
 *    order build: the single `404 PRODUCT_NOT_FOUND`, byte-equal to an absent
 *    id's (FR-018 — nothing about the product is disclosed);
 *  - the operator's create on a customer's behalf and edit: `409
 *    PRODUCT_ARCHIVED`, catalog's code and sentence (owner decision P-3b = A —
 *    the operator is told why), where every other unavailability stays a
 *    warning (FR-018's operator exemption) and an absent id stays a 404;
 *  - the buyer's convert of an approved quote: the existing `409
 *    PRODUCT_NOT_FOUND` its edge case named ("archived between approve and
 *    convert"), before the basket is touched.
 *
 * Price lists are unchanged by the decision and are not exercised here.
 *
 * Archived is written as `archived_at` directly: the subject is the consumer,
 * and catalog's Archive action has its own tests.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 P-3 — quote requests refuse an archived product [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let live: MinimumProductFixture;
  let archived: MinimumProductFixture;
  /** Archived only once the quote naming it is approved. */
  let lateArchived: MinimumProductFixture;

  const setArchived = async (productId: string, at: Date | null) => {
    await h
      .em()
      .getConnection()
      .execute('update "products" set "archived_at" = ? where "id" = ?', [at, productId]);
  };

  const buyerCreate = (productIds: readonly string[]) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: productIds.map((productId) => ({ productId, quantity: 1 })) },
    });

  const expectAbsentRefusal = async (res: Awaited<ReturnType<typeof buyerCreate>>) => {
    expect(res.statusCode, res.body).toBe(404);
    const absent = await buyerCreate([live.id, randomUUID()]);
    expect(errorBodyOf(res)).toEqual(errorBodyOf(absent));
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    live = await createMinimumProduct(em, { sku: `S163-P3-LIVE-${RUN}`, nameEn: 'Live', namePl: 'Żywy', channelIds: channels });
    archived = await createMinimumProduct(em, { sku: `S163-P3-ARCH-${RUN}`, nameEn: 'Archived', namePl: 'Arch', channelIds: channels });
    lateArchived = await createMinimumProduct(em, { sku: `S163-P3-LATE-${RUN}`, nameEn: 'Late', namePl: 'Późny', channelIds: channels });
    await setArchived(archived.id, new Date());
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await setArchived(archived.id, null);
    await setArchived(lateArchived.id, null);
    await teardownBackendServer(h);
  });

  describe('the buyer', () => {
    it('create answers the absent product’s 404', async () => {
      await expectAbsentRefusal(await buyerCreate([live.id, archived.id]));
    });

    it('draft edit answers the same 404', async () => {
      const created = await buyerCreate([live.id]);
      expect(created.statusCode, created.body).toBe(201);
      const id = (created.json() as { data: { id: string } }).data.id;
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${id}`,
        cookies: CUSTOMER,
        payload: { items: [{ productId: archived.id, quantity: 1 }] },
      });
      await expectAbsentRefusal(res);
    });

    it('resubmit of a quote whose product was archived since answers the same 404', async () => {
      const created = await buyerCreate([lateArchived.id]);
      expect(created.statusCode, created.body).toBe(201);
      const id = (created.json() as { data: { id: string } }).data.id;
      await setArchived(lateArchived.id, new Date());
      try {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/quote-requests/${id}/resubmit`,
          cookies: CUSTOMER,
          payload: {},
        });
        await expectAbsentRefusal(res);
      } finally {
        await setArchived(lateArchived.id, null);
      }
    });

    it('the quick order build to a quote request answers the same 404', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/build',
        cookies: CUSTOMER,
        payload: { target: 'quote_request', items: [{ productId: archived.id, quantity: 1 }] },
      });
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('cart conversion of a basket whose product was archived since answers the same 404', async () => {
      const add = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        cookies: CUSTOMER,
        payload: { productId: lateArchived.id, quantity: 1 },
      });
      expect(add.statusCode, add.body).toBe(200);
      const cartId = (add.json() as { data: { id: string } }).data.id;
      await setArchived(lateArchived.id, new Date());
      try {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/cart/convert-to-quote-request',
          cookies: CUSTOMER,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(404);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      } finally {
        await setArchived(lateArchived.id, null);
        await h.em().getConnection().execute('delete from "cart_items" where "cart_id" = ?', [cartId]);
      }
    });

    it('convert of an approved quote whose product was archived since answers 409 and leaves the basket alone', async () => {
      const created = await buyerCreate([lateArchived.id]);
      expect(created.statusCode, created.body).toBe(201);
      const rfq = (created.json() as { data: { id: string; version: number } }).data;
      const priced = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${rfq.id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${rfq.version}"` },
        payload: { items: [{ productId: lateArchived.id, quantity: 1, agreedUnitPrice: 9 }] },
      });
      expect(priced.statusCode, priced.body).toBe(200);
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${rfq.id}`, cookies: CUSTOMER });
      const current = (detail.json() as { data: { currentRevisionNumber: number } }).data;
      const accepted = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${rfq.id}/accept-revision`,
        cookies: CUSTOMER,
        payload: { expectedRevisionNumber: current.currentRevisionNumber },
      });
      expect(accepted.statusCode, accepted.body).toBe(200);

      await setArchived(lateArchived.id, new Date());
      try {
        const res = await h.app.inject({
          method: 'POST',
          url: `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
          cookies: CUSTOMER,
          payload: {},
        });
        expect(res.statusCode, res.body).toBe(409);
        expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      } finally {
        await setArchived(lateArchived.id, null);
      }
    });
  });

  describe('the operator', () => {
    it('create on a customer’s behalf answers 409 PRODUCT_ARCHIVED and creates nothing', async () => {
      const count = async () => {
        const [row] = await h
          .em()
          .getConnection()
          .execute<Array<{ n: number }>>(
            'select count(*)::int as n from "quote_request_items" where "product_id" = ?',
            [archived.id],
          );
        if (!row) throw new Error('count(*) returned no row');
        return row.n;
      };
      const before = await count();
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [
            { productId: live.id, quantity: 1, agreedUnitPrice: 10 },
            { productId: archived.id, quantity: 1, agreedUnitPrice: 10 },
          ],
        },
      });
      expect(res.statusCode, res.body).toBe(409);
      const error = (res.json() as { error: { code: string; message: string; details?: unknown } }).error;
      expect(error.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
      expect(error.message).toBe('Product is archived.');
      // Checkpoint F (B-3): the refusal names the archived product.
      expect(error.details).toEqual({ productIds: [archived.id] });
      expect(await count()).toBe(before);
    });

    it('create still answers 404 PRODUCT_NOT_FOUND for an id that does not exist', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: randomUUID(), quantity: 1, agreedUnitPrice: 10 }],
        },
      });
      expect(res.statusCode, res.body).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('edit answers the same 409 PRODUCT_ARCHIVED', async () => {
      const created = await buyerCreate([live.id]);
      expect(created.statusCode, created.body).toBe(201);
      const rfq = (created.json() as { data: { id: string; version: number } }).data;
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${rfq.id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${rfq.version}"` },
        payload: { items: [{ productId: archived.id, quantity: 1, agreedUnitPrice: 9 }] },
      });
      expect(res.statusCode, res.body).toBe(409);
      const error = (res.json() as { error: { code: string; details?: unknown } }).error;
      expect(error.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
      expect(error.details).toEqual({ productIds: [archived.id] });
    });

    it('create still accepts the live product (the positive control)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/quote-requests',
        cookies: ADMIN,
        payload: {
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: TEST_CUSTOMER_ID,
          items: [{ productId: live.id, quantity: 1, agreedUnitPrice: 10 }],
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    });
  });
});
