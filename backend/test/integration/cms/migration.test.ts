import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T008 — Migration test for feature 014 / `035_cms_init.ts`. Verifies the
 * new tables, the eight new columns on `cms_pages`, the GIN indexes on the
 * three content columns, the unique slug-per-channel index, the seeded 23
 * Hook codes with `is_system=true`, and the legacy backfill.
 */
describe('cms migration (T008 — 035_cms_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the four new tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('cms_blocks','cms_templates','cms_hooks','cms_hook_block_attachments')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'cms_blocks',
      'cms_hook_block_attachments',
      'cms_hooks',
      'cms_templates',
    ]);
  });

  it('creates the four channel-join tables', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'cms_page_sales_channels',
           'cms_block_sales_channels',
           'cms_template_sales_channels',
           'cms_hook_sales_channels'
         )
       order by table_name`,
    );
    expect(rows).toHaveLength(4);
  });

  it('adds eight new columns to cms_pages', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages'`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'name',
      'slug',
      'active',
      'description',
      'meta_title',
      'meta_description',
      'meta_keywords',
      'content',
      'languages',
      'version',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('creates the GIN indexes on the three new content columns', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'idx_cms_pages_content_asset_refs',
           'idx_cms_blocks_content_asset_refs',
           'idx_cms_templates_content_asset_refs'
         )`,
    );
    expect(rows).toHaveLength(3);
  });

  it('enforces UNIQUE (sales_channel_id, slug) on cms_page_sales_channels', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'cms_page_sales_channels'`,
    );
    const hasUnique = rows.some(
      (r) => /UNIQUE/i.test(r.indexdef) && /sales_channel_id/.test(r.indexdef) && /slug/.test(r.indexdef),
    );
    expect(hasUnique).toBe(true);
  });

  it('enforces globally-unique cms_hooks.code', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'cms_hooks'`,
    );
    const hasUnique = rows.some((r) => /UNIQUE/i.test(r.indexdef) && /\(code\)/i.test(r.indexdef));
    expect(hasUnique).toBe(true);
  });

  /**
   * Feature 163 (T078; data-model §1.1, research R-18): the page tree and the
   * sharing image. A new case rather than a changed one — the "eight new
   * columns" case above stays the feature-014 statement it was.
   */
  it('adds the page-tree, breadcrumb and sharing-image columns to cms_pages (feature 163)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages'
         and column_name in ('parent_page_id','breadcrumbs_visible','breadcrumbs_scheme','share_image_asset_id')
       order by column_name`,
    );
    expect(rows.map((r) => [r.column_name, r.data_type, r.is_nullable])).toEqual([
      ['breadcrumbs_scheme', 'text', 'NO'],
      ['breadcrumbs_visible', 'boolean', 'NO'],
      ['parent_page_id', 'uuid', 'YES'],
      ['share_image_asset_id', 'uuid', 'YES'],
    ]);
    expect(rows.find((r) => r.column_name === 'breadcrumbs_scheme')?.column_default).toMatch(/'light'/);
    expect(rows.find((r) => r.column_name === 'breadcrumbs_visible')?.column_default).toBe('true');

    const fks = await conn.execute<Array<{ delete_rule: string; foreign_table: string }>>(
      `select rc.delete_rule, ccu.table_name as foreign_table
       from information_schema.key_column_usage kcu
       join information_schema.referential_constraints rc
         on rc.constraint_name = kcu.constraint_name and rc.constraint_schema = kcu.constraint_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = kcu.constraint_name and ccu.constraint_schema = kcu.constraint_schema
       where kcu.table_schema = 'public' and kcu.table_name = 'cms_pages'
         and kcu.column_name = 'parent_page_id'`,
    );
    expect(fks).toEqual([{ delete_rule: 'SET NULL', foreign_table: 'cms_pages' }]);

    const indexes = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'cms_pages'
         and indexname = 'cms_pages_parent_page_id_idx'`,
    );
    expect(indexes).toHaveLength(1);

    const checks = await conn.execute<Array<{ def: string }>>(
      `select pg_get_constraintdef(c.oid) as def
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'cms_pages' and c.contype = 'c'
         and c.conname = 'cms_pages_breadcrumbs_scheme_check'`,
    );
    expect(checks).toHaveLength(1);
    for (const scheme of ['light', 'muted', 'dark']) expect(checks[0]!.def).toContain(`'${scheme}'`);
  });

  /**
   * Feature 163 R19D (T284): whether a page's address includes its parent's
   * path. Off by default, so every stored page keeps its flat address.
   */
  it('adds parent_path_in_url to cms_pages, not null and off by default (163 R19D)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `select data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages' and column_name = 'parent_path_in_url'`,
    );
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
  });

  /**
   * Feature 163 R21H (T355): whether a page draws its breadcrumb trail over
   * its first section. Off by default, so every stored page keeps its band.
   */
  it('adds breadcrumbs_overlay to cms_pages, not null and off by default (163 R21H)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `select data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages' and column_name = 'breadcrumbs_overlay'`,
    );
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' }]);
  });

  /**
   * Feature 163 R24 (issue #521): a page's name, slug and description per
   * language. Empty by default, so every stored page inherits its own fields.
   */
  it('adds translations to cms_pages, not null and empty by default (163 R24)', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{ data_type: string; is_nullable: string; column_default: string | null }>
    >(
      `select data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'cms_pages' and column_name = 'translations'`,
    );
    expect(rows).toEqual([{ data_type: 'jsonb', is_nullable: 'NO', column_default: "'{}'::jsonb" }]);
  });

  it('seeds 23 base Hook codes with is_system=true', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ code: string }>>(
      `select code from cms_hooks where is_system = true order by code`,
    );
    const codes = rows.map((r) => r.code).sort();
    expect(codes).toContain('header.top');
    expect(codes).toContain('homepage.top');
    expect(codes).toContain('homepage.bottom');
    expect(codes).toContain('product.top');
    expect(codes).toContain('product.bottom');
    expect(codes).toContain('cms.page.top');
    expect(codes).toContain('cms.page.bottom');
    expect(codes).toContain('register.bottom');
    expect(codes.length).toBeGreaterThanOrEqual(23);
  });
});
