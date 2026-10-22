import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 155, Phase 3 (T013) — the schema `catalog`'s `order_rules`
 * migration adds (`specs/155-catalog-order-constraints/data-model.md` §1).
 *
 * - `products.min_order_quantity` is null when not written and its check
 *   constraint refuses 0 and 1 000 001 (FR-001, F5);
 * - `products.returnable` is `false` on a row inserted without it (FR-004);
 * - `product_packaging_units.min_order_units` is null when not written and
 *   its check constraint refuses 0 and 1 000 001 (FR-002).
 *
 * Rows are inserted with raw SQL that names none of the new columns, so the
 * defaults asserted are the database's, not an entity initialiser's. Every
 * refusal runs under a savepoint so the test transaction survives it.
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

async function insertProduct(em: EntityManager): Promise<string> {
  const id = randomUUID();
  const stamp = `${Date.now()}-${id.slice(0, 8)}`;
  await em.execute(
    `insert into "products" ("id", "sku", "slug", "type", "name", "description", "created_at", "updated_at")
     values (?, ?, ?, 'simple', '{"en-US":"Order rules schema"}', '{}', now(), now())`,
    [id, `148-SCHEMA-${stamp}`, `148-schema-${stamp}`],
  );
  return id;
}

async function insertPackagingUnit(em: EntityManager, productId: string): Promise<string> {
  const id = randomUUID();
  await em.execute(
    `insert into "product_packaging_units" ("id", "product_id", "name", "base_quantity", "created_at", "updated_at")
     values (?, ?, ?, 12, now(), now())`,
    [id, productId, `148 box ${id.slice(0, 8)}`],
  );
  return id;
}

async function expectRefused(em: EntityManager, sql: string, params: unknown[], constraint: string) {
  await em.execute('savepoint order_rules_check');
  await expect(em.execute(sql, params)).rejects.toThrow(new RegExp(constraint));
  await em.execute('rollback to savepoint order_rules_check');
}

describe('155 — catalog order-rule columns [integration]', () => {
  it('products.min_order_quantity is null and products.returnable is false on a row inserted without them', async () => {
    const em = db.em();
    const id = await insertProduct(em);
    const rows = await em.execute<{ min_order_quantity: number | null; returnable: boolean }[]>(
      `select "min_order_quantity", "returnable" from "products" where "id" = ?`,
      [id],
    );
    expect(rows[0]).toEqual({ min_order_quantity: null, returnable: false });
  });

  it('products.min_order_quantity accepts 1 and 1 000 000 and refuses 0 and 1 000 001', async () => {
    const em = db.em();
    const id = await insertProduct(em);
    const update = `update "products" set "min_order_quantity" = ? where "id" = ?`;
    await em.execute(update, [1, id]);
    await em.execute(update, [1_000_000, id]);
    await expectRefused(em, update, [0, id], 'products_min_order_quantity_check');
    await expectRefused(em, update, [1_000_001, id], 'products_min_order_quantity_check');
    await em.execute(update, [null, id]);
  });

  it('product_packaging_units.min_order_units is null on a row inserted without it', async () => {
    const em = db.em();
    const unitId = await insertPackagingUnit(em, await insertProduct(em));
    const rows = await em.execute<{ min_order_units: number | null }[]>(
      `select "min_order_units" from "product_packaging_units" where "id" = ?`,
      [unitId],
    );
    expect(rows[0]).toEqual({ min_order_units: null });
  });

  it('product_packaging_units.min_order_units accepts 1 and 1 000 000 and refuses 0 and 1 000 001', async () => {
    const em = db.em();
    const unitId = await insertPackagingUnit(em, await insertProduct(em));
    const update = `update "product_packaging_units" set "min_order_units" = ? where "id" = ?`;
    await em.execute(update, [1, unitId]);
    await em.execute(update, [1_000_000, unitId]);
    await expectRefused(em, update, [0, unitId], 'product_packaging_units_min_order_units_check');
    await expectRefused(
      em,
      update,
      [1_000_001, unitId],
      'product_packaging_units_min_order_units_check',
    );
    await em.execute(update, [null, unitId]);
  });
});
