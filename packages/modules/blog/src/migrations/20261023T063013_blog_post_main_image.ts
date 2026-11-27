import { Migration } from '@mikro-orm/migrations';

/**
 * The post's main image (`specs/163-page-builder-marketing-pages/` data-model
 * §1.2, research R-15).
 *
 * Mirrors `blog_categories.main_image_asset_id` from the init migration: a
 * nullable foreign key to `assets` (`assets_library` is already a declared
 * dependency) and an index, which the blog asset-reference scan reads when the
 * Library asks whether an asset is still in use. Existing rows and every insert
 * that does not name the column stay valid.
 */
export class Migration20261023T063013BlogPostMainImage extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "blog_posts"
        add column if not exists "main_image_asset_id" uuid null,
        add constraint "blog_posts_main_image_fk" foreign key ("main_image_asset_id")
          references "assets" ("id") on delete no action;
    `);
    this.addSql(
      'create index if not exists "idx_blog_posts_main_image_asset" on "blog_posts" ("main_image_asset_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_blog_posts_main_image_asset";');
    this.addSql(`
      alter table "blog_posts"
        drop constraint if exists "blog_posts_main_image_fk",
        drop column if exists "main_image_asset_id";
    `);
  }
}
