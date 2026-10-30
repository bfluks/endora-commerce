import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261025T222634CatalogProductStatusDropDraft } from '@endora-commerce/mod-catalog/migrations';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * Feature 163, Phase 9a (T156b) — the status value set loses `draft`
 * (`specs/163-product-data-scopes/data-model.md` §13, research R30.1–R30.2; SC-009).
 *
 * The migration has already run against the template, so each test first runs the
 * class's own `down` (the three-value scope `CHECK`s, no `products_status_check`, the
 * `draft` default) inside its transaction, seeds the rows `up` meets on a database
 * deployed before this change, and runs `up`. Everything happens in **one transaction
 * the test rolls back** — PostgreSQL DDL is transactional, and `up`'s backfill is
 * table-wide, so a committed run would archive every `inactive` fixture earlier files
 * on this worker created (`specs/conventions/backend-test-suite.md`).
 *
 * The statements come off the shipped migration class rather than being copied here.
 */
describe('catalog product_status_drop_draft migration (T156b)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  function migration(): Migration20261025T222634CatalogProductStatusDropDraft {
    return new Migration20261025T222634CatalogProductStatusDropDraft(em.getDriver(), em.config);
  }

  async function runDown(): Promise<void> {
    const m = migration();
    await m.down();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
  }

  async function runUp(): Promise<void> {
    const m = migration();
    await m.up();
    for (const query of m.getQueries()) await em.execute(query as unknown as string);
    em.clear();
  }

  const UPDATED_AT = '2026-03-04T05:06:07.000Z';
  const ARCHIVED_AT = '2026-01-02T03:04:05.000Z';

  async function insertProduct(status: string, archivedAt: string | null): Promise<string> {
    const id = randomUUID();
    const stamp = `${id.slice(0, 8)}`;
    await em.execute(
      `insert into "products" ("id", "sku", "slug", "type", "status", "archived_at", "name", "description", "created_at", "updated_at")
       values (?, ?, ?, 'simple', ?, ?, '{"en-US":"Drop draft"}', '{}', now(), ?)`,
      [id, `T156B-${stamp}`, `t156b-${stamp}`, status, archivedAt, UPDATED_AT],
    );
    return id;
  }

  async function insertChannel(): Promise<string> {
    const id = randomUUID();
    await em.execute(
      `insert into "sales_channels" ("id", "code", "name", "default_language", "languages", "default_currency", "created_at", "updated_at")
       values (?, ?, '{"en-US":"T156b"}'::jsonb, 'pl-PL', '["pl-PL","de-DE"]'::jsonb, 'PLN', now(), now())`,
      [id, `t156b-${id.slice(0, 8)}`],
    );
    return id;
  }

  async function product(id: string): Promise<{ status: string; archived_at: Date | null }> {
    const rows = (await em.execute(`select "status", "archived_at" from "products" where "id" = ?`, [id])) as Array<{
      status: string;
      archived_at: Date | string | null;
    }>;
    const row = rows[0]!;
    // The raw driver read may hand `timestamptz` back as a string; normalise it.
    return { status: row.status, archived_at: row.archived_at === null ? null : new Date(row.archived_at) };
  }

  async function expectRefused(sql: string, params: unknown[], constraint: string): Promise<void> {
    await em.execute('savepoint t156b_check');
    await expect(em.execute(sql, params)).rejects.toThrow(new RegExp(constraint));
    await em.execute('rollback to savepoint t156b_check');
  }

  it('converts draft to inactive without archiving it and archives today\'s inactive rows (Q1-b, Q1-c, O-4)', async () => {
    await runDown();
    const active = await insertProduct('active', null);
    const draft = await insertProduct('draft', null);
    const archivedInactive = await insertProduct('inactive', ARCHIVED_AT);
    const bareInactive = await insertProduct('inactive', null);
    const channel = await insertChannel();
    await em.execute(
      `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "status", "created_at", "updated_at")
       values (?, ?, 'draft', now(), now()), (?, ?, null, now(), now())`,
      [active, channel, draft, channel],
    );
    await em.execute(
      `insert into "product_channel_language_scopes" ("product_id", "sales_channel_id", "language_code", "status", "created_at", "updated_at")
       values (?, ?, 'de-DE', 'draft', now(), now()), (?, ?, 'pl-PL', 'active', now(), now())`,
      [active, channel, active, channel],
    );

    await runUp();

    expect(await product(active)).toEqual({ status: 'active', archived_at: null });
    expect(await product(draft)).toEqual({ status: 'inactive', archived_at: null });
    expect((await product(archivedInactive)).archived_at?.toISOString()).toBe(ARCHIVED_AT);
    expect((await product(archivedInactive)).status).toBe('inactive');
    expect((await product(bareInactive)).archived_at?.toISOString()).toBe(UPDATED_AT);

    const channelRows = (await em.execute(
      `select "product_id", "status" from "product_channel_scopes" where "sales_channel_id" = ? order by "status" nulls last`,
      [channel],
    )) as Array<{ product_id: string; status: string | null }>;
    expect(channelRows).toEqual([
      { product_id: active, status: 'inactive' },
      { product_id: draft, status: null },
    ]);
    const languageRows = (await em.execute(
      `select "language_code", "status" from "product_channel_language_scopes" where "sales_channel_id" = ? order by "language_code"`,
      [channel],
    )) as Array<{ language_code: string; status: string }>;
    expect(languageRows).toEqual([
      { language_code: 'de-DE', status: 'inactive' },
      { language_code: 'pl-PL', status: 'active' },
    ]);
  });

  it('leaves no stored value other than active / inactive in any of the three tables (SC-009)', async () => {
    await runDown();
    await insertProduct('draft', null);
    await runUp();
    for (const table of ['products', 'product_channel_scopes', 'product_channel_language_scopes']) {
      const rows = (await em.execute(
        `select count(*)::int as n from "${table}" where "status" is not null and "status" not in ('active', 'inactive')`,
      )) as Array<{ n: number }>;
      expect(rows[0]!.n, table).toBe(0);
    }
  });

  it('refuses draft in all three tables afterwards and defaults a new product to inactive (R30.2, Q1-d)', async () => {
    await runDown();
    await runUp();
    const id = randomUUID();
    await em.execute(
      `insert into "products" ("id", "sku", "slug", "type", "name", "description", "created_at", "updated_at")
       values (?, ?, ?, 'simple', '{"en-US":"Default"}', '{}', now(), now())`,
      [id, `T156B-D-${id.slice(0, 8)}`, `t156b-d-${id.slice(0, 8)}`],
    );
    expect((await product(id)).status).toBe('inactive');

    const channel = await insertChannel();
    await expectRefused(`update "products" set "status" = 'draft' where "id" = ?`, [id], 'products_status_check');
    await expectRefused(
      `insert into "product_channel_scopes" ("product_id", "sales_channel_id", "status", "created_at", "updated_at")
       values (?, ?, 'draft', now(), now())`,
      [id, channel],
      'product_channel_scopes_status_check',
    );
    await expectRefused(
      `insert into "product_channel_language_scopes" ("product_id", "sales_channel_id", "language_code", "status", "created_at", "updated_at")
       values (?, ?, 'de-DE', 'draft', now(), now())`,
      [id, channel],
      'product_channel_language_scopes_status_check',
    );
  });

  it('is correct on scope tables created by the old three-value body (R30.1)', async () => {
    // `down` restores exactly that body's `CHECK`s and default; `up` then has to
    // replace them rather than assume a fresh database.
    await runDown();
    const checks = (await em.execute(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname in ('product_channel_scopes_status_check', 'product_channel_language_scopes_status_check', 'products_status_check')
        order by conname`,
    )) as Array<{ conname: string; def: string }>;
    expect(checks.map((c) => c.conname)).toEqual([
      'product_channel_language_scopes_status_check',
      'product_channel_scopes_status_check',
    ]);
    for (const check of checks) expect(check.def).toContain('draft');
    const defaults = (await em.execute(
      `select column_default from information_schema.columns where table_name = 'products' and column_name = 'status'`,
    )) as Array<{ column_default: string }>;
    expect(defaults[0]!.column_default).toContain('draft');

    await runUp();
    const after = (await em.execute(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname in ('product_channel_scopes_status_check', 'product_channel_language_scopes_status_check', 'products_status_check')
        order by conname`,
    )) as Array<{ conname: string; def: string }>;
    expect(after.map((c) => c.conname)).toEqual([
      'product_channel_language_scopes_status_check',
      'product_channel_scopes_status_check',
      'products_status_check',
    ]);
    for (const check of after) expect(check.def).not.toContain('draft');
    const defaultsAfter = (await em.execute(
      `select column_default from information_schema.columns where table_name = 'products' and column_name = 'status'`,
    )) as Array<{ column_default: string }>;
    expect(defaultsAfter[0]!.column_default).toContain('inactive');
  });
});
