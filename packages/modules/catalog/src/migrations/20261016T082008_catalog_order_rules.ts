import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 155 — the catalogue's order rules
 * (`specs/155-catalog-order-constraints/data-model.md` §1).
 *
 * - `products.min_order_quantity` — the minimum order quantity in pieces,
 *   1…1 000 000 or `null` for none (FR-001);
 * - `products.returnable` — whether the product may be returned, `false`
 *   unless an operator says otherwise (FR-003, FR-004);
 * - `product_packaging_units.min_order_units` — the minimum number of units
 *   of that packaging unit, 1…1 000 000 or `null` for none (FR-002).
 *
 * The two check constraints are the third of the three places the range is
 * enforced (request schema, service, database — R9).
 *
 * `down()` drops both constraints and the three columns.
 */
export class Migration20261016T082008CatalogOrderRules extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "products"
        add column "min_order_quantity" integer null,
        add column "returnable" boolean not null default false,
        add constraint "products_min_order_quantity_check"
          check ("min_order_quantity" is null or "min_order_quantity" between 1 and 1000000);
    `);
    this.addSql(`
      alter table "product_packaging_units"
        add column "min_order_units" integer null,
        add constraint "product_packaging_units_min_order_units_check"
          check ("min_order_units" is null or "min_order_units" between 1 and 1000000);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "product_packaging_units"
        drop constraint if exists "product_packaging_units_min_order_units_check",
        drop column if exists "min_order_units";
    `);
    this.addSql(`
      alter table "products"
        drop constraint if exists "products_min_order_quantity_check",
        drop column if exists "returnable",
        drop column if exists "min_order_quantity";
    `);
  }
}
