import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (issue #522, review) — a tab whose click follows its own link.
 *
 * `click_navigates` is off by default, when a click on a tab with a panel opens
 * the panel as before. On, the click follows the tab's link and the panel opens
 * on hover and from its own toggle. A tab's alone
 * (`megamenu_items_click_navigates_check`): below the top level an item is a
 * link already.
 */
export class Migration20261029T190956MegamenuTabClickNavigates extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "megamenu_items"
        add column "click_navigates" boolean not null default false,
        add constraint "megamenu_items_click_navigates_check"
          check (not "click_navigates" or "parent_id" is null);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "megamenu_items"
        drop constraint if exists "megamenu_items_click_navigates_check",
        drop column if exists "click_navigates";
    `);
  }
}
