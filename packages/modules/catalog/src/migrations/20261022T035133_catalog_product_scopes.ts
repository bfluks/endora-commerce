import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163 — product data scopes per sales channel and language
 * (`specs/163-product-data-scopes/data-model.md` §1–§3, research R1–R4).
 *
 * - `product_channel_scopes` — one row per (product, channel) holding the channel
 *   overrides of status, publication window, audience, minimum order quantity and
 *   the returnable flag. `NULL` (for the window, a false `window_overridden`) means
 *   "inherit the global value"; a row whose every field inherits is deleted by the
 *   write service, never stored (FR-012).
 * - `product_channel_language_scopes` — the status at one (product, channel,
 *   language). "Use inherited" deletes the row.
 * - `products.publish_from` / `products.publish_until` — the global publication
 *   window, inclusive at both ends; `NULL` = open on that side.
 *
 * Both tables cascade on the product's hard delete and on the channel's delete;
 * a product leaving a channel or a channel dropping a language leaves the rows in
 * place, ignored by resolution (FR-015). The `CHECK`s are the database's copy of the
 * rules the request schema and the write service also enforce. No backfill (R21):
 * with no row anywhere, every product behaves exactly as before.
 *
 * `down()` drops both tables and both columns.
 */
export class Migration20261022T035133CatalogProductScopes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_channel_scopes" (
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "status" varchar(16) null,
        "window_overridden" boolean not null default false,
        "publish_from" timestamptz null,
        "publish_until" timestamptz null,
        "visibility" varchar(32) null,
        "allowed_organization_ids" jsonb null,
        "min_order_quantity" integer null,
        "returnable" boolean null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_channel_scopes_pkey" primary key ("product_id", "sales_channel_id"),
        constraint "product_channel_scopes_status_check"
          check ("status" is null or "status" in ('draft', 'active', 'inactive')),
        constraint "product_channel_scopes_window_order_check"
          check ("publish_from" is null or "publish_until" is null or "publish_from" < "publish_until"),
        constraint "product_channel_scopes_window_flag_check"
          check ("window_overridden" or ("publish_from" is null and "publish_until" is null)),
        constraint "product_channel_scopes_visibility_check"
          check ("visibility" is null or "visibility" in ('public', 'logged_in_only', 'organization_restricted')),
        constraint "product_channel_scopes_audience_pair_check"
          check (("visibility" is null) = ("allowed_organization_ids" is null)),
        constraint "product_channel_scopes_min_order_quantity_check"
          check ("min_order_quantity" is null or "min_order_quantity" between 1 and 1000000)
      );
    `);
    this.addSql(`
      create index "product_channel_scopes_channel_status_idx"
        on "product_channel_scopes" ("sales_channel_id", "status");
    `);
    this.addSql(`
      create table "product_channel_language_scopes" (
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "language_code" varchar(16) not null,
        "status" varchar(16) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_channel_language_scopes_pkey"
          primary key ("product_id", "sales_channel_id", "language_code"),
        constraint "product_channel_language_scopes_status_check"
          check ("status" in ('draft', 'active', 'inactive'))
      );
    `);
    this.addSql(`
      alter table "products"
        add column "publish_from" timestamptz null,
        add column "publish_until" timestamptz null,
        add constraint "products_publish_window_check"
          check ("publish_from" is null or "publish_until" is null or "publish_from" < "publish_until");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_channel_language_scopes";`);
    this.addSql(`drop table if exists "product_channel_scopes";`);
    this.addSql(`
      alter table "products"
        drop constraint if exists "products_publish_window_check",
        drop column if exists "publish_until",
        drop column if exists "publish_from";
    `);
  }
}
