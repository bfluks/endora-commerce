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
import { clearProductScopes, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T040) — quote-request lines and scoped availability
 * (`contracts/consumers.md` row 16, FR-018).
 *
 *  - a buyer's line naming a product not available at the request's (channel,
 *    language) refuses the whole request with the single not-found an absent
 *    product gets;
 *  - an operator creating a request on a customer's behalf is not refused — the
 *    exemption stands — and the answer names each such line in `warnings` with
 *    `PRODUCT_UNAVAILABLE_IN_SCOPE`.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 — quote request lines honour scoped availability [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;
  const createdRfqIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-RFQ-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-RFQ-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
  });

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id]);
    await teardownBackendServer(h);
  });

  it('refuses a buyer’s request naming a product off in the channel with the absent product’s 404', async () => {
    const create = (productId: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: CUSTOMER,
        payload: { items: [{ productId: on.id, quantity: 1 }, { productId, quantity: 1 }] },
      });
    const absent = await create(randomUUID());
    expect(absent.statusCode).toBe(404);
    const refused = await create(off.id);
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.json()).toEqual(absent.json());
    expect((refused.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
  });

  it('accepts an operator’s request on the customer’s behalf and warns about the unavailable line', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [
          { productId: on.id, quantity: 1, agreedUnitPrice: 10 },
          { productId: off.id, quantity: 1, agreedUnitPrice: 10 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const body = res.json() as {
      data: { id: string };
      warnings?: Array<{ productId: string; code: string }>;
    };
    createdRfqIds.push(body.data.id);
    expect(body.warnings).toEqual([{ productId: off.id, code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }]);
  });

  it('carries no warnings when every line is available', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: on.id, quantity: 1, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).not.toHaveProperty('warnings');
  });
});
