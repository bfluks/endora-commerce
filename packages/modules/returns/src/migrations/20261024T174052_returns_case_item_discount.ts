import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #417 (review of PR #423) — `return_case_items.default_discount_amount`:
 * the part of the order-level discount a line's default refund carries.
 *
 * An order takes its discount off the gross, and its invoice carries it as a
 * 0 % line; a return refunds the goods less the discount they carried, and the
 * correction credits the goods at their full value and the discount back on its
 * own line. The settlement reads this share to tell the correction which is
 * which. Defaults to 0: a line recorded before carried none.
 */
export class Migration20261024T174052ReturnsCaseItemDiscount extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "return_case_items" add column if not exists "default_discount_amount" numeric(14,2) not null default 0;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "return_case_items" drop column if exists "default_discount_amount";');
  }
}
