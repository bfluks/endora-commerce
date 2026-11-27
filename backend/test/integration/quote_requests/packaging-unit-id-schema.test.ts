import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 155, Phase 3 (T014) — `quote_requests`' `item_packaging_unit_id`
 * migration (`specs/155-catalog-order-constraints/data-model.md` §4).
 *
 * `quote_request_items.packaging_unit_id` exists as a nullable uuid with no
 * default and **no foreign key** (packaging units are hard-deleted and the
 * line's snapshot survives them, FR-026), and a line inserted without it
 * reads `null`. The rows are inserted with raw SQL naming none of the new
 * columns, so the `null` is the database's, not an entity initialiser's.
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

describe('155 — quote_request_items.packaging_unit_id [integration]', () => {
  it('exists as a nullable uuid with no default', async () => {
    const rows = await db.em().execute<
      { data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `select "data_type", "is_nullable", "column_default" from information_schema.columns
        where table_schema = current_schema() and table_name = 'quote_request_items'
          and column_name = 'packaging_unit_id'`,
    );
    expect(rows).toEqual([{ data_type: 'uuid', is_nullable: 'YES', column_default: null }]);
  });

  it('carries no foreign key', async () => {
    const rows = await db.em().execute<{ n: string }[]>(
      `select count(*)::text as n
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
        where c.contype = 'f' and c.conrelid = '"quote_request_items"'::regclass
          and a.attname = 'packaging_unit_id'`,
    );
    expect(rows[0]!.n).toBe('0');
  });

  it('is null on a line inserted without it', async () => {
    const em = db.em();
    const quoteRequestId = randomUUID();
    const itemId = randomUUID();
    await em.execute(
      `insert into "quote_requests" ("id", "organization_id", "customer_account_id", "status", "created_at", "updated_at", "business_id")
       values (?, ?, ?, 'Pending', now(), now(), ?)`,
      [quoteRequestId, randomUUID(), randomUUID(), `148-SCHEMA-${quoteRequestId}`],
    );
    await em.execute(
      `insert into "quote_request_items" ("id", "quote_request_id", "product_id", "product_name", "quantity", "line_currency", "created_at", "updated_at")
       values (?, ?, ?, '148 schema product', 2, 'PLN', now(), now())`,
      [itemId, quoteRequestId, randomUUID()],
    );
    const rows = await em.execute<{ packaging_unit_id: string | null }[]>(
      `select "packaging_unit_id" from "quote_request_items" where "id" = ?`,
      [itemId],
    );
    expect(rows).toEqual([{ packaging_unit_id: null }]);
  });
});
