import { Migration } from '@mikro-orm/migrations';

/**
 * A CMS page's name, slug and description per language
 * (`specs/163-page-builder-marketing-pages/` R24, issue #521; data-model §1.1).
 *
 * `translations` holds `{ <lang>: { name?, slug?, description? } }`; a language
 * without an entry inherits the page's own columns. It defaults to `{}`, so
 * every stored page reads as it did and every insert that does not name the
 * column stays valid.
 */
export class Migration20261029T131218CmsPageTranslations extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "cms_pages" add column if not exists "translations" jsonb not null default '{}'::jsonb;`);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cms_pages" drop column if exists "translations";');
  }
}
