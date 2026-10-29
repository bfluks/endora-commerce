import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

/**
 * T008 — Migration test for feature 013 / `034_assets_library_init.ts`.
 * (Migration number 033 was taken by promotions/criteria; renumbered to 034.)
 * Verifies the new asset_folders table, the eight new columns on `assets`,
 * the `categories.main_image_asset_id` FK, the GIN index on cms_pages.body,
 * and the two backfill UPDATE rules described in `data-model.md`.
 *
 * The GIN index is asserted here and is no longer created here: since
 * `specs/120-migration-closure-bridge-ownership/` Phase 3 it is
 * `Migration20260912T125709CmsPageBodyAssetRefIndex`'s, `cms_pages` being
 * `cms`' table. The assertion stands unchanged and is still this feature's to
 * make — the index exists for reference protection's scan — but an instance
 * without `cms` has neither the table nor the index, and this suite migrates
 * the whole corpus.
 */
describe('assets_library migration (T008 — 034_assets_library_init)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the asset_folders table', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ table_name: string }>>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = 'asset_folders'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('adds eight new columns to the assets table', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string; data_type: string }>>(
      `select column_name, data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'assets'
       order by column_name`,
    );
    const cols = new Set(rows.map((r) => r.column_name));
    for (const expected of [
      'folder_id',
      'visibility',
      'label',
      'storage_backend',
      'storage_locator',
      'pending_cleanup',
      'purge_after_at',
      'mime_type_overridden',
    ]) {
      expect(cols.has(expected), `missing column "${expected}"`).toBe(true);
    }
  });

  it('adds main_image_asset_id to categories', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'categories'
         and column_name = 'main_image_asset_id'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('creates the GIN index for the cms_pages.body asset-ref scan', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexname: string }>>(
      `select indexname from pg_indexes
       where schemaname = 'public'
         and tablename = 'cms_pages'
         and indexname = 'idx_cms_pages_body_asset_refs'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('enforces the visibility CHECK constraint', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ contype: string; pg_get_constraintdef: string }>>(
      `select c.contype, pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'assets' and c.conname = 'assets_visibility_check'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pg_get_constraintdef).toMatch(/'public'/);
    expect(rows[0]!.pg_get_constraintdef).toMatch(/'private'/);
  });

  it('enforces the storage_backend CHECK constraint covering local|s3|gcs|legacy', async () => {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ pg_get_constraintdef: string }>>(
      `select pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'assets' and c.conname = 'assets_storage_backend_check'`,
    );
    expect(rows).toHaveLength(1);
    for (const expected of ['local', 's3', 'gcs', 'legacy']) {
      expect(rows[0]!.pg_get_constraintdef).toMatch(new RegExp(`'${expected}'`));
    }
  });

  it('backfills storage_backend=legacy for rows whose storage_url is an absolute URL', async () => {
    // Run the backfill on synthetic test rows. We insert two assets, one with
    // an http(s) URL and one with a relative path; neither has storage_locator
    // set, so the migration's pass-1 + pass-2 UPDATEs apply.
    await db.beginTx();
    try {
      const em = db.em();
      const conn = em.getConnection();
      const legacyId = randomUUID();
      const localId = randomUUID();
      await conn.execute(
        `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at, storage_locator, storage_backend)
         values
           (?, 'image', 'a.jpg', 'image/jpeg', 100, 'https://example.com/a.jpg', now(), now(), '', 'local'),
           (?, 'image', 'b.jpg', 'image/jpeg', 100, 'ab/cd/b.jpg',               now(), now(), '', 'local')`,
        [legacyId, localId],
      );

      // Re-execute the migration's two backfill statements idempotently.
      await conn.execute(
        `update assets set storage_locator = storage_url where storage_locator = ''`,
      );
      await conn.execute(
        `update assets set storage_backend = 'legacy' where storage_locator ~ '^https?://'`,
      );

      const rows = await conn.execute<
        Array<{ id: string; storage_backend: string; storage_locator: string }>
      >(
        `select id::text as id, storage_backend, storage_locator
         from assets where id in (?, ?)`,
        [legacyId, localId],
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[legacyId]!.storage_backend).toBe('legacy');
      expect(byId[legacyId]!.storage_locator).toBe('https://example.com/a.jpg');
      expect(byId[localId]!.storage_backend).toBe('local');
      expect(byId[localId]!.storage_locator).toBe('ab/cd/b.jpg');
    } finally {
      await db.rollbackTx();
    }
  });

  it('case-insensitively rejects duplicate folder names within the same parent', async () => {
    await db.beginTx();
    try {
      const em = db.em();
      const conn = em.getConnection();
      const a = randomUUID();
      const b = randomUUID();
      // Use a unique folder name per run so a leaked previous-run row cannot
      // produce a false positive against an unrelated row.
      const name = `Marketing-${a.slice(0, 8)}`;
      await conn.execute(
        `insert into asset_folders (id, parent_id, name, position, created_at, updated_at)
         values (?, null, ?, 0, now(), now())`,
        [a, name],
      );
      await expect(
        conn.execute(
          `insert into asset_folders (id, parent_id, name, position, created_at, updated_at)
           values (?, null, ?, 1, now(), now())`,
          [b, name.toLowerCase()],
        ),
      ).rejects.toThrow();
    } finally {
      await db.rollbackTx();
    }
  });

  // ---------------------------------------------------------------------------
  // specs/156-asset-stable-url/ data-model §1–§1b (T005).
  // ---------------------------------------------------------------------------

  async function columnsOf(table: string) {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<
      Array<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        character_maximum_length: number | null;
        column_default: string | null;
      }>
    >(
      `select column_name, data_type, is_nullable, character_maximum_length, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = ?`,
      [table],
    );
    return new Map(rows.map((r) => [r.column_name, r]));
  }

  async function indexDef(name: string): Promise<string | undefined> {
    const conn = db.orm.em.getConnection();
    const rows = await conn.execute<Array<{ indexdef: string }>>(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = ?`,
      [name],
    );
    return rows[0]?.indexdef;
  }

  /** A raw row the way other modules' seeds and fixtures insert one — no content_version. */
  async function insertRawAsset(
    conn: { execute: (sql: string, params?: unknown[]) => Promise<unknown> },
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID();
    const columns = ['id', 'kind', 'filename', 'mime_type', 'size_bytes', 'storage_url', 'created_at', 'updated_at'];
    const values: unknown[] = [id, 'pdf', `as156-${id.slice(0, 8)}.pdf`, 'application/pdf', 100, `as156/${id}.pdf`];
    const placeholders = ['?', '?', '?', '?', '?', '?', 'now()', 'now()'];
    for (const [column, value] of Object.entries(extra)) {
      columns.push(column);
      values.push(value);
      placeholders.push('?');
    }
    await conn.execute(
      `insert into assets (${columns.join(', ')}) values (${placeholders.join(', ')})`,
      values,
    );
    return id;
  }

  it('adds the eleven version and permalink columns to assets with their types and nullability', async () => {
    const cols = await columnsOf('assets');
    const expected: Array<[string, string, 'YES' | 'NO', number | null]> = [
      ['content_version', 'character varying', 'NO', 32],
      ['permalink', 'character varying', 'YES', 200],
      ['previous_storage_locator', 'character varying', 'YES', 2048],
      ['previous_filename', 'character varying', 'YES', 255],
      ['previous_mime_type', 'character varying', 'YES', 127],
      ['previous_mime_type_overridden', 'boolean', 'YES', null],
      ['previous_kind', 'character varying', 'YES', 16],
      ['previous_size_bytes', 'bigint', 'YES', null],
      ['previous_content_version', 'character varying', 'YES', 32],
      ['previous_replaced_at', 'timestamp with time zone', 'YES', null],
      ['previous_replaced_by', 'uuid', 'YES', null],
    ];
    for (const [name, type, nullable, length] of expected) {
      const col = cols.get(name);
      expect(col, `missing column "${name}"`).toBeDefined();
      expect(col!.data_type, name).toBe(type);
      expect(col!.is_nullable, name).toBe(nullable);
      expect(col!.character_maximum_length, name).toBe(length);
    }
  });

  it('creates the permalink, previous-version and soft-delete indexes', async () => {
    const permalink = await indexDef('assets_permalink_lower_unique');
    expect(permalink).toMatch(/CREATE UNIQUE INDEX/);
    expect(permalink).toMatch(/lower\(\(permalink\)::text\)/);
    expect(permalink).toMatch(/WHERE \(permalink IS NOT NULL\)/);

    const previous = await indexDef('assets_previous_replaced_at_idx');
    expect(previous).toMatch(/\(previous_replaced_at\)/);
    expect(previous).toMatch(/WHERE \(previous_replaced_at IS NOT NULL\)/);

    const softDeleted = await indexDef('assets_soft_deleted_at_idx');
    expect(softDeleted).toMatch(/\(deleted_at\)/);
    expect(softDeleted).toMatch(/WHERE \(deleted_at IS NOT NULL\)/);
  });

  it('gives every assets row a 12-hex content_version, and a raw insert a fresh one', async () => {
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const a = await insertRawAsset(conn);
      const b = await insertRawAsset(conn);
      const bad = await conn.execute<Array<{ n: string }>>(
        `select count(*)::text as n from assets where content_version !~ '^[0-9a-f]{12}$'`,
      );
      expect(bad[0]!.n).toBe('0');
      const rows = await conn.execute<Array<{ id: string; content_version: string }>>(
        `select id::text as id, content_version from assets where id in (?, ?)`,
        [a, b],
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.content_version).toMatch(/^[0-9a-f]{12}$/);
      expect(rows[0]!.content_version).not.toBe(rows[1]!.content_version);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses two permalinks that differ only by case, and lets null permalinks coexist', async () => {
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const suffix = randomUUID().slice(0, 8);
      await insertRawAsset(conn);
      await insertRawAsset(conn);
      await insertRawAsset(conn, { permalink: `as156-${suffix}/Certificate.pdf` });
      await expect(
        insertRawAsset(conn, { permalink: `as156-${suffix}/certificate.PDF` }),
      ).rejects.toThrow(/assets_permalink_lower_unique/);
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses a partially recorded previous version', async () => {
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      await expect(
        insertRawAsset(conn, { previous_storage_locator: `as156/${randomUUID()}.prev.pdf` }),
      ).rejects.toThrow(/assets_previous_version_complete/);
    } finally {
      await db.rollbackTx();
    }
  });

  it('accepts a complete previous version with or without its actor', async () => {
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const complete = {
        previous_storage_locator: `as156/${randomUUID()}.prev.pdf`,
        previous_filename: 'certificate.pdf',
        previous_mime_type: 'application/pdf',
        previous_mime_type_overridden: false,
        previous_kind: 'pdf',
        previous_size_bytes: 10,
        previous_content_version: 'a1b2c3d4e5f6',
        previous_replaced_at: new Date(),
      };
      await insertRawAsset(conn, complete);
      await insertRawAsset(conn, { ...complete, previous_replaced_by: randomUUID() });
    } finally {
      await db.rollbackTx();
    }
  });

  it('creates asset_permalink_releases keyed by permalink_lower with a reason check', async () => {
    const cols = await columnsOf('asset_permalink_releases');
    for (const name of ['permalink_lower', 'permalink', 'asset_id', 'released_at', 'reason']) {
      expect(cols.get(name)?.is_nullable, name).toBe('NO');
    }
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const name = `as156-${randomUUID().slice(0, 8)}/certificate.pdf`;
      const insert = (reason: string) =>
        conn.execute(
          `insert into asset_permalink_releases (permalink_lower, permalink, asset_id, released_at, reason)
           values (?, ?, ?, now(), ?)`,
          [name.toLowerCase(), name, randomUUID(), reason],
        );
      await insert('changed');
      await expect(insert('removed')).rejects.toThrow(/asset_permalink_releases_pkey/);
    } finally {
      await db.rollbackTx();
    }
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const name = `as156-${randomUUID().slice(0, 8)}/certificate.pdf`;
      await expect(
        conn.execute(
          `insert into asset_permalink_releases (permalink_lower, permalink, asset_id, released_at, reason)
           values (?, ?, ?, now(), 'renamed')`,
          [name, name, randomUUID()],
        ),
      ).rejects.toThrow(/asset_permalink_releases_reason_check/);
    } finally {
      await db.rollbackTx();
    }
  });

  it('creates asset_object_cleanups unique per object, with a reason check and attempts defaulting to 0', async () => {
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      const locator = `as156/${randomUUID()}.stage.pdf`;
      const id = randomUUID();
      await conn.execute(
        `insert into asset_object_cleanups (id, storage_backend, locator, reason, recorded_at)
         values (?, 'local', ?, 'staging', now())`,
        [id, locator],
      );
      const rows = await conn.execute<Array<{ attempts: number }>>(
        `select attempts from asset_object_cleanups where id = ?`,
        [id],
      );
      expect(rows[0]!.attempts).toBe(0);
      await expect(
        conn.execute(
          `insert into asset_object_cleanups (id, storage_backend, locator, reason, recorded_at)
           values (?, 'local', ?, 'previous', now())`,
          [randomUUID(), locator],
        ),
      ).rejects.toThrow(/asset_object_cleanups_locator_unique/);
    } finally {
      await db.rollbackTx();
    }
    await db.beginTx();
    try {
      const conn = db.em().getConnection();
      await expect(
        conn.execute(
          `insert into asset_object_cleanups (id, storage_backend, locator, reason, recorded_at)
           values (?, 'local', ?, 'other', now())`,
          [randomUUID(), `as156/${randomUUID()}.pdf`],
        ),
      ).rejects.toThrow(/asset_object_cleanups_reason_check/);
    } finally {
      await db.rollbackTx();
    }
  });
});
