import { Migration } from '@mikro-orm/migrations';

/**
 * Sales channel *prefix the default language* setting
 * (`specs/167-storefront-locale-path/`, FR-001/FR-001a, data-model M1).
 *
 * Adds a non-null `prefix_default_language` boolean column to `sales_channels`.
 * When true, the channel's default language carries its path prefix in storefront
 * URLs (`/pl/p/wiertarka`) like every other channel language; when false, an
 * unprefixed URL means the default language (`/p/wiertarka`).
 *
 * The column default is `true`, so every channel created afterwards — by the admin,
 * the API, a raw insert or the boot-time default-channel reconciler on a fresh
 * database — starts prefixed (owner ruling OR-1). Then, in the same `up()`, every
 * channel that exists at this moment is set to `false` (owner ruling OR-10): an
 * upgrade moves none of its default-language URLs; an operator switches the setting
 * on per channel. One migration, so no process observes the column with existing
 * rows on. On a fresh database the `update` touches nothing — no migration inserts a
 * channel.
 *
 * `if not exists` keeps a re-run of the DDL harmless. `down` drops the column and
 * with it every operator choice.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "sales_channels" add column if not exists "prefix_default_language" boolean not null default true;`,
    );
    this.addSql(`update "sales_channels" set "prefix_default_language" = false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_channels" drop column if exists "prefix_default_language";`);
  }
}
