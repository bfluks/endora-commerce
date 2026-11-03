import { Migration } from '@mikro-orm/migrations';

/**
 * Retire `sales_channels.is_public` into the pricing display-mode chain
 * (issue #492).
 *
 * The column was documented as anonymous-price visibility, but every read of
 * it withheld prices from **every** viewer on the channel, signed-in buyers
 * included, beside a display-mode chain that already says "hide prices until
 * sign-in" per channel: `pricing.unauthenticated_display_mode = none`. It was a
 * legacy column "preserved for one release" (feature 005, research R-12) that
 * was never folded away, and nothing in the admin could change it (#467).
 *
 * `up` does two things, in one transaction:
 *
 *  1. **Carries the guest half of the flag over.** Every channel with
 *     `is_public = false` gets `pricing.unauthenticated_display_mode = "none"`
 *     as its own per-channel value — unless it already has one, which is an
 *     operator's explicit choice and is kept. Anonymous visitors on such a
 *     channel therefore still see no price. A channel with `is_public = true`
 *     gets nothing: it published prices and still does.
 *  2. **Drops the column.**
 *
 * The signed-in half is deliberately **not** carried over: a buyer on a
 * channel that had `is_public = false` now sees prices according to the
 * display-mode chain, which is the behaviour change the issue asks for.
 *
 * **A database with a non-public channel and no setting row is refused**, not
 * migrated. The `settings` row is created by the boot-time manifest
 * reconciler from `price_lists`' manifest, so every database that has a
 * channel has it — a channel is itself created by a boot reconciler. Writing
 * nothing would turn the channel's withheld prices into shown ones without a
 * word; inventing the declaration here would produce a row no manifest owns.
 * The refusal names the remedy: start the platform once on the previous
 * release, so the reconciler writes the row, then migrate.
 *
 * **Why it is filed under `core`.** All three tables it touches are the
 * kernel's: `sales_channels` (the platform's `SalesChannel` entity), and
 * `settings` / `setting_values` (created by `…CoreSettingsInit`, filed under
 * `core` since feature 072). A module migration must not write a table another
 * owner holds (`specs/conventions/module-migrations.md` item 4a, rule R2), and
 * `…CoreRetireCoreActivationSettings` is the precedent for a core migration
 * correcting `settings` rows a module's manifest declares. It reads no module's
 * table, so no `dependencies` edge is involved, and the data step and the drop
 * belong in one migration: split, the column could be dropped before the data
 * step read it.
 *
 * `down` re-adds the column and derives it from the per-channel value:
 * `false` where the channel's own `pricing.unauthenticated_display_mode` is
 * `none`, `true` elsewhere, with the historical default `false` for new rows.
 * It leaves the setting values in place: they are operator state from here on
 * and cannot be told apart from values an operator wrote.
 */
export class Migration20261028T173317CoreSalesChannelsRetireIsPublic extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from information_schema.columns
           where table_schema = current_schema()
             and table_name = 'sales_channels'
             and column_name = 'is_public'
        ) then
          return;
        end if;

        if exists (select 1 from "sales_channels" where "is_public" = false)
           and not exists (
             select 1 from "settings" where "code" = 'pricing.unauthenticated_display_mode'
           ) then
          raise exception using
            message = 'Cannot retire sales_channels.is_public: a sales channel withholds prices '
              || '(is_public = false) but the setting pricing.unauthenticated_display_mode is not '
              || 'registered, so its anonymous visitors would start seeing prices.',
            hint = 'Start the platform once on the previous release so the settings reconciler '
              || 'registers it, then run the migrations again.';
        end if;

        insert into "setting_values"
          ("id", "setting_id", "sales_channel_id", "value", "created_at", "updated_at")
        select gen_random_uuid(), s."id", c."id", '"none"'::jsonb, now(), now()
          from "sales_channels" c
          join "settings" s on s."code" = 'pricing.unauthenticated_display_mode'
         where c."is_public" = false
           and not exists (
             select 1 from "setting_values" v
              where v."setting_id" = s."id" and v."sales_channel_id" = c."id"
           );
      end
      $$;
    `);
    this.addSql(`alter table "sales_channels" drop column if exists "is_public";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "sales_channels" add column if not exists "is_public" boolean not null default true;`,
    );
    this.addSql(`
      update "sales_channels" c
         set "is_public" = false
       where exists (
         select 1 from "setting_values" v
           join "settings" s on s."id" = v."setting_id"
          where s."code" = 'pricing.unauthenticated_display_mode'
            and v."sales_channel_id" = c."id"
            and v."value" = '"none"'::jsonb
       );
    `);
    this.addSql(`alter table "sales_channels" alter column "is_public" set default false;`);
  }
}
