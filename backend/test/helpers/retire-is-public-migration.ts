import type { EntityManager } from '@mikro-orm/postgresql';
import { Migration20261028T173317CoreSalesChannelsRetireIsPublic } from '@endora-commerce/platform/migrations';

/**
 * Issue #492 — drives `…CoreSalesChannelsRetireIsPublic` against a database
 * that has already applied it.
 *
 * The test database is migrated, so `sales_channels.is_public` is gone by the
 * time a test runs. To have something to migrate, a test recreates the column
 * **inside its own transaction**, marks the channels it wants non-public, and
 * runs the migration's statements on that transaction. PostgreSQL DDL is
 * transactional, so the column is never visible to another connection: it is
 * added and dropped again before the transaction commits (or rolled back with
 * it), and a second file doing the same waits on the table lock rather than
 * meeting a column it did not add.
 *
 * The column is recreated with `default true`, not the historical `false`, so
 * that a channel some other file inserts meanwhile is never mistaken for a
 * non-public one: only the channels named here are.
 */
export async function recreateLegacyIsPublic(
  tx: EntityManager,
  nonPublicChannelIds: readonly string[],
): Promise<void> {
  await tx.execute(
    `alter table "sales_channels" add column "is_public" boolean not null default true`,
  );
  if (nonPublicChannelIds.length === 0) return;
  await tx.execute(
    `update "sales_channels" set "is_public" = false where "id" in (${nonPublicChannelIds.map(() => '?').join(', ')})`,
    [...nonPublicChannelIds],
  );
}

/** Run one direction of the migration's statements on `tx`. */
export async function runRetireIsPublic(tx: EntityManager, direction: 'up' | 'down'): Promise<void> {
  const migration = new Migration20261028T173317CoreSalesChannelsRetireIsPublic(tx.getDriver(), tx.config);
  await migration[direction]();
  for (const query of migration.getQueries()) await tx.execute(query as string);
}

/**
 * Recreate the column, mark `nonPublicChannelIds` non-public and migrate —
 * committed, so the HTTP surfaces of the running test server see the outcome.
 */
export async function migrateChannelsAsFormerlyNonPublic(
  em: EntityManager,
  nonPublicChannelIds: readonly string[],
): Promise<void> {
  await em.fork().transactional(async (tx) => {
    await recreateLegacyIsPublic(tx, nonPublicChannelIds);
    await runRetireIsPublic(tx, 'up');
  });
}
