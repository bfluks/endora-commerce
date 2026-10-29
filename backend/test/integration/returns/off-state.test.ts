import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrderReturnContextPort } from '@endora-commerce/contracts';
import { RETURNS_SETTING_CODES } from '@endora-commerce/mod-returns';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import { OrderItem, Product } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { checkOutBasket, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';

/**
 * `returns` off-state — Constitution XVII item 6.
 *
 * The module's prior off-state coverage is
 * `_admin_surfaces/batch-eight-palette-off-state.test.ts`, which asserts the
 * two palette actions go when the module does. That is feature 091's question;
 * item 6's are here, and the palette assertion is not repeated.
 *
 * The four surfaces item 6 asks for map onto this module as follows:
 *
 *  * **API rejection** — the admin RMA list and the return-status catalogue.
 *    The second is named separately because it answers from a workflow
 *    definition rather than from stored RMAs, and a workflow that keeps
 *    answering while its module is off is the module still being observable;
 *  * **storefront absence** — two buyer-facing routes, and they are different
 *    questions. `GET /api/v1/returns/reasons` is what the shop's return form
 *    is built from, and it answers to an anonymous caller: a switched-off
 *    returns module that still serves it invites a buyer into a flow that
 *    cannot complete. `GET /api/v1/returns` is the signed-in buyer's own RMA
 *    list;
 *  * **non-editable configuration** — the free-return window in days, an
 *    ordinary setting. `returns.enabled` is deliberately *not* the code
 *    written here: it is the module's activation control, the single exception
 *    item 6 names;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: RMAs, their comments, their settlements and the reason
 *    catalogue all stay, and the restored probes hold the routes to it.
 *
 * The **deactivated-while-platform-available** case is the first axis the
 * harness drives, and it is the one an operator creates: a shop that handles
 * returns by telephone switches this off from `/platform/modules` while the
 * deployment still offers it.
 */
describe('returns off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const channel = { 'x-sales-channel': 'default' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'returns', {
      routes: [
        { url: '/api/v1/admin/returns', cookies: admin },
        { url: '/api/v1/admin/returns/statuses', cookies: admin },
        { url: '/api/v1/returns/reasons', headers: channel },
        { url: '/api/v1/returns', headers: channel },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: RETURNS_SETTING_CODES.FREE_RETURN_DAYS,
        value: 7,
        cookies: admin,
      },
    });
  });
  /**
   * Feature 155, Phase 12 (T092; FR-016a, spec edge case *Module activation*,
   * `contracts/returns-api.md` §4). `orders` records `returnable_at_purchase`
   * at placement whether `returns` is on or off — it has no edge to `returns`
   * — so an order placed while `returns` is off answers from its own stamp
   * once `returns` is switched back on: the endpoint's per-line `returnable` is
   * derived from it (`returns`' policy, Phase 12a, T096), and the port reports
   * the stamp it reads.
   */
  it('records returnable_at_purchase while returns is off, and answers from it once it is back on', async () => {
    const em = h.em();
    const RUN = minimumFixtureRun();
    const channels = await buyerChannelIds(em);
    const R = await createMinimumProduct(em, {
      sku: `ROFF-R-${RUN}`,
      nameEn: `Returnable ${RUN}`,
      namePl: `Zwrotny ${RUN}`,
      returnable: true,
      channelIds: channels,
    });
    const N = await createMinimumProduct(em, {
      sku: `ROFF-N-${RUN}`,
      nameEn: `Final ${RUN}`,
      namePl: `Bezzwrotny ${RUN}`,
      returnable: false,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: { $in: [R.id, N.id] } }, { manageStock: false });
    await em
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

    const orderId = await withModuleOff('returns', 'deactivated', async () => {
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: TEST_CUSTOMER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: await systemDefaultSalesChannelId(h.em()),
        },
        [
          { productId: R.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
          { productId: N.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
        ],
      );
      const placed = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
      const lookup = h.em();
      lookup.clear();
      const items = await lookup.find(OrderItem, { orderId: placed.id }, { filters: false });
      expect(Object.fromEntries(items.map((i) => [i.productId, i.returnableAtPurchase]))).toEqual({
        [R.id]: true,
        [N.id]: false,
      });
      return placed.id;
    });

    // Back on: the endpoint answers the order, and the port it reads reports
    // the stamp recorded while `returns` was off.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/orders/${orderId}/returnable`,
      cookies: { b2b_session: 'stub-customer-session' },
      headers: channel,
    });
    expect(res.statusCode, res.body).toBe(200);
    const lines = (
      res.json() as {
        data: { lines: Array<{ productId: string; returnable: boolean; notReturnableReason?: string }> };
      }
    ).data.lines;
    expect(lines.map((l) => l.productId).sort()).toEqual([R.id, N.id].sort());
    // Phase 12a (T096): the per-line verdict `returns` derives from the stamp.
    expect(
      Object.fromEntries(lines.map((l) => [l.productId, [l.returnable, l.notReturnableReason ?? null]])),
    ).toEqual({ [R.id]: [true, null], [N.id]: [false, 'product_not_returnable'] });

    const port = (h.container.cradle as unknown as { orderReturnContextPort: OrderReturnContextPort })
      .orderReturnContextPort;
    const context = await port.getReturnContext(orderId);
    expect(
      Object.fromEntries((context?.lines ?? []).map((l) => [l.productId, l.returnableAtPurchase])),
    ).toEqual({ [R.id]: true, [N.id]: false });
  }, 120_000);
});
