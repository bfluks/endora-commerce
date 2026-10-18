import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 154, Phase 3 (T014) — `carts`' `cart_item_quote_seeded_quantity`
 * migration (`specs/154-catalog-order-constraints/data-model.md` §2).
 *
 * `cart_items.quote_seeded_quantity` exists as a nullable integer with no
 * default, and a line inserted without it reads `null` — every line that was
 * not seeded from an accepted quote request (FR-028). The rows are inserted
 * with raw SQL naming none of the new columns, so the `null` is the
 * database's, not an entity initialiser's.
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

describe('154 — cart_items.quote_seeded_quantity [integration]', () => {
  it('exists as a nullable integer with no default', async () => {
    const rows = await db.em().execute<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `select "data_type", "is_nullable", "column_default" from information_schema.columns
        where table_schema = current_schema() and table_name = 'cart_items'
          and column_name = 'quote_seeded_quantity'`,
    );
    expect(rows).toEqual([{ data_type: 'integer', is_nullable: 'YES', column_default: null }]);
  });

  it('is null on a line inserted without it', async () => {
    const em = db.em();
    const cartId = randomUUID();
    const itemId = randomUUID();
    await em.execute(
      `insert into "carts" ("id", "anonymous_cart_token", "created_at", "updated_at")
       values (?, ?, now(), now())`,
      [cartId, `148-schema-${cartId}`],
    );
    await em.execute(
      `insert into "cart_items" ("id", "cart_id", "product_id", "quantity", "unit_price", "currency", "created_at", "updated_at")
       values (?, ?, ?, 3, 10, 'PLN', now(), now())`,
      [itemId, cartId, randomUUID()],
    );
    const rows = await em.execute<{ quote_seeded_quantity: number | null }[]>(
      `select "quote_seeded_quantity" from "cart_items" where "id" = ?`,
      [itemId],
    );
    expect(rows).toEqual([{ quote_seeded_quantity: null }]);
  });
});
