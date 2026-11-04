import { Migration } from '@mikro-orm/migrations';

/**
 * Whether a CMS page's public path starts with its parent's
 * (`specs/163-page-builder-marketing-pages/` R19D, T284; data-model §1.1).
 *
 * `parent_path_in_url` defaults to `false`, so every stored page keeps the flat
 * `/<slug>` it has today and every insert that does not name the column stays
 * valid. The path itself is not stored: it is computed on read from the parent
 * chain and each channel's slug, so renaming or moving a parent moves its
 * nested descendants with nothing to rewrite.
 */
export class Migration20261027T165458CmsPageParentPathInUrl extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "cms_pages" add column if not exists "parent_path_in_url" boolean not null default false;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cms_pages" drop column if exists "parent_path_in_url";');
  }
}
