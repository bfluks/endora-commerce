import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OrderItem, Product } from '../../helpers/package-entities.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { checkOutBasket, whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 163, Phase 12 (T083, US10 #2, FR-100; research R26) — "returnable" is the
 * **order's channel's**: placement stamps `order_items.returnable_at_purchase` from
 * the channel's effective flag (its `product_channel_scopes.returnable` override, else
 * the global flag), so `returns` — which reads only the stamp — offers a return on
 * orders of the channel where the product is returnable and not elsewhere.
 *
 * The orders are placed through checkout on the buyer's system-default channel
 * ("B2C"); the other buyer channel (`pl_retail`, "B2B") holds the contrasting row.
 */

const CTX = { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID };

describe('163 — order rules per channel: returnable at purchase (T083) [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let b2c = '';
  let b2b = '';
  let X: MinimumProductFixture;

  const conn = () => h.em().getConnection();

  async function setChannelReturnable(channelId: string, returnable: boolean | null): Promise<void> {
    await conn().execute(
      `insert into product_channel_scopes (product_id, sales_channel_id, returnable, created_at, updated_at)
       values (?, ?, ?, now(), now())
       on conflict (product_id, sales_channel_id) do update set returnable = excluded.returnable, updated_at = now()`,
      [X.id, channelId, returnable],
    );
  }

  const completeActiveBaskets = () =>
    conn().execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
      TEST_CUSTOMER_ID,
    ]);

  /** Checkout of one X on the buyer's B2C basket; answers X's stamp. */
  async function placeAndStamp(): Promise<boolean | null | undefined> {
    await cartWritePortOf(h).replaceItemsForCustomer({ ...CTX, salesChannelId: b2c }, [
      { productId: X.id, quantity: 1, unitPrice: '10.00', currency: 'PLN' },
    ]);
    const order = await whenOrderCreatedSettled(h, () => checkOutBasket(h));
    const em = h.em();
    em.clear();
    const [line] = await em.find(OrderItem, { orderId: order.id }, { filters: false });
    return line?.returnableAtPurchase;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    b2c = await systemDefaultSalesChannelId(em);
    const channels = Array.from(new Set([b2c, ...(await buyerChannelIds(em))]));
    const other = channels.find((id) => id !== b2c);
    if (other === undefined) throw new Error('a second buyer channel is not seeded');
    b2b = other;
    X = await createMinimumProduct(em, {
      sku: `RET163-X-${RUN}`,
      nameEn: `Returnable in B2C ${RUN}`,
      namePl: `Zwrotny w B2C ${RUN}`,
      returnable: false,
      channelIds: channels,
    });
    await em.nativeUpdate(Product, { id: X.id }, { manageStock: false });
  }, 120_000);

  beforeEach(async () => {
    await completeActiveBaskets();
    await conn().execute(`delete from product_channel_scopes where product_id = ?`, [X.id]);
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    if (X) await conn().execute(`delete from product_channel_scopes where product_id = ?`, [X.id]);
    await teardownBackendServer(h);
  });

  it('returnable only in B2C: an order there is stamped returnable (US10 #2)', async () => {
    await setChannelReturnable(b2c, true);
    expect(await placeAndStamp()).toBe(true);
  });

  it('returnable only in B2B: an order in B2C is stamped not returnable', async () => {
    await setChannelReturnable(b2b, true);
    expect(await placeAndStamp()).toBe(false);
  });

  it('no channel override: the global flag stands', async () => {
    expect(await placeAndStamp()).toBe(false);
  });

  it('a channel override of false beats a global true', async () => {
    await h.em().nativeUpdate(Product, { id: X.id }, { returnable: true });
    try {
      await setChannelReturnable(b2c, false);
      expect(await placeAndStamp()).toBe(false);
      await setChannelReturnable(b2c, null);
      expect(await placeAndStamp()).toBe(true);
    } finally {
      await h.em().nativeUpdate(Product, { id: X.id }, { returnable: false });
    }
  });
});
