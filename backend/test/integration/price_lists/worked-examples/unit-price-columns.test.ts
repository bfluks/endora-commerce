import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../../helpers/test-db.js';

/**
 * Owner ruling of 2026-10-25 (`specs/pricing/worked-examples.md` §10.18) — a
 * unit price is carried at four places, unrounded, from the price book to the
 * invoice line. Every unit-price column on that path is `numeric(14,4)`:
 * carts, orders and quote_requests each widen their own in their own migration
 * (lossless), and the invoice line already was.
 */
const UNIT_PRICE_COLUMNS: ReadonlyArray<[string, string]> = [
  ['cart_items', 'unit_price'],
  ['cart_items', 'recomputed_unit_price'],
  ['cart_items', 'agreed_unit_price'],
  ['order_items', 'unit_price'],
  ['quote_request_items', 'desired_unit_price'],
  ['quote_request_items', 'agreed_unit_price'],
  ['quote_request_items', 'reference_unit_price'],
  ['invoice_lines', 'unit_net_price'],
];

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

describe('§10.18 — every unit-price column is numeric(14,4) [integration]', () => {
  for (const [table, column] of UNIT_PRICE_COLUMNS) {
    it(`${table}.${column}`, async () => {
      const rows = await db.em().execute<{ data_type: string; numeric_precision: number; numeric_scale: number }[]>(
        `select "data_type", "numeric_precision", "numeric_scale" from information_schema.columns
          where table_schema = current_schema() and table_name = ? and column_name = ?`,
        [table, column],
      );
      expect(rows).toEqual([{ data_type: 'numeric', numeric_precision: 14, numeric_scale: 4 }]);
    });
  }
});
