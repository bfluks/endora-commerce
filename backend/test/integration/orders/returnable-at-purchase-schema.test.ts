import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 155, Phase 3 (T014) — `orders`' `order_item_returnable_at_purchase`
 * migration (`specs/155-catalog-order-constraints/data-model.md` §3).
 *
 * `order_items.returnable_at_purchase` exists as a nullable boolean with no
 * default, and a line inserted without it reads `null` — the value every line
 * placed before this feature carries (FR-016a, FR-017). The rows are inserted
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

describe('155 — order_items.returnable_at_purchase [integration]', () => {
  it('exists as a nullable boolean with no default', async () => {
    const rows = await db.em().execute<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `select "data_type", "is_nullable", "column_default" from information_schema.columns
        where table_schema = current_schema() and table_name = 'order_items'
          and column_name = 'returnable_at_purchase'`,
    );
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'YES', column_default: null }]);
  });

  it('is null on a line inserted without it', async () => {
    const em = db.em();
    const orderId = randomUUID();
    const itemId = randomUUID();
    await em.execute(
      `insert into "orders" (
         "id", "organization_id", "placed_by_customer_account_id", "sales_channel_id",
         "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
         "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "delivery_total",
         "total", "currency", "placed_at", "created_at", "updated_at", "business_id")
       values (?, ?, ?, ?, '{}', '{}', ?, '{}', ?, '{}', 10, 0, 0, 10, 'PLN', now(), now(), now(), ?)`,
      [
        orderId,
        randomUUID(),
        randomUUID(),
        db.systemDefaultChannelId,
        randomUUID(),
        randomUUID(),
        `148-SCHEMA-${orderId}`,
      ],
    );
    await em.execute(
      `insert into "order_items" ("id", "order_id", "product_id", "product_snapshot", "quantity", "unit_price", "tax_rate", "line_total", "created_at")
       values (?, ?, ?, '{}', 1, 10, 0, 10, now())`,
      [itemId, orderId, randomUUID()],
    );
    const rows = await em.execute<{ returnable_at_purchase: boolean | null }[]>(
      `select "returnable_at_purchase" from "order_items" where "id" = ?`,
      [itemId],
    );
    expect(rows).toEqual([{ returnable_at_purchase: null }]);
  });
});
