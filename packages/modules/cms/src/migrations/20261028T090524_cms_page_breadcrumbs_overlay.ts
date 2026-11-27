import { Migration } from '@mikro-orm/migrations';

/**
 * Whether a CMS page draws its breadcrumb trail over its first section
 * (`specs/163-page-builder-marketing-pages/` R21H, T355; data-model §1.1)
 * instead of in a band above it.
 *
 * `breadcrumbs_overlay` defaults to `false`, so every stored page keeps the
 * band it has today and every insert that does not name the column stays valid.
 */
export class Migration20261028T090524CmsPageBreadcrumbsOverlay extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "cms_pages" add column if not exists "breadcrumbs_overlay" boolean not null default false;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "cms_pages" drop column if exists "breadcrumbs_overlay";');
  }
}
