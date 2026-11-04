import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T004 — Migration test for feature 015 / `036_megamenu_init.ts`. Verifies the
 * three new tables, the GIN index on `megamenu_items.target`, the partial
 * unique index on `megamenu_bindings (sales_channel_id, language) WHERE active`,
 * and the supporting btree indexes per `data-model.md` § Migration ordering.
 */
describe('megamenu migration (T004 — 036_megamenu_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the three new tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('megamenus','megamenu_items','megamenu_bindings')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'megamenu_bindings',
      'megamenu_items',
      'megamenus',
    ]);
  });

  it('places the expected columns on megamenu_items including target/labels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'megamenu_items'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'id',
      'megamenu_id',
      'parent_id',
      'position',
      'kind',
      'labels',
      'descriptions',
      'target',
      'created_at',
      'updated_at',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('creates the GIN index on megamenu_items.target', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string; indexdef: string }>>(
      `select indexname, indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_items'`,
    );
    const gin = rows.find((r) => r.indexname === 'idx_megamenu_items_target_refs');
    expect(gin, 'idx_megamenu_items_target_refs missing').toBeDefined();
    expect(/USING gin/i.test(gin!.indexdef)).toBe(true);
  });

  it('creates the (megamenu_id, parent_id, position) tree-fetch index', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_items'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_megamenu_items_tree');
  });

  it('enforces partial unique on (sales_channel_id, language) WHERE active = true', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_bindings'`,
    );
    const partial = rows.some((r) =>
      /UNIQUE/i.test(r.indexdef) &&
      /sales_channel_id/.test(r.indexdef) &&
      /language/.test(r.indexdef) &&
      /WHERE\s+\(?active/i.test(r.indexdef),
    );
    expect(partial, 'partial unique index on (sales_channel_id, language) WHERE active=true').toBe(true);
  });

  it('places (sales_channel_id, language) lookup index on megamenu_bindings', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'megamenu_bindings'`,
    );
    expect(rows.map((r) => r.indexname)).toContain('idx_megamenu_bindings_channel_lang');
  });

  /**
   * Feature 168 (issue #522): tabs with a presentation and an alignment, and an
   * audience on every item. A tab carries both fields and nothing else does.
   */
  it('adds presentation, alignment and audience to megamenu_items (feature 168)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'megamenu_items'
         and column_name in ('presentation','alignment','audience')
       order by column_name`,
    );
    expect(rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
      ['alignment', 'character varying', 'YES'],
      ['audience', 'jsonb', 'NO'],
      ['presentation', 'character varying', 'YES'],
    ]);
    expect(rows.find((r) => r.column_name === 'audience')?.column_default).toContain('"kind": "everyone"');

    const checks = await conn.execute<Array<{ conname: string }>>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
       where t.relname = 'megamenu_items' and c.contype = 'c' order by c.conname`,
    );
    expect(checks.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'megamenu_items_alignment_check',
        'megamenu_items_presentation_check',
        'megamenu_items_tab_fields_check',
      ]),
    );
  });

  it('refuses a tab without a presentation and a child with one (feature 168)', async () => {
    const conn = db.orm.em.getConnection();
    const menuId = '16600000-0000-4000-8000-000000000001';
    const tabId = '16600000-0000-4000-8000-000000000002';
    await conn.execute(
      `insert into megamenus (id, name, created_at, updated_at) values (?, 'migration 168', now(), now())`,
      [menuId],
    );
    try {
      await expect(
        conn.execute(
          `insert into megamenu_items (id, megamenu_id, parent_id, position, kind, created_at, updated_at)
           values (?, ?, null, 0, 'group', now(), now())`,
          [tabId, menuId],
        ),
      ).rejects.toThrow(/megamenu_items_tab_fields_check/);
      await conn.execute(
        `insert into megamenu_items (id, megamenu_id, parent_id, position, kind, presentation, alignment, created_at, updated_at)
         values (?, ?, null, 0, 'group', 'mega', 'start', now(), now())`,
        [tabId, menuId],
      );
      await expect(
        conn.execute(
          `insert into megamenu_items (id, megamenu_id, parent_id, position, kind, presentation, alignment, created_at, updated_at)
           values (gen_random_uuid(), ?, ?, 0, 'group', 'mega', 'start', now(), now())`,
          [menuId, tabId],
        ),
      ).rejects.toThrow(/megamenu_items_tab_fields_check/);
    } finally {
      await conn.execute(`delete from megamenus where id = ?`, [menuId]);
    }
  });

  /**
   * Feature 168 review: a tab whose click follows its own link. Off by default,
   * and a tab's alone.
   */
  it('adds click_navigates to megamenu_items, off by default and on tabs only (feature 168)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ data_type: string; is_nullable: string; column_default: string | null }>>(
      `select data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'megamenu_items' and column_name = 'click_navigates'`,
    );
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
    const checks = await conn.execute<Array<{ conname: string }>>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
       where t.relname = 'megamenu_items' and c.conname = 'megamenu_items_click_navigates_check'`,
    );
    expect(checks).toHaveLength(1);
  });
});
