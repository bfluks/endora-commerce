import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 159, Phase 2 (T011) — `orders`' `order_item_groups` migration
 * (`specs/159-quote-request-item-groups/data-model.md` §2.3).
 *
 * Rows are inserted with raw SQL naming none of the new line columns, so a
 * `position` of `0` and a `group_id` of `null` are the database's defaults —
 * what every order line placed before this feature reads, with no backfill.
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

async function insertOrder(): Promise<string> {
  const orderId = randomUUID();
  await db.em().execute(
    `insert into "orders" (
       "id", "organization_id", "placed_by_customer_account_id", "sales_channel_id",
       "delivery_address", "billing_address", "delivery_method_id", "delivery_method_snapshot",
       "payment_method_id", "payment_method_snapshot", "subtotal", "tax_total", "delivery_total",
       "total", "currency", "placed_at", "created_at", "updated_at", "business_id")
     values (?, ?, ?, ?, '{}', '{}', ?, '{}', ?, '{}', 10, 0, 0, 10, 'PLN', now(), now(), now(), ?)`,
    [orderId, randomUUID(), randomUUID(), db.systemDefaultChannelId, randomUUID(), randomUUID(), `159-SCHEMA-${orderId}`],
  );
  return orderId;
}

async function insertLine(orderId: string, groupId?: string): Promise<string> {
  const id = randomUUID();
  if (groupId === undefined) {
    await db.em().execute(
      `insert into "order_items" ("id", "order_id", "product_id", "product_snapshot", "quantity", "unit_price", "tax_rate", "line_total", "created_at")
       values (?, ?, ?, '{}', 1, 10, 0, 10, now())`,
      [id, orderId, randomUUID()],
    );
  } else {
    await db.em().execute(
      `insert into "order_items" ("id", "order_id", "product_id", "product_snapshot", "quantity", "unit_price", "tax_rate", "line_total", "group_id", "position", "created_at")
       values (?, ?, ?, '{}', 1, 10, 0, 10, ?, 1, now())`,
      [id, orderId, randomUUID(), groupId],
    );
  }
  return id;
}

async function insertGroup(orderId: string, name = 'Hall A', position = 0): Promise<string> {
  const id = randomUUID();
  await db.em().execute(
    `insert into "order_item_groups" ("id", "order_id", "name", "position", "created_at") values (?, ?, ?, ?, now())`,
    [id, orderId, name, position],
  );
  return id;
}

describe('159 — order_item_groups [integration]', () => {
  it('creates the table with the declared columns (no updated_at: a group never changes)', async () => {
    const cols = await db.em().execute<
      { column_name: string; data_type: string; is_nullable: string; character_maximum_length: number | null }[]
    >(
      `select "column_name", "data_type", "is_nullable", "character_maximum_length" from information_schema.columns
        where table_schema = current_schema() and table_name = 'order_item_groups'
        order by "column_name"`,
    );
    expect(cols).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'name', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 120 },
      { column_name: 'order_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'position', data_type: 'integer', is_nullable: 'NO', character_maximum_length: null },
    ]);
  });

  it('adds group_id (nullable uuid) and position (integer, default 0) to order_items', async () => {
    const cols = await db.em().execute<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `select "column_name", "data_type", "is_nullable", "column_default" from information_schema.columns
        where table_schema = current_schema() and table_name = 'order_items'
          and column_name in ('group_id', 'position')
        order by "column_name"`,
    );
    expect(cols).toEqual([
      { column_name: 'group_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'position', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
    ]);
  });

  it('reads a line placed without the new columns as ungrouped at position 0', async () => {
    const orderId = await insertOrder();
    const lineId = await insertLine(orderId);
    const rows = await db.em().execute<{ group_id: string | null; position: number }[]>(
      `select "group_id", "position" from "order_items" where "id" = ?`,
      [lineId],
    );
    expect(rows).toEqual([{ group_id: null, position: 0 }]);
  });

  it('deleting a group ungroups its lines and deletes none', async () => {
    const orderId = await insertOrder();
    const groupId = await insertGroup(orderId);
    const lineId = await insertLine(orderId, groupId);
    await db.em().execute(`delete from "order_item_groups" where "id" = ?`, [groupId]);
    const rows = await db.em().execute<{ group_id: string | null; position: number }[]>(
      `select "group_id", "position" from "order_items" where "id" = ?`,
      [lineId],
    );
    expect(rows).toEqual([{ group_id: null, position: 1 }]);
  });

  it('deleting an order deletes its groups', async () => {
    const orderId = await insertOrder();
    await insertGroup(orderId, 'A', 0);
    await db.em().execute(`delete from "orders" where "id" = ?`, [orderId]);
    const rows = await db.em().execute<{ count: string }[]>(
      `select count(*)::text as "count" from "order_item_groups" where "order_id" = ?`,
      [orderId],
    );
    expect(rows).toEqual([{ count: '0' }]);
  });

  it('refuses a blank name, a negative position, and a line naming no group', async () => {
    const orderId = await insertOrder();
    await expect(insertGroup(orderId, ' ', 0)).rejects.toThrow(/order_item_groups_name_check/);
    await db.rollbackTx();
    await db.beginTx();
    const orderId2 = await insertOrder();
    await expect(insertGroup(orderId2, 'A', -1)).rejects.toThrow(/order_item_groups_position_check/);
    await db.rollbackTx();
    await db.beginTx();
    const orderId3 = await insertOrder();
    await expect(insertLine(orderId3, randomUUID())).rejects.toThrow(/order_items_group_fk/);
  });

  it('classifies the group entity as transitively scoped to its order', () => {
    const rows = tenantClassifications().filter((meta) => meta.className === 'OrderItemGroup');
    expect(rows).toEqual([expect.objectContaining({ scope: 'transitive', parentClassName: 'Order', fk: 'orderId' })]);
  });
});
