import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import type { CartWritePort } from '@endora-commerce/contracts';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';

/**
 * Feature 163, Phase 22 (T135, T138; FR-079, US9 #5; owner decision 2026-10-26) — a
 * basket line ordered by a packaging unit snapshots the unit's name **in the basket's
 * language** (`effectivePackagingUnitName` at `basketScopeLanguage`), and keeps it when
 * the unit is renamed afterwards. The order line copies the basket's snapshot
 * (`order-service.ts`, `item.packagingUnitName`), so it keeps the same name.
 *
 * The channel is the seeded `pl_retail`; its default language is read, not assumed, and
 * the translation is keyed by it.
 *
 * Owner decision N2 = B (2026-10-26) — a caller that names the channel itself (an
 * operator surface, through `CartWritePort` with `salesChannelId`) has no request
 * language: the unit name is snapshotted at that channel's default language, as the
 * product name beside it is. No HTTP route passes a unit with a named channel today, so
 * the third case drives the port as such a surface would.
 *
 * Final QA Q-M3 — the last case places the order and renames the unit afterwards: the
 * order line keeps the name it was placed with.
 */

/** The warehouse `seedUs2Commerce` stocks (`backend/test/helpers/seed-commerce.ts`). */
const SEED_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

const BUYER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

describe('163 — packaging-unit name snapshot in the basket language [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  let language: string;
  let unitId: string;
  let channelId: string;

  const headers = (): Record<string, string> => ({ 'x-sales-channel': 'pl_retail', 'accept-language': language });

  const completeActiveBaskets = () =>
    h
      .em()
      .getConnection()
      .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
        TEST_CUSTOMER_ID,
      ]);

  async function basketLine(): Promise<{ packagingUnitName: string | null } | undefined> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies: BUYER, headers: headers() });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ productId: string; packagingUnitName: string | null }> } })
      .data.items;
    return items.find((i) => i.productId === product.id);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    language = channel.defaultLanguage;
    channelId = channel.id;
    product = await createMinimumProduct(em, {
      sku: `S163-PU-${RUN}`,
      nameEn: 'Shelf',
      namePl: 'Regał',
      channelIds: [channel.id],
    });
    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units`,
      cookies: ADMIN,
      payload: { name: 'Carton', baseQuantity: 6, nameTranslations: { [language]: `Karton ${RUN}` } },
    });
    expect(unit.statusCode, unit.body).toBe(201);
    unitId = (unit.json() as { data: { id: string } }).data.id;
    await completeActiveBaskets();
  });

  afterAll(async () => {
    if (!h) return;
    await completeActiveBaskets();
    await h.em().getConnection().execute(`delete from stock_levels where product_id = ?`, [product.id]);
    await teardownBackendServer(h);
  });

  it('snapshots the name in the basket language and keeps it after a rename', async () => {
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: headers(),
      payload: { productId: product.id, quantity: 1, packagingUnitId: unitId },
    });
    expect(added.statusCode, added.body).toBeLessThan(300);
    expect((await basketLine())?.packagingUnitName).toBe(`Karton ${RUN}`);

    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { name: 'Box', nameTranslations: { [language]: `Pudło ${RUN}` } },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    // The line is a snapshot: never re-resolved.
    expect((await basketLine())?.packagingUnitName).toBe(`Karton ${RUN}`);
  });

  it('a language without a translation snapshots the global name', async () => {
    await completeActiveBaskets();
    const cleared = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { nameTranslations: { [language]: '' } },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: headers(),
      payload: { productId: product.id, quantity: 1, packagingUnitId: unitId },
    });
    expect(added.statusCode, added.body).toBeLessThan(300);
    expect((await basketLine())?.packagingUnitName).toBe('Box');
  });

  it("an operator naming the channel snapshots the name at the channel's default language (N2)", async () => {
    await completeActiveBaskets();
    const set = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { nameTranslations: { [language]: `Skrzynia ${RUN}` } },
    });
    expect(set.statusCode, set.body).toBe(200);
    const cartWrite = (h.container.cradle as unknown as { cartWritePort: CartWritePort }).cartWritePort;
    const added = await cartWrite.addItem(
      { customer: { customerAccountId: TEST_CUSTOMER_ID, organizationId: TEST_ORGANIZATION_ID, salesChannelId: channelId } },
      { productId: product.id, quantity: 1, packagingUnitId: unitId, salesChannelId: channelId },
    );
    const line = added.items.find((i) => i.productId === product.id);
    expect(line?.packagingUnitName).toBe(`Skrzynia ${RUN}`);
  });

  it('the order line keeps the unit name it was placed with after a rename (FR-079, US9 #5)', async () => {
    await completeActiveBaskets();
    const sql = (query: string, params: unknown[]) => h.em().getConnection().execute(query, params);
    // Placement needs stock in the seeded warehouse; `createMinimumProduct` writes none.
    await sql(
      `insert into stock_levels (id, product_id, warehouse_id, on_hand, reserved, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, 1000, 0, now(), now())`,
      [product.id, SEED_WAREHOUSE_ID],
    );
    const set = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { nameTranslations: { [language]: `Paleta ${RUN}` } },
    });
    expect(set.statusCode, set.body).toBe(200);
    const added = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      cookies: BUYER,
      headers: headers(),
      payload: { productId: product.id, quantity: 1, packagingUnitId: unitId },
    });
    expect(added.statusCode, added.body).toBeLessThan(300);

    const placed = await whenOrderCreatedSettled(h, async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        cookies: BUYER,
        headers: headers(),
        payload: {
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string } }).data;
    });

    const renamed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units/${unitId}`,
      cookies: ADMIN,
      payload: { name: 'Crate', nameTranslations: { [language]: `Inne ${RUN}` } },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);

    const rows = (await sql(
      `select packaging_unit_snapshot, product_snapshot from order_items where order_id = ? and product_id = ?`,
      [placed.id, product.id],
    )) as Array<{ packaging_unit_snapshot: { name: string } | null; product_snapshot: { name: string } }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.packaging_unit_snapshot?.name).toBe(`Paleta ${RUN}`);
    expect(rows[0]!.product_snapshot.name).toContain(`(Paleta ${RUN})`);
  });
});
