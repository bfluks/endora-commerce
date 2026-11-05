import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type QuoteRequestReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { ProductPackagingUnit, QuoteRequest, QuoteRequestItem } from '../../helpers/package-entities.js';
import {
  buyerChannelIds,
  createMinimumPackagingUnit,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 155, Phase 10 (T077) — a buyer's quote line names its packaging unit
 * and is resolved against the catalogue before anything is written (FR-026,
 * FR-027, FR-029; US4 #10, #11; threats S2, S5, F6; analyze F14;
 * `contracts/quote-requests-api.md` §1, §4, §5).
 *
 * - B: simple, no minimum; unit "Pallet B" (64), unit "Sack B" (25, deleted by #11).
 * - C: simple, no minimum; unit "Pallet C" (50) — another product's unit.
 * - E: simple, no pieces minimum; unit "Pallet E" (64) with a minimum of 2 units.
 * - H: hidden (published on no channel).
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface QuoteBody {
  data: {
    id: string;
    version: number;
    items: Array<{
      id: string;
      productId: string;
      productName: string;
      quantity: number;
      packagingUnitId?: string | null;
      packagingUnitName?: string | null;
      packagingUnitBaseQuantity?: number | null;
    }>;
  };
}

describe('155 — quote-request packaging resolution [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const admin = { b2b_session: 'stub-admin-session' };
  const RUN = minimumFixtureRun();
  const PALLET_B = `Pallet B ${RUN}`;
  const PALLET_E = `Pallet E ${RUN}`;
  let B: MinimumProductFixture;
  let C: MinimumProductFixture;
  let E: MinimumProductFixture;
  let H: MinimumProductFixture;
  let bPallet = '';
  let cPallet = '';
  let ePallet = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channels = await buyerChannelIds(em);
    B = await createMinimumProduct(em, { sku: `QPU-B-${RUN}`, nameEn: `Brick ${RUN}`, namePl: `Cegla ${RUN}`, channelIds: channels });
    C = await createMinimumProduct(em, { sku: `QPU-C-${RUN}`, nameEn: `Cement ${RUN}`, namePl: `Cement PL ${RUN}`, channelIds: channels });
    E = await createMinimumProduct(em, { sku: `QPU-E-${RUN}`, nameEn: `Eaves ${RUN}`, namePl: `Okap ${RUN}`, channelIds: channels });
    H = await createMinimumProduct(em, { sku: `QPU-H-${RUN}`, nameEn: `Hinge ${RUN}`, namePl: `Zawias ${RUN}`, channelIds: [] });
    bPallet = await createMinimumPackagingUnit(em, { productId: B.id, name: PALLET_B, baseQuantity: 64 });
    cPallet = await createMinimumPackagingUnit(em, { productId: C.id, name: `Pallet C ${RUN}`, baseQuantity: 50 });
    ePallet = await createMinimumPackagingUnit(em, { productId: E.id, name: PALLET_E, baseQuantity: 64, minOrderUnits: 2 });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const create = (items: Array<Record<string, unknown>>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies: customer, payload: { items } });

  const createOk = async (items: Array<Record<string, unknown>>) => {
    const res = await create(items);
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as QuoteBody).data;
  };

  const countRequests = async () => {
    const em = h.em();
    em.clear();
    return em.count(QuoteRequest, { customerAccountId: TEST_CUSTOMER_ID });
  };

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  };

  const errorOf = (res: { body: string; json: () => unknown }) => (res.json() as ErrorBody).error;

  describe('US4 #10 — resolution (FR-026)', () => {
    it('an id stores the catalogue name and base quantity, whatever else was sent', async () => {
      const created = await createOk([
        { productId: B.id, quantity: 128, packagingUnitId: bPallet, packagingUnitName: 'Bogus', packagingUnitBaseQuantity: 7 },
      ]);
      const [row] = await linesOf(created.id);
      expect(row).toMatchObject({
        packagingUnitId: bPallet,
        packagingUnitName: PALLET_B,
        packagingUnitBaseQuantity: 64,
        quantity: 128,
        productName: `${B.nameEn} (${PALLET_B})`,
      });
    });

    it('name + base quantity 64 and no id is accepted and resolved to the unit', async () => {
      const created = await createOk([
        { productId: B.id, quantity: 64, packagingUnitName: PALLET_B, packagingUnitBaseQuantity: 64 },
      ]);
      const [row] = await linesOf(created.id);
      expect(row).toMatchObject({ packagingUnitId: bPallet, packagingUnitName: PALLET_B, packagingUnitBaseQuantity: 64 });
    });

    it('base quantity 50 → 422 PACKAGING_UNIT_MISMATCH naming the line and product; nothing written [S5]', async () => {
      const before = await countRequests();
      const res = await create([
        { productId: C.id, quantity: 1 },
        { productId: B.id, quantity: 64, packagingUnitName: PALLET_B, packagingUnitBaseQuantity: 50 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PACKAGING_UNIT_MISMATCH);
      expect(error.details).toEqual({
        lineNumber: 2,
        productName: B.nameEn,
        lines: [{ index: 1, productId: B.id, productName: B.nameEn, reason: 'base_quantity_mismatch' }],
      });
      expect(error.message).toContain(B.nameEn);
      expect(error.message).toContain('2');
      expect(await countRequests()).toBe(before);
    });

    it('a unit name the product does not have → 422 name_unknown; nothing written', async () => {
      const before = await countRequests();
      const res = await create([
        { productId: B.id, quantity: 64, packagingUnitName: `Crate ${RUN}`, packagingUnitBaseQuantity: 64 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.PACKAGING_UNIT_MISMATCH);
      expect(errorOf(res).details).toMatchObject({ lines: [{ index: 0, reason: 'name_unknown' }] });
      expect(await countRequests()).toBe(before);
    });

    it('another product’s unit id and a random id give the identical answer [F6]', async () => {
      const foreign = await create([{ productId: B.id, quantity: 50, packagingUnitId: cPallet }]);
      const random = await create([{ productId: B.id, quantity: 50, packagingUnitId: randomUUID() }]);
      expect(foreign.statusCode, foreign.body).toBe(422);
      expect(random.statusCode, random.body).toBe(422);
      const a = errorOf(foreign);
      const b = errorOf(random);
      expect(a.code).toBe(ERROR_CODES.PACKAGING_UNIT_MISMATCH);
      expect([a.code, a.message, a.details]).toEqual([b.code, b.message, b.details]);
      expect(a.details).toMatchObject({ lines: [{ index: 0, productId: B.id, reason: 'unknown_unit' }] });
    });

    it('a hidden product’s line → 404 first, naming nothing, even beside a bad unit [S2]', async () => {
      const before = await countRequests();
      const res = await create([
        { productId: H.id, quantity: 1 },
        { productId: B.id, quantity: 50, packagingUnitId: randomUUID() },
      ]);
      expect(res.statusCode, res.body).toBe(404);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
      expect(JSON.stringify(error)).not.toContain(H.nameEn);
      expect(await countRequests()).toBe(before);
    });
  });

  describe('US4 #11 — cart → quote with a deleted unit (FR-026)', () => {
    it('carries the line as plain pieces, its quantity unchanged', async () => {
      const em = h.em();
      await em
        .getConnection()
        .execute(`update "carts" set "status" = 'completed' where "customer_account_id" = ? and "status" = 'active'`, [
          TEST_CUSTOMER_ID,
        ]);
      const sack = await createMinimumPackagingUnit(em, { productId: B.id, name: `Sack B ${RUN}`, baseQuantity: 25 });
      const add = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/items',
        cookies: customer,
        payload: { productId: B.id, quantity: 2, packagingUnitId: sack },
      });
      expect(add.statusCode, add.body).toBe(200);
      await em.nativeDelete(ProductPackagingUnit, { id: sack });

      const convert = await h.app.inject({
        method: 'POST',
        url: '/api/v1/cart/convert-to-quote-request',
        cookies: customer,
        payload: {},
      });
      expect(convert.statusCode, convert.body).toBe(200);
      const data = (convert.json() as { data: { quoteRequestId?: string; id?: string } }).data;
      const id = data.quoteRequestId ?? data.id!;
      const lines = (await linesOf(id)).filter((l) => l.productId === B.id);
      expect(lines).toHaveLength(1);
      const [line] = lines;
      expect({
        quantity: line!.quantity,
        packagingUnitId: line!.packagingUnitId ?? null,
        packagingUnitName: line!.packagingUnitName ?? null,
        packagingUnitBaseQuantity: line!.packagingUnitBaseQuantity ?? null,
        productName: line!.productName,
      }).toEqual({
        quantity: 50,
        packagingUnitId: null,
        packagingUnitName: null,
        packagingUnitBaseQuantity: null,
        productName: B.nameEn,
      });
    });
  });

  describe('FR-027 — a pallet minimum counted over the request’s lines in that unit', () => {
    it('one pallet of E is refused; two lines of one pallet each are accepted', async () => {
      const before = await countRequests();
      const one = await create([{ productId: E.id, quantity: 64, packagingUnitId: ePallet }]);
      expect(one.statusCode, one.body).toBe(422);
      expect(errorOf(one).code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);
      expect(errorOf(one).details).toMatchObject({
        productName: E.nameEn,
        minimum: 2,
        packagingUnitName: PALLET_E,
        lines: [{ index: 0, productName: E.nameEn, kind: 'packaging_unit', minimum: 2, packagingUnitName: PALLET_E }],
      });
      expect(await countRequests()).toBe(before);

      await createOk([
        { productId: E.id, quantity: 64, packagingUnitId: ePallet },
        { productId: E.id, quantity: 64, packagingUnitName: PALLET_E, packagingUnitBaseQuantity: 64 },
      ]);
    });

    it('a plain-pieces line does not count toward the pallet minimum', async () => {
      const res = await create([
        { productId: E.id, quantity: 64, packagingUnitId: ePallet },
        { productId: E.id, quantity: 64 },
      ]);
      expect(res.statusCode, res.body).toBe(422);
      expect(errorOf(res).code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);
      expect(errorOf(res).details).toMatchObject({ lines: [{ index: 0 }] });
    });
  });

  describe('FR-031 (b) — a draft edit exempts an unchanged packaging line by its unit id', () => {
    it('a line left unchanged is not refused after its unit was renamed and given a minimum', async () => {
      const em = h.em();
      const channels = await buyerChannelIds(em);
      const F = await createMinimumProduct(em, { sku: `QPU-F-${RUN}`, nameEn: `Flange ${RUN}`, namePl: `Kołnierz ${RUN}`, channelIds: channels });
      const fPallet = await createMinimumPackagingUnit(em, { productId: F.id, name: `Pallet F ${RUN}`, baseQuantity: 64 });
      const created = await createOk([{ productId: F.id, quantity: 64, packagingUnitId: fPallet }]);

      // The catalogue moves under the draft: the unit gets a minimum of 2 and a new name.
      await em.nativeUpdate(ProductPackagingUnit, { id: fPallet }, { minOrderUnits: 2, name: `Pallet F renamed ${RUN}` });

      const patch = (items: Array<Record<string, unknown>>) =>
        h.app.inject({
          method: 'PATCH',
          url: `/api/v1/quote-requests/${created.id}`,
          cookies: customer,
          payload: { items },
        });

      // The line changed (65 pieces) is judged: 65/64 of a pallet is below 2.
      const changed = await patch([{ productId: F.id, quantity: 65, packagingUnitId: fPallet }]);
      expect(changed.statusCode, changed.body).toBe(422);
      expect(errorOf(changed).code).toBe(ERROR_CODES.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY);

      // The same line resent unchanged, beside a new one, is exempt (FR-031 (b)).
      const unchanged = await patch([
        { productId: F.id, quantity: 64, packagingUnitId: fPallet },
        { productId: B.id, quantity: 3 },
      ]);
      expect(unchanged.statusCode, unchanged.body).toBe(200);
      const lines = await linesOf(created.id);
      expect(lines.find((l) => l.productId === F.id)).toMatchObject({
        packagingUnitId: fPallet,
        packagingUnitName: `Pallet F renamed ${RUN}`,
        quantity: 64,
      });
    });
  });

  describe('analyze F14 — packagingUnitId is stored, carried and exposed', () => {
    it('admin modify carries the stored packagingUnitId of a paired line', async () => {
      const created = await createOk([{ productId: B.id, quantity: 128, packagingUnitId: bPallet }]);
      const [row] = await linesOf(created.id);
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${created.id}`,
        cookies: admin,
        headers: { 'if-match': `"${created.version}"` },
        payload: { items: [{ id: row!.id, productId: B.id, quantity: 192, agreedUnitPrice: 5 }] },
      });
      expect(res.statusCode, res.body).toBe(200);
      const [after] = await linesOf(created.id);
      expect(after).toMatchObject({
        packagingUnitId: bPallet,
        packagingUnitName: PALLET_B,
        packagingUnitBaseQuantity: 64,
        quantity: 192,
      });
      const adminItems = (res.json() as QuoteBody).data.items;
      expect(adminItems[0]?.packagingUnitId).toBe(bPallet);
    });

    it('the customer GET and the read port’s listItems expose packagingUnitId', async () => {
      const created = await createOk([
        { productId: B.id, quantity: 64, packagingUnitId: bPallet },
        { productId: C.id, quantity: 3 },
      ]);
      const res = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${created.id}`, cookies: customer });
      expect(res.statusCode, res.body).toBe(200);
      const items = (res.json() as QuoteBody).data.items;
      expect(items.find((i) => i.productId === B.id)?.packagingUnitId).toBe(bPallet);
      expect(items.find((i) => i.productId === C.id)?.packagingUnitId).toBeNull();

      const port = h.container.resolve('quoteRequestReadPort') as QuoteRequestReadPort;
      const lines = await port.listItems(created.id);
      expect(lines.find((l) => l.productId === B.id)?.packagingUnitId).toBe(bPallet);
      expect(lines.find((l) => l.productId === C.id)?.packagingUnitId).toBeNull();
    });
  });
});
