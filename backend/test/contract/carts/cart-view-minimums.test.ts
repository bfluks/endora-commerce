import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogProductReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { cartWritePortOf } from '../../helpers/orders-neighbour-ports.js';
import { ensureSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  setProductMinimum,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 6 (T041) — the full cart view flags lines below a minimum
 * (`contracts/cart-and-checkout-api.md` §3; FR-013, FR-028, FR-037; research
 * R11, plan deviation D7).
 *
 * - `minOrderQuantity`: the product's current pieces minimum, `null` for none.
 * - `belowMinimum`: set when the line is below a current minimum and not exempt.
 * - A line whose product record is gone reads `unavailable: true`,
 *   `unavailableReason: 'not_purchasable'`, `belowMinimum: null`.
 * - A failed catalogue read fails the view (D7) rather than answering a cart
 *   without flags.
 * - `?view=mini` is unchanged.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

interface ViewLine {
  id: string;
  productId: string;
  quantity: number;
  unavailable: boolean;
  unavailableReason: string | null;
  minOrderQuantity?: number | null;
  belowMinimum?: { kind: string; minimum: number; packagingUnitName?: string } | null;
}

describe('155 — GET /api/v1/cart flags lines below a minimum [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let raised: MinimumProductFixture;
  let plain: MinimumProductFixture;
  let palletised: MinimumProductFixture;
  let pallet = '';
  const PALLET_NAME = `Pallet V ${RUN}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    raised = await createMinimumProduct(em, {
      sku: `CVM-R-${RUN}`,
      nameEn: `Raised ${RUN}`,
      namePl: `Podniesiony ${RUN}`,
      channelIds: channels,
    });
    plain = await createMinimumProduct(em, {
      sku: `CVM-P-${RUN}`,
      nameEn: `Plain ${RUN}`,
      namePl: `Zwykły ${RUN}`,
      channelIds: channels,
    });
    palletised = await createMinimumProduct(em, {
      sku: `CVM-U-${RUN}`,
      nameEn: `Palletised ${RUN}`,
      namePl: `Paletowy ${RUN}`,
      channelIds: channels,
    });
    pallet = await createMinimumPackagingUnit(em, {
      productId: palletised.id,
      name: PALLET_NAME,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const basket = () => ({ b2b_cart_anon: `anon-148-view-${randomUUID()}` });

  async function add(cookies: Record<string, string>, payload: Record<string, unknown>) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies,
      headers: { ...CHANNEL, 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { id: string; items: ViewLine[] } }).data;
  }

  async function view(cookies: Record<string, string>, query = '') {
    return h.app.inject({ method: 'GET', url: `/api/v1/cart${query}`, cookies, headers: CHANNEL });
  }

  async function lines(cookies: Record<string, string>): Promise<ViewLine[]> {
    const res = await view(cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { items: ViewLine[] } }).data.items;
  }

  it('US1 #5 — a line below a minimum raised after it was added is flagged, with the minimum', async () => {
    const cookies = basket();
    await add(cookies, { productId: raised.id, quantity: 3 });
    await setProductMinimum(h.em(), raised.id, 10);
    try {
      const [line] = await lines(cookies);
      expect(line).toMatchObject({
        productId: raised.id,
        quantity: 3,
        minOrderQuantity: 10,
        belowMinimum: { kind: 'pieces', minimum: 10 },
        unavailable: false,
      });
    } finally {
      await setProductMinimum(h.em(), raised.id, null);
    }
  });

  it('a line at or above the minimum reads belowMinimum null; a product without one reads minOrderQuantity null', async () => {
    const cookies = basket();
    await add(cookies, { productId: raised.id, quantity: 12 });
    await add(cookies, { productId: plain.id, quantity: 1 });
    await setProductMinimum(h.em(), raised.id, 10);
    try {
      const byProduct = new Map((await lines(cookies)).map((l) => [l.productId, l]));
      expect(byProduct.get(raised.id)).toMatchObject({ minOrderQuantity: 10, belowMinimum: null });
      expect(byProduct.get(plain.id)).toMatchObject({ minOrderQuantity: null, belowMinimum: null });
    } finally {
      await setProductMinimum(h.em(), raised.id, null);
    }
  });

  it('a pallet line below the unit minimum is flagged with the unit name', async () => {
    const cookies = basket();
    const cart = await add(cookies, { productId: palletised.id, packagingUnitId: pallet, quantity: 2 });
    // Cut to one pallet behind the cart's back: the basket a raised unit minimum leaves.
    await h
      .em()
      .getConnection()
      .execute(`update cart_items set quantity = 64 where id = ?`, [cart.items[0]!.id]);
    const [line] = await lines(cookies);
    expect(line!.belowMinimum).toEqual({ kind: 'packaging_unit', minimum: 2, packagingUnitName: PALLET_NAME });
  });

  it('an exempt quote-seeded line reads belowMinimum null', async () => {
    await setProductMinimum(h.em(), raised.id, 10);
    try {
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: TEST_CUSTOMER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          // The basket of the channel the views below are read on.
          salesChannelId: await ensureSalesChannelId(h.em(), CHANNEL['x-sales-channel']),
        },
        [{ productId: raised.id, quantity: 5, unitPrice: '10.00', currency: 'PLN' }],
        { sourceQuoteRequestId: randomUUID() },
      );
      const [line] = await lines(CUSTOMER);
      expect(line).toMatchObject({ productId: raised.id, quantity: 5, minOrderQuantity: 10, belowMinimum: null });
    } finally {
      await setProductMinimum(h.em(), raised.id, null);
      await cartWritePortOf(h).replaceItemsForCustomer(
        {
          customerAccountId: TEST_CUSTOMER_ID,
          organizationId: TEST_ORGANIZATION_ID,
          // The basket of the channel the views below are read on.
          salesChannelId: await ensureSalesChannelId(h.em(), CHANNEL['x-sales-channel']),
        },
        [],
      );
    }
  });

  it('FR-037 — a line whose product row is gone is unavailable / not_purchasable with belowMinimum null', async () => {
    const cookies = basket();
    const cart = await add(cookies, { productId: plain.id, quantity: 1 });
    const ghostItemId = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into cart_items (id, cart_id, product_id, quantity, unit_price, currency, created_at, updated_at)
         values (?, ?, ?, 3, 10, 'PLN', now() + interval '1 second', now())`,
        [ghostItemId, cart.id, randomUUID()],
      );
    const ghost = (await lines(cookies)).find((l) => l.id === ghostItemId);
    expect(ghost).toMatchObject({
      unavailable: true,
      unavailableReason: 'not_purchasable',
      belowMinimum: null,
    });
    const live = (await lines(cookies)).find((l) => l.productId === plain.id);
    expect(live).toMatchObject({ unavailable: false, unavailableReason: null });
  });

  it('D7 — a failed catalogue read answers 5xx, not a cart without flags', async () => {
    const cookies = basket();
    await add(cookies, { productId: plain.id, quantity: 1 });
    const catalog = (h.container.cradle as unknown as { catalogProductReadPort: CatalogProductReadPort })
      .catalogProductReadPort;
    const spy = vi.spyOn(catalog, 'findByIds').mockRejectedValueOnce(new Error('catalogue read failed'));
    try {
      const res = await view(cookies);
      expect(res.statusCode, res.body).toBeGreaterThanOrEqual(500);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect((await view(cookies)).statusCode).toBe(200);
  });

  it('?view=mini is unchanged — no minimum keys, no availability keys', async () => {
    const cookies = basket();
    await add(cookies, { productId: plain.id, quantity: 1 });
    const res = await view(cookies, '?view=mini');
    expect(res.statusCode, res.body).toBe(200);
    const [line] = (res.json() as { data: { items: Array<Record<string, unknown>> } }).data.items;
    expect(Object.keys(line!).sort()).toEqual(['id', 'lineTotal', 'productId', 'quantity', 'unitPrice', 'variantId']);
  });
});
