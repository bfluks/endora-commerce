import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CatalogProductReadPort } from '@endora-commerce/contracts';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/dist/backend/services/catalog-product-read.service.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 155, Phase 4 (T023) — `catalogProductReadPort` carries the order-rule
 * data (`specs/155-catalog-order-constraints/contracts/catalog-api.md` §5, R7):
 *
 * - `findById` / `findByIds` answer `minOrderQuantity` and `returnable`;
 * - `findPackagingUnitInProduct` answers `minOrderUnits`;
 * - `listPackagingUnitsByProductIds` answers the units of every given product,
 *   ordered by product id, then `position`, then `name`; an unknown id adds
 *   nothing and `[]` answers `[]`.
 *
 * Rows are inserted with raw SQL inside the test transaction, so the values
 * asserted are what the port maps from the columns, not an entity initialiser.
 */

let db: TestDb;

beforeAll(async () => {
  db = await setupTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.beginTx();
});
afterEach(async () => {
  await db.rollbackTx();
});

function portOver(em: EntityManager): CatalogProductReadPort {
  return new CatalogProductReadService(() => em);
}

async function insertProduct(
  em: EntityManager,
  values: { id?: string; minOrderQuantity?: number | null; returnable?: boolean } = {},
): Promise<string> {
  const id = values.id ?? randomUUID();
  const stamp = randomUUID().slice(0, 13);
  await em.execute(
    `insert into "products" ("id", "sku", "slug", "type", "name", "description", "min_order_quantity", "returnable", "created_at", "updated_at")
     values (?, ?, ?, 'simple', '{"en-US":"Read port order rules"}', '{}', ?, ?, now(), now())`,
    [
      id,
      `148-READ-${stamp}`,
      `148-read-${stamp}`,
      values.minOrderQuantity ?? null,
      values.returnable ?? false,
    ],
  );
  return id;
}

async function insertUnit(
  em: EntityManager,
  productId: string,
  values: { name: string; position: number; minOrderUnits?: number | null },
): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into "product_packaging_units" ("id", "product_id", "name", "base_quantity", "position", "min_order_units", "created_at", "updated_at")
     values (?, ?, ?, 12, ?, ?, now(), now())`,
    [id, productId, values.name, values.position, values.minOrderUnits ?? null],
  );
  return id;
}

/** Two ids whose text order is known, so "ordered by product id" is observable. */
function orderedIds(): [string, string] {
  const prefix = randomUUID().slice(0, 8);
  return [
    `${prefix}-0000-4000-8000-${randomUUID().slice(-12)}`,
    `${prefix}-ffff-4000-8000-${randomUUID().slice(-12)}`,
  ];
}

describe('155 — catalogProductReadPort order-rule data [integration]', () => {
  it('findById and findByIds carry minOrderQuantity and returnable', async () => {
    const em = db.em();
    const withRules = await insertProduct(em, { minOrderQuantity: 10, returnable: true });
    const withoutRules = await insertProduct(em);
    const port = portOver(em);

    const one = await port.findById(withRules);
    expect(one?.minOrderQuantity).toBe(10);
    expect(one?.returnable).toBe(true);

    const many = await port.findByIds([withRules, withoutRules]);
    const byId = new Map(many.map((record) => [record.id, record]));
    expect(byId.get(withRules)).toMatchObject({ minOrderQuantity: 10, returnable: true });
    expect(byId.get(withoutRules)).toMatchObject({ minOrderQuantity: null, returnable: false });
  });

  it('findPackagingUnitInProduct carries minOrderUnits', async () => {
    const em = db.em();
    const productId = await insertProduct(em);
    const withMinimum = await insertUnit(em, productId, { name: 'Pallet', position: 0, minOrderUnits: 3 });
    const withoutMinimum = await insertUnit(em, productId, { name: 'Box', position: 1 });
    const port = portOver(em);

    expect((await port.findPackagingUnitInProduct(productId, withMinimum))?.minOrderUnits).toBe(3);
    expect((await port.findPackagingUnitInProduct(productId, withoutMinimum))?.minOrderUnits).toBeNull();
  });

  it('listPackagingUnitsByProductIds answers both products ordered by product id, position, name — nothing for an unknown id', async () => {
    const em = db.em();
    const [a, b] = orderedIds();
    await insertProduct(em, { id: a });
    await insertProduct(em, { id: b });
    const suffix = randomUUID().slice(0, 8);
    // Inserted out of order on purpose: the answer's order must come from the query.
    const b1 = await insertUnit(em, b, { name: `B one ${suffix}`, position: 1, minOrderUnits: 2 });
    const a2 = await insertUnit(em, a, { name: `A zulu ${suffix}`, position: 0 });
    const b0 = await insertUnit(em, b, { name: `B zero ${suffix}`, position: 0 });
    const a1 = await insertUnit(em, a, { name: `A alpha ${suffix}`, position: 0, minOrderUnits: 5 });
    const a3 = await insertUnit(em, a, { name: `A last ${suffix}`, position: 2 });

    const units = await portOver(em).listPackagingUnitsByProductIds([b, a, randomUUID()]);

    expect(units.map((unit) => unit.id)).toEqual([a1, a2, a3, b0, b1]);
    expect(units.map((unit) => unit.productId)).toEqual([a, a, a, b, b]);
    expect(units.map((unit) => unit.minOrderUnits)).toEqual([5, null, null, null, 2]);
  });

  it('listPackagingUnitsByProductIds answers [] for []', async () => {
    expect(await portOver(db.em()).listPackagingUnitsByProductIds([])).toEqual([]);
  });
});
