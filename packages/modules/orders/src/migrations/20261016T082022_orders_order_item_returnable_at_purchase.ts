import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 155 — `order_items.returnable_at_purchase`
 * (`specs/155-catalog-order-constraints/data-model.md` §3).
 *
 * Whether the product was returnable when the line was placed, written once
 * at placement (FR-016a). `null` only on lines placed before this column
 * existed, which `returns` reads as returnable (FR-017).
 */
export class Migration20261016T082022OrdersOrderItemReturnableAtPurchase extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "order_items" add column "returnable_at_purchase" boolean null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "order_items" drop column if exists "returnable_at_purchase";`);
  }
}
