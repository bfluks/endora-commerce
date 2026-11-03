import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 11 (T083) — a sales representative's quote-request
 * writes are never refused for a minimum; the admin read flags each line
 * below its product's current minimum, and the customer never sees the flag
 * (FR-012 actor rule, FR-030; US4 #9; threat S7;
 * `contracts/quote-requests-api.md` §4).
 *
 * - A: simple, minimum 10 pcs.
 * - B: simple, no pieces minimum; unit "Pallet B" of 64 pcs, minimum 2 pallets.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };

interface Item {
  id: string;
  productId: string;
  quantity: number;
  minimumWarning?: unknown;
}

describe('155 — admin quote-request minimum warnings [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const PALLET_B = `Pallet B ${RUN}`;
  let A: MinimumProductFixture;
  let B: MinimumProductFixture;
  let bPallet = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    A = await createMinimumProduct(em, {
      sku: `QWARN-A-${RUN}`,
      nameEn: `Anchor ${RUN}`,
      namePl: `Kotwa ${RUN}`,
      minOrderQuantity: 10,
      channelIds: channels,
    });
    B = await createMinimumProduct(em, {
      sku: `QWARN-B-${RUN}`,
      nameEn: `Brick ${RUN}`,
      namePl: `Cegla ${RUN}`,
      channelIds: channels,
    });
    bPallet = await createMinimumPackagingUnit(em, {
      productId: B.id,
      name: PALLET_B,
      baseQuantity: 64,
      minOrderUnits: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminGet = async (id: string) => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${id}`, cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { items: Item[]; version: number } }).data;
  };

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  };

  it('US4 #9 — create on behalf with A × 5 succeeds and the admin read warns on the line', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: A.id, quantity: 5, agreedUnitPrice: 9 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = (res.json() as { data: { id: string } }).data;
    const data = await adminGet(id);
    expect(data.items.map((i) => [i.productId, i.quantity, i.minimumWarning])).toEqual([
      [A.id, 5, { kind: 'pieces', minimum: 10 }],
    ]);
  });

  describe('a buyer request a representative modifies below the minimums', () => {
    let id = '';

    beforeAll(async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: CUSTOMER,
        payload: {
          items: [
            { productId: A.id, quantity: 10 },
            { productId: B.id, quantity: 128, packagingUnitId: bPallet },
          ],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const data = (created.json() as { data: { id: string; version: number } }).data;
      id = data.id;
      const rows = await linesOf(id);
      const aRow = rows.find((r) => r.productId === A.id)!;
      const bRow = rows.find((r) => r.productId === B.id)!;
      // US4 #9 — modify (negotiating quantities) with A × 5 and one pallet.
      const modify = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${data.version}"` },
        payload: {
          items: [
            { id: aRow.id, productId: A.id, quantity: 5, agreedUnitPrice: 9 },
            { id: bRow.id, productId: B.id, quantity: 64, agreedUnitPrice: 9 },
            { productId: A.id, quantity: 3, agreedUnitPrice: 9 },
          ],
        },
      });
      expect(modify.statusCode, modify.body).toBe(200);
    }, 60_000);

    it('US4 #9 — modify with A × 5 succeeds; the admin read flags pieces and pallet lines', async () => {
      const data = await adminGet(id);
      const byQuantity = new Map(data.items.map((i) => [`${i.productId}:${i.quantity}`, i]));
      // A's total is 5 + 3 = 8 < 10: both A lines are flagged.
      expect(byQuantity.get(`${A.id}:5`)?.minimumWarning).toEqual({ kind: 'pieces', minimum: 10 });
      expect(byQuantity.get(`${A.id}:3`)?.minimumWarning).toEqual({ kind: 'pieces', minimum: 10 });
      // B carries its stored unit: one pallet of a two-pallet minimum.
      expect(byQuantity.get(`${B.id}:64`)?.minimumWarning).toEqual({
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: PALLET_B,
      });
    });

    it('a line at its minimum carries minimumWarning: null', async () => {
      const current = await adminGet(id);
      const rows = await linesOf(id);
      const aRows = rows.filter((r) => r.productId === A.id);
      const bRow = rows.find((r) => r.productId === B.id)!;
      const modify = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${id}`,
        cookies: ADMIN,
        headers: { 'if-match': `"${current.version}"` },
        payload: {
          items: [
            { id: aRows[0]!.id, productId: A.id, quantity: 10, agreedUnitPrice: 9 },
            { id: bRow.id, productId: B.id, quantity: 64, agreedUnitPrice: 9 },
          ],
        },
      });
      expect(modify.statusCode, modify.body).toBe(200);
      const data = await adminGet(id);
      const a = data.items.find((i) => i.productId === A.id)!;
      expect(a).toHaveProperty('minimumWarning');
      expect(a.minimumWarning).toBeNull();
      expect(data.items.find((i) => i.productId === B.id)?.minimumWarning).toMatchObject({ kind: 'packaging_unit' });
    });

    it('S7 — the customer detail and list carry no minimumWarning anywhere', async () => {
      const detail = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER });
      expect(detail.statusCode, detail.body).toBe(200);
      const items = (detail.json() as { data: { items: Item[] } }).data.items;
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) expect(item).not.toHaveProperty('minimumWarning');
      expect(detail.body).not.toContain('minimumWarning');

      const list = await h.app.inject({ method: 'GET', url: '/api/v1/quote-requests', cookies: CUSTOMER });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.body).not.toContain('minimumWarning');
    });
  });
});
