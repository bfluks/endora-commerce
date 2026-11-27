import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/193-product-visibility-rules/` data-model §2, §3 — derived, worker-written tables.
 * Not audited: every row is recomputed from the pricing engine and the catalogue.
 *
 * - Catalogue-price flags (R-5): `product_catalogue_prices` / `variant_catalogue_prices`
 *   hold a row only where a catalogue price exists in the currency (0 included), keyed by
 *   generation; `catalogue_price_generations` says which generation every read uses and
 *   which designation it was built for; `catalogue_price_stale_products` holds targeted
 *   refresh marks.
 * - Website rule (R-9 – R-11): previews and their per-product changes, the admissions
 *   ledger (FR-093) and the re-evaluation marks.
 */
export class Migration20261125T131918ProductVisibilityRulesCataloguePriceFlagsAndWebsiteRule extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "catalogue_price_generations" (
        "currency_code" char(3) not null,
        "served_generation" int not null,
        "building_generation" int null,
        "built_for_price_list_id" uuid null,
        "built_for_sales_channel_id" uuid null,
        "whole_stale" boolean not null default false,
        "consumed_watermark" text null,
        "built_at" timestamptz null,
        constraint "catalogue_price_generations_pkey" primary key ("currency_code")
      );
    `);

    this.addSql(`
      create table "product_catalogue_prices" (
        "currency_code" char(3) not null,
        "generation" int not null,
        "product_id" uuid not null,
        "has_positive" boolean not null,
        "refreshed_at" timestamptz not null,
        constraint "product_catalogue_prices_pkey" primary key ("currency_code", "generation", "product_id")
      );
    `);
    this.addSql(
      `create index "product_catalogue_prices_predicate_index" on "product_catalogue_prices" ("currency_code", "generation", "has_positive", "product_id");`,
    );

    this.addSql(`
      create table "variant_catalogue_prices" (
        "currency_code" char(3) not null,
        "generation" int not null,
        "variant_id" uuid not null,
        "product_id" uuid not null,
        "has_positive" boolean not null,
        "refreshed_at" timestamptz not null,
        constraint "variant_catalogue_prices_pkey" primary key ("currency_code", "generation", "variant_id")
      );
    `);
    this.addSql(
      `create index "variant_catalogue_prices_predicate_index" on "variant_catalogue_prices" ("currency_code", "generation", "has_positive", "variant_id");`,
    );
    this.addSql(
      `create index "variant_catalogue_prices_product_index" on "variant_catalogue_prices" ("currency_code", "generation", "product_id");`,
    );

    this.addSql(`
      create table "catalogue_price_stale_products" (
        "currency_code" char(3) not null,
        "product_id" uuid not null,
        "marked_at" timestamptz not null,
        constraint "catalogue_price_stale_products_pkey" primary key ("currency_code", "product_id")
      );
    `);

    this.addSql(`
      create table "website_rule_previews" (
        "id" uuid not null,
        "kind" varchar(8) not null,
        "product_rule_id" uuid null,
        "definition" jsonb not null,
        "rule_version" int null,
        "sales_channel_ids" uuid[] not null,
        "status" varchar(10) not null default 'pending',
        "counts" jsonb null,
        "created_by_admin_user_id" uuid not null,
        "created_at" timestamptz not null,
        "expires_at" timestamptz not null,
        constraint "website_rule_previews_pkey" primary key ("id"),
        constraint "website_rule_previews_kind_check" check ("kind" in ('attach', 'change')),
        constraint "website_rule_previews_status_check" check ("status" in ('pending', 'ready', 'failed', 'applied', 'expired'))
      );
    `);
    this.addSql(
      `create index "website_rule_previews_creator_status_index" on "website_rule_previews" ("created_by_admin_user_id", "status");`,
    );
    this.addSql(`create index "website_rule_previews_expires_index" on "website_rule_previews" ("expires_at");`);

    this.addSql(`
      create table "website_rule_preview_changes" (
        "preview_id" uuid not null,
        "sales_channel_id" uuid not null,
        "product_id" uuid not null,
        "op" varchar(5) not null,
        constraint "website_rule_preview_changes_pkey" primary key ("preview_id", "sales_channel_id", "product_id", "op"),
        constraint "website_rule_preview_changes_preview_fk" foreign key ("preview_id")
          references "website_rule_previews" ("id") on delete cascade,
        constraint "website_rule_preview_changes_op_check" check ("op" in ('join', 'leave'))
      );
    `);

    this.addSql(`
      create table "website_rule_admissions" (
        "sales_channel_id" uuid not null,
        "product_id" uuid not null,
        "admitted_at" timestamptz not null,
        "post_admission_status_seen" boolean not null default false,
        constraint "website_rule_admissions_pkey" primary key ("sales_channel_id", "product_id")
      );
    `);
    this.addSql(`create index "website_rule_admissions_product_index" on "website_rule_admissions" ("product_id");`);

    this.addSql(`
      create table "website_rule_stale_products" (
        "product_id" uuid not null,
        "marked_at" timestamptz not null,
        constraint "website_rule_stale_products_pkey" primary key ("product_id")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "website_rule_stale_products";`);
    this.addSql(`drop table if exists "website_rule_admissions";`);
    this.addSql(`drop table if exists "website_rule_preview_changes";`);
    this.addSql(`drop table if exists "website_rule_previews";`);
    this.addSql(`drop table if exists "catalogue_price_stale_products";`);
    this.addSql(`drop table if exists "variant_catalogue_prices";`);
    this.addSql(`drop table if exists "product_catalogue_prices";`);
    this.addSql(`drop table if exists "catalogue_price_generations";`);
  }
}
