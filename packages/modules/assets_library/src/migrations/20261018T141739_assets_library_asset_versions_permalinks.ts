import { Migration } from '@mikro-orm/migrations';

/**
 * Stable asset URLs — `specs/156-asset-stable-url/data-model.md` §1–§1b.
 *
 * On `assets`:
 *   - `content_version`, the identity of the bytes the asset currently holds
 *     (research R-7). Existing rows are backfilled with a random 12-hex token;
 *     the column also carries a random default, because rows are still written
 *     by raw SQL that names only the original columns (the demo seed and other
 *     modules' fixtures). The entity mints its own token for every row it
 *     creates, so the default is reached only by those writers.
 *   - `permalink`, unique case-insensitively among the rows that have one.
 *   - the nine `previous_*` columns of the one kept previous version, recorded
 *     all together or not at all (`previous_replaced_by` may be null alone —
 *     a system actor).
 *   - a partial index for the previous-version pass and one for the
 *     soft-delete pass of the retention sweep.
 *
 * Two new tables, both platform-global and owned by this module, with no
 * foreign key — the asset they name may already have been purged:
 *   - `asset_permalink_releases`, one row per permalink that stopped being
 *     held (research R-22);
 *   - `asset_object_cleanups`, the ledger of storage objects still to delete
 *     (research R-21).
 *
 * `down` drops all of it. The stable storage keys keep holding the current
 * bytes, so every asset is still served after a rollback.
 */
export class Migration20261018T141739AssetsLibraryAssetVersionsPermalinks extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "assets" add column "content_version" varchar(32) null;');
    this.addSql(
      `update "assets" set "content_version" = substr(md5(random()::text || "id"::text), 1, 12);`,
    );
    this.addSql(`
      alter table "assets"
        alter column "content_version" set default substr(md5(random()::text), 1, 12),
        alter column "content_version" set not null;
    `);

    this.addSql(`
      alter table "assets"
        add column "permalink" varchar(200) null,
        add column "previous_storage_locator" varchar(2048) null,
        add column "previous_filename" varchar(255) null,
        add column "previous_mime_type" varchar(127) null,
        add column "previous_mime_type_overridden" boolean null,
        add column "previous_kind" varchar(16) null,
        add column "previous_size_bytes" bigint null,
        add column "previous_content_version" varchar(32) null,
        add column "previous_replaced_at" timestamptz null,
        add column "previous_replaced_by" uuid null;
    `);
    this.addSql(`
      alter table "assets" add constraint "assets_previous_version_complete" check (
        num_nulls(
          "previous_storage_locator",
          "previous_filename",
          "previous_mime_type",
          "previous_mime_type_overridden",
          "previous_kind",
          "previous_size_bytes",
          "previous_content_version",
          "previous_replaced_at"
        ) in (0, 8)
      );
    `);
    this.addSql(
      'create unique index "assets_permalink_lower_unique" on "assets" (lower("permalink")) where "permalink" is not null;',
    );
    this.addSql(
      'create index "assets_previous_replaced_at_idx" on "assets" ("previous_replaced_at") where "previous_replaced_at" is not null;',
    );
    this.addSql(
      'create index "assets_soft_deleted_at_idx" on "assets" ("deleted_at") where "deleted_at" is not null;',
    );

    this.addSql(`
      create table "asset_permalink_releases" (
        "permalink_lower" varchar(200) not null,
        "permalink" varchar(200) not null,
        "asset_id" uuid not null,
        "released_at" timestamptz not null,
        "reason" varchar(16) not null,
        constraint "asset_permalink_releases_pkey" primary key ("permalink_lower"),
        constraint "asset_permalink_releases_reason_check"
          check ("reason" in ('changed', 'removed', 'purged'))
      );
    `);

    this.addSql(`
      create table "asset_object_cleanups" (
        "id" uuid not null,
        "storage_backend" varchar(8) not null,
        "locator" varchar(2048) not null,
        "reason" varchar(16) not null,
        "asset_id" uuid null,
        "recorded_at" timestamptz not null,
        "attempts" integer not null default 0,
        "last_error" text null,
        constraint "asset_object_cleanups_pkey" primary key ("id"),
        constraint "asset_object_cleanups_reason_check"
          check ("reason" in ('staging', 'previous', 'superseded', 'purge'))
      );
    `);
    this.addSql(
      'create unique index "asset_object_cleanups_locator_unique" on "asset_object_cleanups" ("storage_backend", "locator");',
    );
    this.addSql(
      'create index "asset_object_cleanups_recorded_at_idx" on "asset_object_cleanups" ("recorded_at");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "asset_object_cleanups";');
    this.addSql('drop table if exists "asset_permalink_releases";');
    this.addSql('drop index if exists "assets_soft_deleted_at_idx";');
    this.addSql('drop index if exists "assets_previous_replaced_at_idx";');
    this.addSql('drop index if exists "assets_permalink_lower_unique";');
    this.addSql(
      'alter table "assets" drop constraint if exists "assets_previous_version_complete";',
    );
    this.addSql(`
      alter table "assets"
        drop column if exists "previous_replaced_by",
        drop column if exists "previous_replaced_at",
        drop column if exists "previous_content_version",
        drop column if exists "previous_size_bytes",
        drop column if exists "previous_kind",
        drop column if exists "previous_mime_type_overridden",
        drop column if exists "previous_mime_type",
        drop column if exists "previous_filename",
        drop column if exists "previous_storage_locator",
        drop column if exists "permalink",
        drop column if exists "content_version";
    `);
  }
}
