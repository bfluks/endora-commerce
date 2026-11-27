import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163 — SEO overrides per sales channel and per sales channel × language
 * (`specs/163-product-data-scopes/data-model.md` §6, research R13).
 *
 * - `sales_channel_id` (nullable, `on delete cascade`): a row with a channel and no
 *   locale is the channel row, with both the channel × language row. Every row
 *   written before has no channel and is the language row, unchanged (US8 #2) — no
 *   backfill.
 * - `locale` becomes nullable, with a check that at least one of the two is set.
 * - The unique `(entity_type, entity_id, locale)` becomes three partial uniques, one
 *   per row shape, so each address holds one row.
 *
 * `sales_channels` is a kernel table; `seo` already reaches it through `catalog`.
 *
 * `down()` deletes the channel and channel × language rows — the previous shape
 * cannot hold them — and restores the language-only unique.
 */
export class Migration20261025T215911SeoMetaOverrideChannelScope extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "seo_meta_overrides"
        add column "sales_channel_id" uuid null references "sales_channels"("id") on delete cascade;
    `);
    this.addSql(`alter table "seo_meta_overrides" alter column "locale" drop not null;`);
    this.addSql(`
      alter table "seo_meta_overrides"
        add constraint "seo_meta_overrides_scope_check" check ("locale" is not null or "sales_channel_id" is not null);
    `);
    this.addSql(`alter table "seo_meta_overrides" drop constraint "uniq_seo_meta_overrides_entity_locale";`);
    this.addSql(`
      create unique index "seo_meta_overrides_language_unique"
        on "seo_meta_overrides" ("entity_type", "entity_id", "locale") where "sales_channel_id" is null;
    `);
    this.addSql(`
      create unique index "seo_meta_overrides_channel_unique"
        on "seo_meta_overrides" ("entity_type", "entity_id", "sales_channel_id") where "locale" is null;
    `);
    this.addSql(`
      create unique index "seo_meta_overrides_channel_language_unique"
        on "seo_meta_overrides" ("entity_type", "entity_id", "sales_channel_id", "locale")
        where "sales_channel_id" is not null and "locale" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "seo_meta_overrides" where "sales_channel_id" is not null;`);
    this.addSql(`drop index if exists "seo_meta_overrides_channel_language_unique";`);
    this.addSql(`drop index if exists "seo_meta_overrides_channel_unique";`);
    this.addSql(`drop index if exists "seo_meta_overrides_language_unique";`);
    this.addSql(`alter table "seo_meta_overrides" drop constraint if exists "seo_meta_overrides_scope_check";`);
    this.addSql(`alter table "seo_meta_overrides" alter column "locale" set not null;`);
    this.addSql(`alter table "seo_meta_overrides" drop column "sales_channel_id";`);
    this.addSql(`
      alter table "seo_meta_overrides"
        add constraint "uniq_seo_meta_overrides_entity_locale" unique ("entity_type", "entity_id", "locale");
    `);
  }
}
