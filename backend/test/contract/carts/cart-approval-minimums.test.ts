import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 148, owner ruling 2026-10-18 — a basket that cannot be ordered cannot be
 * sent for approval either.
 *
 * `POST /api/v1/cart/submit-for-approval` refuses a basket with a line below a
 * minimum the way placement does (`422 PRODUCT_BELOW_MINIMUM_QUANTITY`, every
 * flagged line in `details.lines` with its `cartItemId`), judged exactly as the
 * full cart view flags it, and the cart's `approvalStatus` stays `not_required`.
 * A basket that meets its minimums is submitted as before.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('148 — submit-for-approval refuses a basket below a minimum [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const MEMBER_ID = randomUUID();
  const COOKIE = `stub-148-approval-member-${RUN}`;
  const cookies = { b2b_session: COOKIE };
  let product: MinimumProductFixture;
  let policyBefore = false;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    product = await createMinimumProduct(em, {
      sku: `CAM-${RUN}`,
      nameEn: `Approval bolt ${RUN}`,
      namePl: `Śruba akceptacji ${RUN}`,
      channelIds: channels,
    });
    // An ordinary member: an Org Admin's own cart is exempt from approval.
    const member = em.create(CustomerAccount, {
      id: MEMBER_ID,
      organizationId: TEST_ORGANIZATION_ID,
      email: `approval-member-${RUN}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Approval',
      lastName: 'Member',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(member);
    CUSTOMER_COOKIES[COOKIE] = { customerAccountId: MEMBER_ID, organizationId: TEST_ORGANIZATION_ID };

    const org = await em.findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    policyBefore = org.requiresCartApproval;
    org.requiresCartApproval = true;
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    delete CUSTOMER_COOKIES[COOKIE];
    const em = h.em();
    const org = await em.findOne(Organization, { id: TEST_ORGANIZATION_ID });
    if (org) {
      org.requiresCartApproval = policyBefore;
      await em.flush();
    }
    await teardownBackendServer(h);
  });

  async function cartView(): Promise<{ approvalStatus: string; items: Array<{ id: string; belowMinimum?: unknown }> }> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies, headers: CHANNEL });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { approvalStatus: string; items: Array<{ id: string }> } }).data;
  }

  async function submit() {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/submit-for-approval',
      cookies,
      headers: { ...CHANNEL, 'accept-language': 'en' },
    });
  }

  it('refuses a line below the pieces minimum with 422 and leaves the cart not_required', async () => {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { productId: product.id, quantity: 3 },
    });
    expect(add.statusCode, add.body).toBe(200);
    await setProductMinimum(h.em(), product.id, 10);

    const before = await cartView();
    expect(before.approvalStatus).toBe('not_required');
    const lineId = before.items[0]!.id;
    expect(before.items[0]!.belowMinimum).toMatchObject({ kind: 'pieces', minimum: 10 });

    const res = await submit();
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe('PRODUCT_BELOW_MINIMUM_QUANTITY');
    expect(body.error.details).toMatchObject({
      productId: product.id,
      minimum: 10,
      lines: [{ cartItemId: lineId, productId: product.id, kind: 'pieces', minimum: 10 }],
    });

    expect((await cartView()).approvalStatus).toBe('not_required');
  });

  it('submits the basket once the line meets its minimum', async () => {
    const lineId = (await cartView()).items[0]!.id;
    const edit = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${lineId}`,
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload: { quantity: 10 },
    });
    expect(edit.statusCode, edit.body).toBe(200);

    const res = await submit();
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { approvalStatus: string } }).data.approvalStatus).toBe('pending');
  });
});
