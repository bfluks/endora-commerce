import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163 — attachments and packaging units per scope
 * (`specs/163-product-data-scopes/data-model.md` §8, research R16; FR-078, FR-079).
 *
 * - `product_attachments.name_translations`, `.description_translations` — the
 *   attachment's name and description per language, `{ "<lang>": "<text>" }`; a
 *   language absent here shows the global `name` / `description`.
 * - `product_packaging_units.name_translations` — the unit's name per language; the
 *   basket and quote-request snapshots take it in the line's language and never
 *   re-resolve it.
 * - `product_attachment_channel_hidden` — an attachment hidden in a channel: not listed
 *   on that channel's product page. `product_id` is carried so a page reads one
 *   product's hidden set per channel from one index.
 *
 * Every row cascades on the attachment's, the product's and the channel's delete
 * (`sales_channels` is a kernel table catalog already depends on); a product leaving a
 * channel leaves its rows in place (FR-015). No backfill (R21): `'{}'` and no hidden
 * row are today's behaviour.
 *
 * `down()` drops the table and the three columns.
 */
export class Migration20261026T084533CatalogAttachmentPackagingTranslations extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "product_attachments" add column "name_translations" jsonb not null default '{}'::jsonb;`,
    );
    this.addSql(
      `alter table "product_attachments" add column "description_translations" jsonb not null default '{}'::jsonb;`,
    );
    this.addSql(
      `alter table "product_packaging_units" add column "name_translations" jsonb not null default '{}'::jsonb;`,
    );

    this.addSql(`
      create table "product_attachment_channel_hidden" (
        "attachment_id" uuid not null references "product_attachments"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "product_id" uuid not null references "products"("id") on delete cascade,
        constraint "product_attachment_channel_hidden_pkey" primary key ("attachment_id", "sales_channel_id")
      );
    `);
    this.addSql(
      `create index "product_attachment_channel_hidden_product_channel_idx" on "product_attachment_channel_hidden" ("product_id", "sales_channel_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_attachment_channel_hidden";`);
    this.addSql(`alter table "product_packaging_units" drop column if exists "name_translations";`);
    this.addSql(`alter table "product_attachments" drop column if exists "description_translations";`);
    this.addSql(`alter table "product_attachments" drop column if exists "name_translations";`);
  }
}
