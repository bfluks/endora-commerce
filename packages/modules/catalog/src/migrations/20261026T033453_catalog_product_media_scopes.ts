import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 163 — the gallery per sales channel and its alt text per language
 * (`specs/163-product-data-scopes/data-model.md` §7, research R14, R15; FR-076, FR-077).
 *
 * - `gallery_item_channel_labels` — a channel's own holder of a role (`base_image`,
 *   `small_image`, `thumbnail`). The primary key `(product_id, sales_channel_id, label)`
 *   is the per-channel role uniqueness, by construction. No row = the global
 *   `gallery_item_labels` holder applies in that channel.
 * - `gallery_item_channel_hidden` — an item hidden in a channel. `product_id` is
 *   carried so a page reads one product's hidden set per channel from one index.
 * - `gallery_items.alt_text` — the product's own alt text of the image per language,
 *   `{ "<lang>": "<text>" }`; a language absent here falls back to the asset's alt.
 *
 * The image set itself stays global (D-6): a channel can neither add an image nor
 * reorder the gallery. Every row cascades on the product's, the item's and the
 * channel's delete (`sales_channels` is a kernel table catalog already depends on); a
 * product leaving a channel leaves its rows in place (FR-015). No backfill (R21).
 *
 * `down()` drops both tables and the column.
 */
export class Migration20261026T033453CatalogProductMediaScopes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "gallery_item_channel_labels" (
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "label" varchar(16) not null,
        "gallery_item_id" uuid not null references "gallery_items"("id") on delete cascade,
        constraint "gallery_item_channel_labels_pkey" primary key ("product_id", "sales_channel_id", "label"),
        constraint "chk_gallery_item_channel_labels_label"
          check ("label" in ('base_image', 'small_image', 'thumbnail'))
      );
    `);
    // The cascade from `gallery_items`.
    this.addSql(
      `create index "gallery_item_channel_labels_item_idx" on "gallery_item_channel_labels" ("gallery_item_id");`,
    );

    this.addSql(`
      create table "gallery_item_channel_hidden" (
        "gallery_item_id" uuid not null references "gallery_items"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "product_id" uuid not null references "products"("id") on delete cascade,
        constraint "gallery_item_channel_hidden_pkey" primary key ("gallery_item_id", "sales_channel_id")
      );
    `);
    this.addSql(
      `create index "gallery_item_channel_hidden_product_channel_idx" on "gallery_item_channel_hidden" ("product_id", "sales_channel_id");`,
    );

    this.addSql(`alter table "gallery_items" add column "alt_text" jsonb not null default '{}'::jsonb;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "gallery_items" drop column if exists "alt_text";`);
    this.addSql(`drop table if exists "gallery_item_channel_hidden";`);
    this.addSql(`drop table if exists "gallery_item_channel_labels";`);
  }
}
