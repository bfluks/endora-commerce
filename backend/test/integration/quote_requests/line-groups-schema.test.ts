import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 159, Phase 2 (T009) — `quote_requests`' `quote_request_item_groups`
 * migration (`specs/159-quote-request-item-groups/data-model.md` §1.3).
 *
 * The rows are inserted with raw SQL naming none of the new line columns, so a
 * `position` of `0` and a `group_id` of `null` are the database's defaults —
 * the values every line stored before this feature reads (research R-6).
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

async function insertQuote(): Promise<string> {
  const id = randomUUID();
  await db.em().execute(
    `insert into "quote_requests" ("id", "organization_id", "customer_account_id", "business_id", "status", "created_at", "updated_at")
     values (?, ?, ?, ?, 'Pending', now(), now())`,
    [id, randomUUID(), randomUUID(), `159-SCHEMA-${id}`],
  );
  return id;
}

async function insertLine(quoteRequestId: string, groupId?: string): Promise<string> {
  const id = randomUUID();
  if (groupId === undefined) {
    await db.em().execute(
      `insert into "quote_request_items" ("id", "quote_request_id", "product_id", "product_name", "quantity", "line_currency", "created_at", "updated_at")
       values (?, ?, ?, 'Bolt', 1, 'PLN', now(), now())`,
      [id, quoteRequestId, randomUUID()],
    );
  } else {
    await db.em().execute(
      `insert into "quote_request_items" ("id", "quote_request_id", "product_id", "product_name", "quantity", "line_currency", "group_id", "position", "created_at", "updated_at")
       values (?, ?, ?, 'Bolt', 1, 'PLN', ?, 1, now(), now())`,
      [id, quoteRequestId, randomUUID(), groupId],
    );
  }
  return id;
}

async function insertGroup(quoteRequestId: string, name = 'Ground floor', position = 0): Promise<string> {
  const id = randomUUID();
  await db.em().execute(
    `insert into "quote_request_item_groups" ("id", "quote_request_id", "name", "position", "created_at", "updated_at")
     values (?, ?, ?, ?, now(), now())`,
    [id, quoteRequestId, name, position],
  );
  return id;
}

describe('159 — quote_request_item_groups [integration]', () => {
  it('creates the table with the declared columns', async () => {
    const cols = await db.em().execute<
      { column_name: string; data_type: string; is_nullable: string; character_maximum_length: number | null }[]
    >(
      `select "column_name", "data_type", "is_nullable", "character_maximum_length" from information_schema.columns
        where table_schema = current_schema() and table_name = 'quote_request_item_groups'
        order by "column_name"`,
    );
    expect(cols).toEqual([
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'name', data_type: 'character varying', is_nullable: 'NO', character_maximum_length: 120 },
      { column_name: 'position', data_type: 'integer', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'quote_request_id', data_type: 'uuid', is_nullable: 'NO', character_maximum_length: null },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', character_maximum_length: null },
    ]);
  });

  it('adds group_id (nullable uuid) and position (integer, default 0) to quote_request_items', async () => {
    const cols = await db.em().execute<
      { column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]
    >(
      `select "column_name", "data_type", "is_nullable", "column_default" from information_schema.columns
        where table_schema = current_schema() and table_name = 'quote_request_items'
          and column_name in ('group_id', 'position')
        order by "column_name"`,
    );
    expect(cols).toEqual([
      { column_name: 'group_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'position', data_type: 'integer', is_nullable: 'NO', column_default: '0' },
    ]);
  });

  it('reads a line written without the new columns as ungrouped at position 0', async () => {
    const quoteId = await insertQuote();
    const lineId = await insertLine(quoteId);
    const rows = await db.em().execute<{ group_id: string | null; position: number }[]>(
      `select "group_id", "position" from "quote_request_items" where "id" = ?`,
      [lineId],
    );
    expect(rows).toEqual([{ group_id: null, position: 0 }]);
  });

  it('deleting a group ungroups its lines and deletes none (D2)', async () => {
    const quoteId = await insertQuote();
    const groupId = await insertGroup(quoteId);
    const lineId = await insertLine(quoteId, groupId);
    await db.em().execute(`delete from "quote_request_item_groups" where "id" = ?`, [groupId]);
    const rows = await db.em().execute<{ group_id: string | null; position: number }[]>(
      `select "group_id", "position" from "quote_request_items" where "id" = ?`,
      [lineId],
    );
    expect(rows).toEqual([{ group_id: null, position: 1 }]);
  });

  it('deleting a quote request deletes its groups', async () => {
    const quoteId = await insertQuote();
    await insertGroup(quoteId, 'A', 0);
    await insertGroup(quoteId, 'B', 1);
    await db.em().execute(`delete from "quote_requests" where "id" = ?`, [quoteId]);
    const rows = await db.em().execute<{ count: string }[]>(
      `select count(*)::text as "count" from "quote_request_item_groups" where "quote_request_id" = ?`,
      [quoteId],
    );
    expect(rows).toEqual([{ count: '0' }]);
  });

  it('refuses a blank name, a negative position and a line with a negative position', async () => {
    const quoteId = await insertQuote();
    await expect(insertGroup(quoteId, '   ', 0)).rejects.toThrow(/quote_request_item_groups_name_check/);
    await db.rollbackTx();
    await db.beginTx();
    const quoteId2 = await insertQuote();
    await expect(insertGroup(quoteId2, 'A', -1)).rejects.toThrow(/quote_request_item_groups_position_check/);
    await db.rollbackTx();
    await db.beginTx();
    const quoteId3 = await insertQuote();
    const lineId = await insertLine(quoteId3);
    await expect(
      db.em().execute(`update "quote_request_items" set "position" = -1 where "id" = ?`, [lineId]),
    ).rejects.toThrow(/quote_request_items_position_check/);
  });

  it('refuses a line naming a group that does not exist', async () => {
    const quoteId = await insertQuote();
    await expect(insertLine(quoteId, randomUUID())).rejects.toThrow(/quote_request_items_group_fk/);
  });

  it('classifies the group entity as transitively scoped to its quote request', () => {
    const rows = tenantClassifications().filter((meta) => meta.className === 'QuoteRequestItemGroup');
    expect(rows).toEqual([
      expect.objectContaining({ scope: 'transitive', parentClassName: 'QuoteRequest', fk: 'quoteRequestId' }),
    ]);
  });
});
