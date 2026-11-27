import { Migration } from '@mikro-orm/migrations';

/**
 * The page tree, the breadcrumb settings and the sharing image on `cms_pages`
 * (`specs/163-page-builder-marketing-pages/` data-model §1.1, research R-18).
 *
 * - `parent_page_id` drives the breadcrumb trail only; a page's URL never
 *   derives from it (FR-030). `on delete set null` is FR-030a's "deleting a
 *   parent clears the field on its children", held by the database. The
 *   self/cycle/depth rule is the `cms_page.update` Command's
 *   (`CMS_PAGE_PARENT_CYCLE`), because a check constraint cannot walk a chain.
 * - `breadcrumbs_visible` and `breadcrumbs_scheme` default to today's look:
 *   shown, on the light scheme (FR-031).
 * - `share_image_asset_id` is an asset id and deliberately not a foreign key:
 *   assets belong to `assets_library`, a switchable module, so the reference is
 *   held by the `cms` asset-reference scan instead.
 *
 * Every column is nullable or defaulted, so existing rows and every insert
 * that does not name them stay valid.
 */
export class Migration20261023T052237CmsPageTreeAndShare extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "cms_pages"
        add column if not exists "parent_page_id" uuid null,
        add column if not exists "breadcrumbs_visible" boolean not null default true,
        add column if not exists "breadcrumbs_scheme" text not null default 'light',
        add column if not exists "share_image_asset_id" uuid null;
    `);
    this.addSql(`
      alter table "cms_pages"
        add constraint "cms_pages_parent_page_id_fk"
          foreign key ("parent_page_id") references "cms_pages" ("id") on delete set null,
        add constraint "cms_pages_breadcrumbs_scheme_check"
          check ("breadcrumbs_scheme" in ('light', 'muted', 'dark'));
    `);
    this.addSql(
      'create index if not exists "cms_pages_parent_page_id_idx" on "cms_pages" ("parent_page_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "cms_pages_parent_page_id_idx";');
    this.addSql(`
      alter table "cms_pages"
        drop constraint if exists "cms_pages_breadcrumbs_scheme_check",
        drop constraint if exists "cms_pages_parent_page_id_fk",
        drop column if exists "share_image_asset_id",
        drop column if exists "breadcrumbs_scheme",
        drop column if exists "breadcrumbs_visible",
        drop column if exists "parent_page_id";
    `);
  }
}
