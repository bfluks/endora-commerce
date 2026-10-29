import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * `tasks`' init migration, read back from the database it produced
 * (`specs/163-projects-and-tasks/data-model.md` §1).
 *
 * Asserted from the catalogue rather than through the entity class, as CRM's
 * migration test is: the checks and indexes are properties no entity
 * declaration carries. Indexes are found by definition, not by name, so the
 * assertion is about what an index covers.
 */
describe('tasks init migration', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.orm.em.getConnection().execute(`delete from "tasks" where "title" like 'migration-test %'`);
    await teardownBackendServer(h);
  });

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await h.orm.em.getConnection().execute(sql, params)) as T[];
  }

  async function indexDefinitions(table: string): Promise<string[]> {
    const found = await rows<{ indexdef: string }>(
      `select indexdef from pg_indexes where schemaname = current_schema() and tablename = ?`,
      [table],
    );
    return found.map((row) => row.indexdef.replace(/\s+/g, ' '));
  }

  /** Insert one Task by hand; `overrides` are SQL expressions keyed by column. */
  function insertTask(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      id: `'${randomUUID()}'`,
      number: `'TSK-M${Math.floor(Math.random() * 1e9)}'`,
      title: `'migration-test ${randomUUID()}'`,
      created_by_admin_user_id: `'${TEST_ADMIN_ID}'`,
      created_at: 'now()',
      updated_at: 'now()',
      ...overrides,
    };
    const columns = Object.keys(values);
    return rows(
      `insert into "tasks" (${columns.map((c) => `"${c}"`).join(', ')})
       values (${columns.map((c) => values[c]).join(', ')})`,
    );
  }

  it('creates the one table of the module, `tasks`', async () => {
    const found = await rows<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = current_schema() and table_name in ('tasks', 'task')`,
    );
    expect(found.map((row) => row.table_name)).toEqual(['tasks']);
  });

  it('has the columns of the data model, with their types, nullability and defaults', async () => {
    const found = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = current_schema() and table_name = 'tasks'
        order by ordinal_position`,
    );
    expect(found).toEqual([
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', column_default: 'gen_random_uuid()' },
      { column_name: 'number', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'title', data_type: 'text', is_nullable: 'NO', column_default: null },
      { column_name: 'description', data_type: 'text', is_nullable: 'NO', column_default: "''::text" },
      { column_name: 'status', data_type: 'text', is_nullable: 'NO', column_default: "'todo'::text" },
      { column_name: 'assigned_admin_user_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'due_on', data_type: 'date', is_nullable: 'YES', column_default: null },
      { column_name: 'completed_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'created_by_admin_user_id', data_type: 'uuid', is_nullable: 'NO', column_default: null },
      { column_name: 'context_type', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'context_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'context_group_id', data_type: 'uuid', is_nullable: 'YES', column_default: null },
      { column_name: 'context_note', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO', column_default: 'now()' },
    ]);
  });

  it('references nothing: every cross-module id is held by value', async () => {
    const found = await rows<{ conname: string }>(
      `select conname from pg_constraint where contype = 'f' and conrelid = 'tasks'::regclass`,
    );
    expect(found).toEqual([]);
  });

  it('creates the number sequence', async () => {
    const found = await rows<{ sequence_name: string }>(
      `select sequence_name from information_schema.sequences
        where sequence_schema = current_schema() and sequence_name = 'tasks_number_seq'`,
    );
    expect(found).toHaveLength(1);
  });

  it('keeps the number unique', async () => {
    const number = `'TSK-UNIQ-${randomUUID()}'`;
    await expect(insertTask({ number })).resolves.toBeDefined();
    await expect(insertTask({ number })).rejects.toThrow(/unique|duplicate/i);
  });

  it('holds the status to its four values — a check constraint', async () => {
    for (const status of ['todo', 'in_progress', 'done', 'cancelled']) {
      await expect(insertTask({ status: `'${status}'` }), status).resolves.toBeDefined();
    }
    await expect(insertTask({ status: `'open'` })).rejects.toThrow(/check constraint/i);
  });

  it('holds the title to 1–200 characters, the description to 20 000 and the note to 200', async () => {
    await expect(insertTask({ title: `''` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ title: `'migration-test ${'x'.repeat(186)}'` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ title: `'migration-test ${'x'.repeat(185)}'` })).resolves.toBeDefined();
    await expect(insertTask({ description: `repeat('d', 20001)` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ description: `repeat('d', 20000)` })).resolves.toBeDefined();
    const context = { context_type: `'probe'`, context_id: `'${randomUUID()}'` };
    await expect(insertTask({ ...context, context_note: `repeat('n', 201)` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ ...context, context_note: `repeat('n', 200)` })).resolves.toBeDefined();
  });

  it('takes a context all or nothing — a type without an id, or an id without a type, is refused', async () => {
    await expect(insertTask({ context_type: `'probe'` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ context_id: `'${randomUUID()}'` })).rejects.toThrow(/check constraint/i);
    await expect(insertTask({ context_type: `'probe'`, context_id: `'${randomUUID()}'` })).resolves.toBeDefined();
    await expect(insertTask()).resolves.toBeDefined();
  });

  it('allows a group only inside a context', async () => {
    await expect(insertTask({ context_group_id: `'${randomUUID()}'` })).rejects.toThrow(/check constraint/i);
    await expect(
      insertTask({
        context_type: `'probe'`,
        context_id: `'${randomUUID()}'`,
        context_group_id: `'${randomUUID()}'`,
      }),
    ).resolves.toBeDefined();
  });

  it('carries the three indexes of the data model: My Tasks, the context, and status by due date', async () => {
    const definitions = await indexDefinitions('tasks');
    const has = (pattern: RegExp) =>
      expect(definitions.some((d) => pattern.test(d)), definitions.join('\n')).toBe(true);
    has(/CREATE INDEX .*\(assigned_admin_user_id, status, due_on\)$/);
    has(/CREATE INDEX .*\(context_type, context_id, context_group_id, status\)$/);
    has(/CREATE INDEX .*\(status, due_on\)$/);
    has(/CREATE UNIQUE INDEX .*\(number\)$/);
  });
});
