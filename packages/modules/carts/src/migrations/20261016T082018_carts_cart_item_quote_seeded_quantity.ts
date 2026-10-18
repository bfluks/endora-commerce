import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 154 — `cart_items.quote_seeded_quantity`
 * (`specs/154-catalog-order-constraints/data-model.md` §2).
 *
 * The quantity a line was seeded with from an accepted quote request; `null`
 * for every other line. A line whose quantity still equals it is exempt from
 * the catalogue's order minimums (FR-028).
 */
export class Migration20261016T082018CartsCartItemQuoteSeededQuantity extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "cart_items" add column "quote_seeded_quantity" integer null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "cart_items" drop column if exists "quote_seeded_quantity";`);
  }
}
