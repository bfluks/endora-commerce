import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163 — URL keys per language and per sales channel × language, and the
 * redirects their changes leave behind (`specs/163-product-data-scopes/data-model.md`
 * §5, research R11).
 *
 * - `product_url_keys` — one row per (product, language) for the language key
 *   (`sales_channel_id` null) and per (product, channel, language) for the override.
 *   The global key stays `products.slug` (FR-073 — no backfill, R21).
 * - `product_url_redirects` — a former key and the **product** it redirects to
 *   (never a target key, so redirects never chain). `language_code` null is a
 *   former global key, redirecting in every language (H1).
 *
 * Uniqueness of a key per language across channels (counting the global key where
 * a product has no language key) is not expressible as an index; the catalog write
 * service enforces it under a per-key advisory lock. The partial uniques here are
 * the expressible half: one key per product and scope, and one redirect per
 * (language, key) and per language-less key. The `(language_code, key)` and `key`
 * indexes serve the uniqueness check and resolution.
 *
 * Both tables cascade on the product's hard delete; key overrides also on the
 * channel's delete (`sales_channels` is a kernel table catalog already depends on).
 * A product leaving a channel, or a channel dropping a language, leaves the rows in
 * place (FR-015).
 *
 * `down()` drops both tables.
 */
export class Migration20261022T054223CatalogProductUrlKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_url_keys" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "language_code" varchar(16) not null,
        "sales_channel_id" uuid null references "sales_channels"("id") on delete cascade,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_url_keys_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index "product_url_keys_product_language_unique"
        on "product_url_keys" ("product_id", "language_code") where "sales_channel_id" is null;
    `);
    this.addSql(`
      create unique index "product_url_keys_product_channel_language_unique"
        on "product_url_keys" ("product_id", "sales_channel_id", "language_code") where "sales_channel_id" is not null;
    `);
    this.addSql(`create index "product_url_keys_language_key_idx" on "product_url_keys" ("language_code", "key");`);
    this.addSql(`create index "product_url_keys_key_idx" on "product_url_keys" ("key");`);
    // Both uniques above are partial, so neither serves a plain `product_id = ?` read
    // (every key read of one product, and the cascade from `products`).
    this.addSql(`create index "product_url_keys_product_idx" on "product_url_keys" ("product_id");`);

    this.addSql(`
      create table "product_url_redirects" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "language_code" varchar(16) null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        constraint "product_url_redirects_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create unique index "product_url_redirects_language_key_unique"
        on "product_url_redirects" ("language_code", "key") where "language_code" is not null;
    `);
    this.addSql(`
      create unique index "product_url_redirects_global_key_unique"
        on "product_url_redirects" ("key") where "language_code" is null;
    `);
    this.addSql(`create index "product_url_redirects_key_idx" on "product_url_redirects" ("key");`);
    this.addSql(`create index "product_url_redirects_product_idx" on "product_url_redirects" ("product_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_url_redirects";`);
    this.addSql(`drop table if exists "product_url_keys";`);
  }
}
