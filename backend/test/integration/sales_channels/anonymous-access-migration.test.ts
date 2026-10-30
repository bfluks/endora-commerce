import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Migration20261018T101912CoreSalesChannelsAnonymousAccess } from '@endora-commerce/platform/migrations';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 154 — `sales_channels.anonymous_access` (data-model M1; FR-001,
 * FR-003, User Story 3 #3).
 *
 * Every channel that exists when the feature ships is open to anonymous
 * visitors, and so is every channel a writer creates without naming the flag —
 * the SQL inserts other features' fixtures and integrations make included. The
 * statements come from the migration class.
 */
describe('sales_channels.anonymous_access migration', () => {
  let h: BackendServerHandle;

  async function runMigration(): Promise<void> {
    const em = h.em();
    const migration = new Migration20261018T101912CoreSalesChannelsAnonymousAccess(
      em.getDriver(),
      em.config,
    );
    await migration.up();
    for (const query of migration.getQueries()) await em.execute(query as string);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await h.em().execute(`delete from "sales_channels" where "code" = 'm1-raw-insert'`);
    await teardownBackendServer(h);
  });

  it('is a non-null boolean defaulting to open, and re-running it is harmless', async () => {
    await runMigration();
    const rows = await h
      .em()
      .execute<Array<{ data_type: string; is_nullable: string; column_default: string }>>(
        `select data_type, is_nullable, column_default from information_schema.columns
       where table_name = 'sales_channels' and column_name = 'anonymous_access'`,
      );
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'NO', column_default: 'true' }]);
  });

  it('leaves every existing channel open', async () => {
    const closed = await h
      .em()
      .execute<Array<{ n: string }>>(
        `select count(*)::text as n from "sales_channels" where "anonymous_access" = false`,
      );
    expect(closed[0]!.n).toBe('0');
  });

  it('opens a channel inserted without naming the column', async () => {
    await h.em().execute(
      `insert into "sales_channels"
         ("id", "code", "name", "languages", "default_language", "currencies", "default_currency",
          "active", "system_default", "version", "status", "created_at", "updated_at")
       values (gen_random_uuid(), 'm1-raw-insert', '{"en-US":"Raw"}', '["en-US"]', 'en-US',
               '["PLN"]', 'PLN', true, false, 1, 'active', now(), now())`,
    );
    const rows = await h
      .em()
      .execute<Array<{ anonymous_access: boolean }>>(
        `select "anonymous_access" from "sales_channels" where "code" = 'm1-raw-insert'`,
      );
    expect(rows[0]!.anonymous_access).toBe(true);
  });
});
