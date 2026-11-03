/**
 * A clone of the run's template with its invariants withdrawn **is** a
 * database migrated from empty — the claim the demo files stand on.
 *
 * `demo-shop`, `demo-instance-shape` and `demo-pipeline-off-state` each used to
 * create an empty database and spawn `migration:up` into it, because what they
 * measure starts at a platform's **first boot**: the boot's reconcilers write
 * the module registrations, the settings and the system-default channel (under
 * the instance's own `DEFAULT_SALES_CHANNEL_CODE`), and a database that already
 * held any of it would change their answer. They now take
 * `migratedDatabase()` (`test/helpers/migrated-database.ts`): a clone of the
 * template `test/global-setup.ts` migrated once for the whole run, with what
 * `establishPlatformInvariants` added withdrawn again.
 *
 * **This is the one file that still migrates from empty, and that is its
 * whole job.** It spawns the migrator exactly as the demo files did, takes the
 * clone they take now, and compares the two — schema, migration ledger, and
 * every table's rows. A second invariant added to `test/template-seed.ts`
 * without its withdrawal is red here, rather than a demo file starting quietly
 * from a different state.
 *
 * What the comparison leaves out, and why: columns of type `uuid` and the
 * timestamp types. A migration that inserts a row lets the database default its
 * id and its `created_at`, so two migrations from empty disagree on exactly
 * those columns with each other, and no file could ever have depended on them.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migratedDatabase, type MigratedDatabase } from '../../helpers/migrated-database.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** One migration from empty, one clone and two catalogue reads. */
const SUITE_TIMEOUT_MS = 600_000;

const MIGRATED_DB = `mcp_${randomBytes(4).toString('hex')}_migrated_test`;

/** Values a migration lets the database choose, which differ between any two runs. */
const RUN_CHOSEN_TYPES = new Set([
  'uuid',
  'timestamp with time zone',
  'timestamp without time zone',
  'date',
]);

function dsnFor(database: string): string {
  const declared = process.env['DATABASE_URL'];
  if (declared === undefined || declared === '') {
    throw new Error(
      'migrated-clone parity: DATABASE_URL is not set. This test provisions its own ' +
        'throwaway database from the running invocation’s DSN and cannot invent one.',
    );
  }
  const url = new URL(declared);
  url.pathname = `/${database}`;
  return url.toString();
}

async function migrateFromEmpty(url: string): Promise<void> {
  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/db/migrate.ts', 'up'], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', rejectRun);
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(
            `migration:up exited ${signal === null ? `with code ${code}` : `on ${signal}`}:\n${output}`,
          ),
        );
    });
  });
}

/** Everything about a database the demo files could observe, minus run-chosen values. */
interface DatabaseShape {
  readonly columns: readonly string[];
  readonly constraints: readonly string[];
  readonly indexes: readonly string[];
  readonly migrations: readonly string[];
  readonly rows: Readonly<Record<string, { readonly count: number; readonly digest: string }>>;
}

async function shapeOf(url: string): Promise<DatabaseShape> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const columns = await client.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        order by c.table_name, c.ordinal_position`,
    );
    const constraints = await client.query<{ line: string }>(
      `select conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) as line
         from pg_constraint
        where connamespace = 'public'::regnamespace
        order by 1`,
    );
    const indexes = await client.query<{ line: string }>(
      `select indexdef as line from pg_indexes where schemaname = 'public' order by 1`,
    );
    const migrations = await client.query<{ name: string }>(
      `select name from mikro_orm_migrations order by id`,
    );

    const byTable = new Map<string, string[]>();
    for (const column of columns.rows) {
      if (column.table_name === 'mikro_orm_migrations') continue;
      const kept = byTable.get(column.table_name) ?? [];
      if (!RUN_CHOSEN_TYPES.has(column.data_type)) kept.push(column.column_name);
      byTable.set(column.table_name, kept);
    }
    const rows: Record<string, { count: number; digest: string }> = {};
    for (const [table, kept] of byTable) {
      const projection =
        kept.length === 0 ? `''` : `row(${kept.map((name) => `"${name}"`).join(', ')})::text`;
      const result = await client.query<{ n: string; digest: string }>(
        `select count(*)::text as n,
                md5(coalesce(string_agg(r, E'\\n' order by r), '')) as digest
           from (select ${projection} as r from "${table}") projected`,
      );
      rows[table] = { count: Number(result.rows[0]!.n), digest: result.rows[0]!.digest };
    }

    return {
      columns: columns.rows.map(
        (column) =>
          `${column.table_name}.${column.column_name} ${column.data_type} ` +
          `${column.is_nullable} ${column.column_default ?? ''}`,
      ),
      constraints: constraints.rows.map((row) => row.line),
      indexes: indexes.rows.map((row) => row.line),
      migrations: migrations.rows.map((row) => row.name),
      rows,
    };
  } finally {
    await client.end();
  }
}

describe('a migrated-database clone is a database migrated from empty', () => {
  let clone: MigratedDatabase | undefined;
  let migrated: DatabaseShape;
  let cloned: DatabaseShape;

  beforeAll(async () => {
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`create database "${MIGRATED_DB}"`);
    } finally {
      await admin.end();
    }
    await migrateFromEmpty(dsnFor(MIGRATED_DB));
    clone = await migratedDatabase('mcp', migrateFromEmpty);
    migrated = await shapeOf(dsnFor(MIGRATED_DB));
    cloned = await shapeOf(clone.url);
  }, SUITE_TIMEOUT_MS);

  afterAll(async () => {
    await clone?.drop();
    const admin = new Client({ connectionString: dsnFor('postgres') });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${MIGRATED_DB}" with (force)`);
    } finally {
      await admin.end();
    }
  }, SUITE_TIMEOUT_MS);

  it('has the same schema', () => {
    expect(cloned.columns).toEqual(migrated.columns);
    expect(cloned.constraints).toEqual(migrated.constraints);
    expect(cloned.indexes).toEqual(migrated.indexes);
  });

  it('has applied the same migrations, in the same order', () => {
    expect(migrated.migrations.length).toBeGreaterThan(0);
    expect(cloned.migrations).toEqual(migrated.migrations);
  });

  it('holds the same rows in every table — and no sales channel, which a first boot creates', () => {
    // Not a vacuous agreement: migrations seed reference data, so a comparison
    // that read nothing would show it here.
    expect(Object.values(migrated.rows).some((table) => table.count > 0)).toBe(true);
    expect(migrated.rows['sales_channels']?.count).toBe(0);
    expect(cloned.rows).toEqual(migrated.rows);
  });
});
