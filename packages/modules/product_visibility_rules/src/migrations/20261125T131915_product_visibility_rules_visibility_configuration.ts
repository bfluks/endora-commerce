import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/193-product-visibility-rules/` data-model §1 — the configuration, every row of it
 * written by an audited Command (FR-070).
 *
 * - `visibility_categories` / `visibility_category_conditions`: a category qualifies a
 *   product when **any** of its conditions is met (FR-011); a category has at least one
 *   (Command validation). A condition's currency is not a foreign key: a later-deactivated
 *   currency stays stored and is never met (FR-012).
 * - `visibility_role_mappings`: at most one target per role — a category or `unrestricted`
 *   (FR-020, FR-025, I-2). A mapped category cannot be deleted (`restrict`, FR-013).
 * - `catalogue_price_designations`: one book per currency (FR-001); no row ⇒ the base book.
 * - `product_rules` / `website_rule_attachments`: named, reusable rules (FR-056) and at most
 *   one rule per channel (FR-051). An attached rule cannot be deleted (`restrict`).
 *
 * No foreign key leaves this module (data-model §0): role, book, channel ids are plain
 * `uuid` columns, and a dangling one matches nothing.
 */
export class Migration20261125T131915ProductVisibilityRulesVisibilityConfiguration extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "visibility_categories" (
        "id" uuid not null,
        "name" varchar(120) not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "visibility_categories_pkey" primary key ("id")
      );
    `);
    this.addSql(`create unique index "visibility_categories_name_ci_unique" on "visibility_categories" (lower("name"));`);

    this.addSql(`
      create table "visibility_category_conditions" (
        "id" uuid not null,
        "visibility_category_id" uuid not null,
        "currency_code" char(3) not null,
        "threshold" varchar(8) not null,
        constraint "visibility_category_conditions_pkey" primary key ("id"),
        constraint "visibility_category_conditions_category_fk" foreign key ("visibility_category_id")
          references "visibility_categories" ("id") on delete cascade,
        constraint "visibility_category_conditions_threshold_check" check ("threshold" in ('gt_zero', 'gte_zero'))
      );
    `);
    this.addSql(
      `create unique index "visibility_category_conditions_unique" on "visibility_category_conditions" ("visibility_category_id", "currency_code", "threshold");`,
    );

    this.addSql(`
      create table "visibility_role_mappings" (
        "admin_role_id" uuid not null,
        "target" varchar(12) not null,
        "visibility_category_id" uuid null,
        "updated_at" timestamptz not null,
        constraint "visibility_role_mappings_pkey" primary key ("admin_role_id"),
        constraint "visibility_role_mappings_category_fk" foreign key ("visibility_category_id")
          references "visibility_categories" ("id") on delete restrict,
        constraint "visibility_role_mappings_target_check" check (
          ("target" = 'category' and "visibility_category_id" is not null)
          or ("target" = 'unrestricted' and "visibility_category_id" is null)
        )
      );
    `);
    this.addSql(
      `create index "visibility_role_mappings_category_index" on "visibility_role_mappings" ("visibility_category_id");`,
    );

    this.addSql(`
      create table "catalogue_price_designations" (
        "currency_code" char(3) not null,
        "price_list_id" uuid not null,
        "sales_channel_id" uuid not null,
        "updated_at" timestamptz not null,
        constraint "catalogue_price_designations_pkey" primary key ("currency_code")
      );
    `);

    this.addSql(`
      create table "product_rules" (
        "id" uuid not null,
        "name" varchar(120) not null,
        "definition" jsonb not null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_rules_pkey" primary key ("id"),
        constraint "product_rules_name_unique" unique ("name")
      );
    `);

    this.addSql(`
      create table "website_rule_attachments" (
        "sales_channel_id" uuid not null,
        "product_rule_id" uuid not null,
        "attached_at" timestamptz not null,
        "applied_rule_version" int not null,
        constraint "website_rule_attachments_pkey" primary key ("sales_channel_id"),
        constraint "website_rule_attachments_rule_fk" foreign key ("product_rule_id")
          references "product_rules" ("id") on delete restrict
      );
    `);
    this.addSql(
      `create index "website_rule_attachments_rule_index" on "website_rule_attachments" ("product_rule_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "website_rule_attachments";`);
    this.addSql(`drop table if exists "product_rules";`);
    this.addSql(`drop table if exists "catalogue_price_designations";`);
    this.addSql(`drop table if exists "visibility_role_mappings";`);
    this.addSql(`drop table if exists "visibility_category_conditions";`);
    this.addSql(`drop table if exists "visibility_categories";`);
  }
}
