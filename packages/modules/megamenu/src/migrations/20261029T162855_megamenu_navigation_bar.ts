import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (issue #522) — the navigation bar.
 *
 *   - `presentation` and `alignment` make a top-level item a **tab**: how it
 *     opens, and which end of the bar it sits at. Both are set exactly on
 *     top-level rows (`megamenu_items_tab_fields_check`), so a child can never
 *     carry a presentation nobody renders.
 *   - `audience` says who may see an item; `everyone` by default.
 *
 * Stored top-level rows are backfilled as start-aligned `mega` tabs so the
 * constraint holds. Nothing else is converted: the owner ruled backward
 * compatibility of stored menus out (spec FR-028, plan R-10), and `mega` is
 * the one presentation every tab kind renders in.
 *
 * `kind` stays `varchar(32)` with no check constraint, as it was: the closed
 * set (now with `group` and `category-tree`) is enforced at the Zod boundary.
 */
export class Migration20261029T162855MegamenuNavigationBar extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "megamenu_items"
        add column "presentation" varchar(16) null,
        add column "alignment" varchar(8) null,
        add column "audience" jsonb not null default '{"kind":"everyone"}'::jsonb;
    `);
    this.addSql(`
      update "megamenu_items"
         set "presentation" = 'mega', "alignment" = 'start'
       where "parent_id" is null;
    `);
    this.addSql(`
      alter table "megamenu_items"
        add constraint "megamenu_items_presentation_check"
          check ("presentation" in ('link', 'dropdown', 'mega', 'catalog')),
        add constraint "megamenu_items_alignment_check"
          check ("alignment" in ('start', 'end')),
        add constraint "megamenu_items_tab_fields_check"
          check (("parent_id" is null) = ("presentation" is not null and "alignment" is not null)
                 and ("presentation" is null) = ("alignment" is null));
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "megamenu_items"
        drop constraint if exists "megamenu_items_tab_fields_check",
        drop constraint if exists "megamenu_items_alignment_check",
        drop constraint if exists "megamenu_items_presentation_check",
        drop column if exists "audience",
        drop column if exists "alignment",
        drop column if exists "presentation";
    `);
  }
}
