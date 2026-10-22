import { Migration } from '@mikro-orm/migrations';

/**
 * Sales channel *open to anonymous visitors* flag
 * (`specs/154-sales-channel-access/`, FR-001/FR-003, data-model M1).
 *
 * Adds a non-null `anonymous_access` boolean column (default `true`) to
 * `sales_channels`. When false, the kernel's access step refuses anonymous
 * requests on the channel with `SALES_CHANNEL_SIGN_IN_REQUIRED`. Independent of
 * `is_public`, which stays the anonymous price-visibility flag.
 *
 * Purely additive: a constant default is a catalogue-only change in
 * PostgreSQL, so no row is rewritten and every existing channel reads `true` —
 * open, which is what it was before the rule existed. `if not exists` keeps a
 * re-run harmless. `down` drops the column and with it every operator choice.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261018T101912CoreSalesChannelsAnonymousAccess extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "sales_channels" add column if not exists "anonymous_access" boolean not null default true;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sales_channels" drop column if exists "anonymous_access";`);
  }
}
